"use client";

import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { useSidebar } from "@/lib/sidebar-context";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import {
  LayoutDashboard,
  StickyNote,
  Bot,
  ListTodo,
  Sparkles,
  Gem,
  Settings,
  BookmarkPlus,
  Download,
  Upload,
  Archive,
  Check,
  Users,
  BookOpen,
  Loader2,
  Radio,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  FileText,
  Database,
  UploadCloud,
  Inbox,
} from "lucide-react";

export function WorkspaceSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { workspaceId } = useWorkspace();
  const { open, setOpen, collapsed, toggleCollapsed } = useSidebar();
  const fromKanban = searchParams.get("from") === "kanban";

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  const prefix = `/workspaces/${workspaceId}`;

  const nav = [
    { href: `${prefix}/kanban`, label: "Kanban", Icon: LayoutDashboard },
    { href: `${prefix}/chat`, label: "Chat", Icon: MessageSquare },
    { href: `${prefix}/inbox`, label: "Inbox", Icon: Inbox },
    { href: `${prefix}/notes`, label: "Notes", Icon: StickyNote },
    { href: `${prefix}/agents`, label: "Agents", Icon: Bot },
    { href: `${prefix}/tasks`, label: "Tasks", Icon: ListTodo },
    { href: `${prefix}/clients`, label: "Clients", Icon: Users },
    { href: `${prefix}/ledger`, label: "Ledger", Icon: BookOpen },
    { href: `${prefix}/archives`, label: "Files", Icon: Archive },
    { href: `${prefix}/channels`, label: "Channels", Icon: Radio },
    { href: `${prefix}/skills`, label: "Skills", Icon: Sparkles },
  ];

  function isActive(href: string) {
    if (
      fromKanban &&
      (pathname.startsWith(`${prefix}/tasks/`) ||
        pathname.startsWith(`${prefix}/task-groups/`) ||
        pathname.startsWith(`${prefix}/task-hub`))
    ) {
      if (href === `${prefix}/kanban`) return true;
      if (href === `${prefix}/tasks`) return false;
    }
    if (href === `${prefix}/kanban`) return pathname === `${prefix}/kanban` || pathname === prefix;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-border-muted bg-surface-raised transition-all duration-200 ease-in-out md:translate-x-0 ${
          collapsed ? "md:w-14" : "md:w-52"
        } w-52 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className={`flex items-center justify-between py-5 ${collapsed ? "px-3" : "px-5"}`}>
          <Link href="/dashboard" className="flex items-center gap-1.5">
            <Gem className="h-5 w-5 shrink-0 text-emerald-400" />
            {!collapsed && (
              <span className="text-lg font-bold tracking-tight text-primary">Opcify</span>
            )}
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-tertiary hover:bg-surface-overlay hover:text-secondary md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!collapsed && (
          <div className="px-3 pb-3">
            <WorkspaceSwitcher />
          </div>
        )}

        <nav className={`mt-1 flex-1 space-y-0.5 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`}>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center rounded-md py-2 text-sm transition-colors ${
                collapsed ? "justify-center px-0" : "gap-2.5 px-3"
              } ${
                isActive(item.href)
                  ? "bg-surface-overlay text-primary"
                  : "text-tertiary hover:bg-surface-overlay/50 hover:text-secondary"
              }`}
            >
              <item.Icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          ))}
        </nav>

        <div className={`border-t border-border-muted py-3 ${collapsed ? "px-2" : "px-3"}`}>
          <div className={`hidden md:flex items-center ${collapsed ? "justify-center gap-1" : "justify-between px-2"}`}>
            {!collapsed && <ThemeSwitcher />}
            <div className="flex items-center gap-1">
              {!collapsed && <WorkspaceActionsMenu workspaceId={workspaceId} iconOnly />}
              <button
                onClick={toggleCollapsed}
                className="flex h-8 w-8 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-surface-overlay/50 hover:text-secondary"
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Unified workspace actions popover ──────────────────────────────

type ActiveModal = null | "save-template" | "export-backup" | "restore-backup" | "archive-confirm";

function WorkspaceActionsMenu({ workspaceId, iconOnly }: { workspaceId: string; iconOnly?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  // ── Export Backup ──
  function handleExportBackup() {
    setMenuOpen(false);
    setActiveModal("export-backup");
  }

  async function doExportConfig() {
    setBusy(true);
    try {
      const dateSuffix = new Date().toISOString().slice(0, 10);
      const backup = await api.workspaces.backup(workspaceId);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workspace-backup-${dateSuffix}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("Workspace config exported");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function doExportDb() {
    setBusy(true);
    try {
      const dateSuffix = new Date().toISOString().slice(0, 10);
      const token = typeof window !== "undefined" ? localStorage.getItem("opcify_token") : null;
      const dbUrl = api.workspaces.backupDbUrl(workspaceId);
      const a = document.createElement("a");
      a.href = token ? `${dbUrl}?token=${encodeURIComponent(token)}` : dbUrl;
      a.download = `workspace-backup-${dateSuffix}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast("Database file exported");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setBusy(false);
    }
  }

  // ── Restore Backup ──
  const [pendingRestoreDbFile, setPendingRestoreDbFile] = useState<File | null>(null);
  const [restoreName, setRestoreName] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);

  function handleRestoreBackup() {
    setMenuOpen(false);
    setPendingRestoreFile(null);
    setPendingRestoreDbFile(null);
    setRestoreName("");
    setRestoreError(null);
    setActiveModal("restore-backup");
  }

  async function onRestoreJsonSelected(file: File) {
    setPendingRestoreFile(file);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const name = data?.config?.workspace?.name ?? "";
      setRestoreName(name ? `${name} (Restored)` : "");
    } catch {
      setRestoreName("");
    }
  }

  // ── Save as Template ──
  function handleSaveAsTemplate() {
    setMenuOpen(false);
    setActiveModal("save-template");
  }

  // ── Archive Workspace ──
  function handleArchive() {
    setMenuOpen(false);
    setActiveModal("archive-confirm");
  }

  return (
    <>
      {/* Trigger button */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          disabled={busy}
          title="Workspace Actions"
          className={iconOnly
            ? "flex h-8 w-8 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-surface-overlay/50 hover:text-secondary disabled:opacity-50"
            : "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-tertiary transition-colors hover:bg-surface-overlay/50 hover:text-secondary disabled:opacity-50"
          }
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Settings className="h-4 w-4 shrink-0" />
          )}
          {!iconOnly && "Workspace Actions"}
        </button>

        {/* Popover menu */}
        {menuOpen && (
          <div className="absolute bottom-full left-0 z-40 mb-1 w-52 rounded-lg border border-border-muted bg-surface-raised shadow-xl">
            <div className="py-1">
              <button
                onClick={handleSaveAsTemplate}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-tertiary transition-colors hover:bg-surface-overlay hover:text-secondary"
              >
                <BookmarkPlus className="h-4 w-4 shrink-0" />
                Save as Template
              </button>
              <button
                onClick={handleExportBackup}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-tertiary transition-colors hover:bg-surface-overlay hover:text-secondary"
              >
                <Download className="h-4 w-4 shrink-0" />
                Export Backup
              </button>
              <button
                onClick={handleRestoreBackup}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-tertiary transition-colors hover:bg-surface-overlay hover:text-secondary"
              >
                <Upload className="h-4 w-4 shrink-0" />
                Restore Backup
              </button>
              <div className="my-1 border-t border-border-muted" />
              <button
                onClick={handleArchive}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-surface-overlay hover:text-red-300"
              >
                <Archive className="h-4 w-4 shrink-0" />
                Archive Workspace
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals rendered via portal to escape sidebar clipping */}
      {typeof document !== "undefined" && createPortal(
        <>
          {activeModal === "save-template" && (
            <SaveAsTemplateModal
              workspaceId={workspaceId}
              onClose={() => setActiveModal(null)}
            />
          )}

          {/* Export Backup Modal */}
          {activeModal === "export-backup" && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/60" onClick={() => setActiveModal(null)} />
              <div className="relative w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
                <h2 className="text-lg font-semibold text-zinc-100">Export Backup</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Choose what to export from this workspace.
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {/* Config card */}
                  <button
                    onClick={async () => { await doExportConfig(); }}
                    disabled={busy}
                    className="group flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-center transition-colors hover:border-emerald-700 hover:bg-emerald-950/20 disabled:opacity-50"
                  >
                    <FileText className="h-8 w-8 text-emerald-400" />
                    <div>
                      <p className="text-sm font-medium text-zinc-200">Workspace Config</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Agents, skills, templates, settings, tasks, clients, notes, and all workspace data
                      </p>
                    </div>
                    <span className="mt-auto rounded-md bg-zinc-800 px-3 py-1 text-xs text-zinc-300 group-hover:bg-emerald-800 group-hover:text-emerald-200">
                      .json
                    </span>
                  </button>
                  {/* Database card */}
                  <button
                    onClick={async () => { await doExportDb(); }}
                    disabled={busy}
                    className="group flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-center transition-colors hover:border-blue-700 hover:bg-blue-950/20 disabled:opacity-50"
                  >
                    <Database className="h-8 w-8 text-blue-400" />
                    <div>
                      <p className="text-sm font-medium text-zinc-200">Database File</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Full SQLite database snapshot for complete system backup and recovery
                      </p>
                    </div>
                    <span className="mt-auto rounded-md bg-zinc-800 px-3 py-1 text-xs text-zinc-300 group-hover:bg-blue-800 group-hover:text-blue-200">
                      .db
                    </span>
                  </button>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={() => setActiveModal(null)}
                    className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Restore Backup Modal */}
          {activeModal === "restore-backup" && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/60" onClick={() => { setActiveModal(null); setPendingRestoreFile(null); setPendingRestoreDbFile(null); setRestoreError(null); }} />
              <div className="relative w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
                <h2 className="text-lg font-semibold text-zinc-100">Restore Backup</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Create a new workspace from a backup file.
                </p>

                {/* Workspace Name */}
                <div className="mt-5">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    Workspace Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={restoreName}
                    onChange={(e) => { setRestoreName(e.target.value); setRestoreError(null); }}
                    placeholder="Name for the restored workspace"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700"
                  />
                </div>

                {/* File selection cards */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {/* Config JSON card */}
                  <label className={`group flex cursor-pointer flex-col items-center gap-3 rounded-lg border p-4 text-center transition-colors ${
                    pendingRestoreFile
                      ? "border-emerald-700 bg-emerald-950/20"
                      : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                  }`}>
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { onRestoreJsonSelected(f); setRestoreError(null); }
                      }}
                    />
                    {pendingRestoreFile ? (
                      <Check className="h-7 w-7 text-emerald-400" />
                    ) : (
                      <UploadCloud className="h-7 w-7 text-zinc-500" />
                    )}
                    <div>
                      <p className="text-xs font-medium text-zinc-200">
                        Workspace Config <span className="text-red-400">*</span>
                      </p>
                      {pendingRestoreFile ? (
                        <p className="mt-0.5 truncate text-[11px] text-emerald-400">{pendingRestoreFile.name}</p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-zinc-500">Select .json file</p>
                      )}
                    </div>
                  </label>
                  {/* Database card */}
                  <label className={`group flex cursor-pointer flex-col items-center gap-3 rounded-lg border p-4 text-center transition-colors ${
                    pendingRestoreDbFile
                      ? "border-blue-700 bg-blue-950/20"
                      : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                  }`}>
                    <input
                      type="file"
                      accept=".db"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setPendingRestoreDbFile(f);
                      }}
                    />
                    {pendingRestoreDbFile ? (
                      <Check className="h-7 w-7 text-blue-400" />
                    ) : (
                      <Database className="h-7 w-7 text-zinc-500" />
                    )}
                    <div>
                      <p className="text-xs font-medium text-zinc-200">Database File</p>
                      {pendingRestoreDbFile ? (
                        <p className="mt-0.5 truncate text-[11px] text-blue-400">{pendingRestoreDbFile.name}</p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-zinc-500">Select .db (optional)</p>
                      )}
                    </div>
                  </label>
                </div>

                {/* Error */}
                {restoreError && (
                  <p className="mt-3 text-sm text-red-400">{restoreError}</p>
                )}

                {/* Actions */}
                <div className="mt-5 flex items-center justify-between">
                  <p className="text-xs text-zinc-600">
                    {pendingRestoreDbFile ? "Full restore with database" : pendingRestoreFile ? "Config restore" : "Select at least the config file"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setActiveModal(null); setPendingRestoreFile(null); setPendingRestoreDbFile(null); setRestoreError(null); }}
                      className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={!pendingRestoreFile || !restoreName.trim() || busy}
                      onClick={async () => {
                        if (!pendingRestoreFile || !restoreName.trim()) return;
                        setRestoreError(null);
                        setBusy(true);
                        try {
                          const text = await pendingRestoreFile.text();
                          const data = JSON.parse(text);
                          if (!data.config) {
                            setRestoreError("Invalid backup: missing workspace config.");
                            return;
                          }
                          if (pendingRestoreDbFile) {
                            const dbBuffer = await pendingRestoreDbFile.arrayBuffer();
                            await api.workspaces.restoreDb(dbBuffer);
                          }
                          const res = await api.workspaces.restore(data, restoreName.trim());
                          setActiveModal(null);
                          toast(`Workspace "${restoreName.trim()}" restored successfully`);
                          window.location.href = `/workspaces/${res.workspaceId}/kanban`;
                        } catch (err) {
                          setRestoreError(err instanceof Error ? err.message : "Restore failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? "Restoring\u2026" : "Restore"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeModal === "archive-confirm" && (
            <ConfirmDialog
              title="Archive Workspace"
              message="This workspace will be archived and hidden from the workspace list. You can restore it later from the database. Are you sure?"
              confirmLabel="Archive"
              cancelLabel="Cancel"
              onConfirm={async () => {
                setActiveModal(null);
                setBusy(true);
                try {
                  await api.workspaces.archive(workspaceId);
                  toast("Workspace archived");
                  window.location.href = "/dashboard";
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Archive failed", "error");
                } finally {
                  setBusy(false);
                }
              }}
              onCancel={() => setActiveModal(null)}
            />
          )}

        </>,
        document.body,
      )}
    </>
  );
}

// ─── Save-as-template modal (extracted from inline) ─────────────────

function SaveAsTemplateModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.workspaceTemplates.saveFromWorkspace(workspaceId, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setSaved(true);
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-zinc-100">Save Workspace as Template</h3>
        <p className="mt-1 text-sm text-zinc-500">
          Save the current workspace configuration (agents, skills) as a reusable template.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Template Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Custom Workspace"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Description <span className="text-zinc-600">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this template includes..."
              rows={3}
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving || saved}
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {saved ? (
              <>
                <Check className="h-4 w-4" /> Saved
              </>
            ) : saving ? (
              "Saving..."
            ) : (
              "Save Template"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
