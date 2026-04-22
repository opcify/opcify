"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/use-api";
import { api } from "@/lib/api";
import { useOptionalWorkspace } from "@/lib/workspace-context";
import {
  ChevronsUpDown,
  Check,
  Home,
  Plus,
  Loader2,
  Pencil,
  Star,
} from "lucide-react";

export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const wsCtx = useOptionalWorkspace();
  const { data: workspaces, refetch } = useApi(() => api.workspaces.list(), []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setRenaming(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const readyWorkspaces = workspaces?.filter((w) => w.status === "ready") ?? [];
  const current = readyWorkspaces.find((w) => w.id === wsCtx?.workspaceId);

  const startRename = useCallback(() => {
    if (!current) return;
    setRenameValue(current.name);
    setRenaming(true);
    setOpen(false);
  }, [current]);

  async function submitRename() {
    if (!current || !renameValue.trim() || saving) return;
    const trimmed = renameValue.trim();
    if (trimmed === current.name) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    try {
      await api.workspaces.update(current.id, { name: trimmed });
      await refetch();
      setRenaming(false);
    } catch {
      // keep editing on failure
    } finally {
      setSaving(false);
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitRename();
    } else if (e.key === "Escape") {
      setRenaming(false);
    }
  }

  if (renaming) {
    return (
      <div className="relative" ref={ref}>
        <div className="flex items-center gap-1.5 rounded-md border border-emerald-600/50 bg-surface-overlay px-2 py-1.5">
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={submitRename}
            disabled={saving}
            className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder-muted"
            placeholder="Workspace name"
          />
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" />
          ) : (
            <button
              onClick={submitRename}
              className="shrink-0 rounded p-0.5 text-emerald-400 hover:bg-zinc-700"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        onDoubleClick={(e) => {
          e.preventDefault();
          startRename();
        }}
        className="flex w-full items-center gap-2 rounded-md border border-border-theme bg-surface-overlay/50 px-3 py-2 text-sm text-secondary transition-colors hover:border-surface-inset hover:bg-surface-overlay"
      >
        <span className="flex-1 truncate text-left">
          {current?.name || "Select Workspace"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border-theme bg-surface-raised py-1 shadow-xl">
          <Link
            href="/?home=1"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-tertiary hover:bg-surface-overlay hover:text-secondary"
          >
            <Home className="h-3.5 w-3.5" />
            Workspace Home
          </Link>

          <div className="my-1 border-t border-border-muted" />

          {!workspaces && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
            </div>
          )}

          {readyWorkspaces.map((w) => (
            <div
              key={w.id}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-secondary hover:bg-surface-overlay"
            >
              <button
                className="flex-1 truncate text-left"
                onClick={() => {
                  setOpen(false);
                  router.push(`/workspaces/${w.id}/kanban`);
                }}
              >
                {w.name}
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!w.isDefault) {
                    await api.workspaces.setDefault(w.id);
                    refetch();
                  }
                }}
                className="shrink-0 p-0.5 transition-colors hover:scale-110"
                title={w.isDefault ? "Default workspace" : "Set as default"}
              >
                <Star className={`h-3.5 w-3.5 ${w.isDefault ? "fill-amber-400 text-amber-400" : "text-zinc-600 hover:text-amber-400/60"}`} />
              </button>
            </div>
          ))}

          {current && (
            <>
              <div className="my-1 border-t border-border-muted" />
              <button
                onClick={() => {
                  startRename();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <Pencil className="h-3.5 w-3.5" />
                Rename Workspace
              </button>
            </>
          )}

          <div className="my-1 border-t border-border-muted" />

          <Link
            href="/workspaces/catalog"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-tertiary hover:bg-surface-overlay hover:text-secondary"
          >
            <Plus className="h-3.5 w-3.5" />
            New Workspace
          </Link>
        </div>
      )}
    </div>
  );
}
