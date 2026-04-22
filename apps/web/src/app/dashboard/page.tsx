"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceSummary, WorkspaceTemplateDetail } from "@opcify/core";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { WorkspaceCard } from "@/components/workspace-card";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";
import {
  Gem,
  Plus,
  LayoutDashboard,
  Workflow,
  Loader2,
  Archive,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const templateIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  workflow: Workflow,
  "layout-dashboard": LayoutDashboard,
};

function TemplateQuickCard({ template }: { template: WorkspaceTemplateDetail }) {
  const Icon = templateIcons[template.icon] || LayoutDashboard;
  const agentCount = template.config?.agents?.length ?? 0;
  const skillCount = template.config?.skills?.length ?? 0;

  return (
    <Link
      href={`/workspaces/catalog?template=${template.key}`}
      className="group flex flex-col rounded-lg border border-border-muted bg-surface-raised p-4 transition-all hover:border-border-theme hover:bg-surface-overlay/80"
    >
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-surface-overlay text-tertiary group-hover:bg-surface-inset group-hover:text-secondary">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <h4 className="text-sm font-medium text-secondary">{template.name}</h4>
      <p className="mt-1 line-clamp-2 text-xs text-muted">
        {template.description}
      </p>
      <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-muted">
        {agentCount > 0 && <span>{agentCount} agents</span>}
        {skillCount > 0 && <span>{skillCount} skills</span>}
      </div>
    </Link>
  );
}

export default function WorkspaceHomeWrapper() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>}>
      <WorkspaceHomePage />
    </Suspense>
  );
}

function WorkspaceHomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const skipDefault = searchParams.get("home") === "1";
  const [checkedDefault, setCheckedDefault] = useState(skipDefault);

  useEffect(() => {
    if (skipDefault) return;
    api.workspaces.getDefault().then((res) => {
      if (res.workspaceId) {
        router.replace(`/workspaces/${res.workspaceId}/kanban`);
      } else {
        setCheckedDefault(true);
      }
    }).catch(() => {
      setCheckedDefault(true);
    });
  }, [skipDefault, router]);

  const { data: workspaces, loading: wsLoading, error: wsError, refetch: refetchWorkspaces } = useApi<WorkspaceSummary[]>(
    () => api.workspaces.list(),
    [],
  );
  const { data: templates } = useApi<WorkspaceTemplateDetail[]>(
    () => api.workspaceTemplates.list(),
    [],
  );
  const { data: archivedWorkspaces, refetch: refetchArchived } = useApi<WorkspaceSummary[]>(
    () => api.workspaces.listArchived(),
    [],
  );

  const [showArchived, setShowArchived] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const readyWorkspaces = workspaces?.filter((w) => w.status !== "archived") ?? [];
  const displayTemplates = (templates?.filter((t) => t.key !== "blank") ?? [])
    .sort((a, b) => (a.key === "opcify_starter" ? -1 : b.key === "opcify_starter" ? 1 : 0));

  if (!checkedDefault) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Gem className="h-5 w-5 shrink-0 text-emerald-400 sm:h-6 sm:w-6" />
            Opcify
          </h1>
          <p className="mt-0.5 hidden text-sm text-muted sm:block">
            AI Workspace Platform
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline-flex"><ThemeSwitcher /></span>
          <UserProfileDropdown compact />
          <Link
            href="/workspaces/catalog"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
          >
            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">New Workspace</span>
            <span className="sm:hidden">New</span>
          </Link>
        </div>
      </div>

      {/* Workspaces */}
      <section className="mt-6 sm:mt-10">
        <h2 className="text-base font-semibold text-secondary sm:text-lg">Your Workspaces</h2>
        <p className="mt-0.5 text-xs text-muted sm:mt-1 sm:text-sm">
          Open a workspace to manage agents, tasks, and workflows.
        </p>

        {wsLoading ? (
          <div className="mt-6 flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        ) : wsError ? (
          <div className="mt-6 rounded-lg border border-red-900/50 bg-red-900/20 px-6 py-8 text-center">
            <p className="text-sm text-red-300">Could not connect to the API server</p>
            <p className="mt-1 text-xs text-red-400/70">{wsError}</p>
            <p className="mt-3 text-xs text-zinc-500">
              Make sure the API is running: <code className="rounded bg-zinc-800 px-1.5 py-0.5">pnpm dev:api</code>
            </p>
          </div>
        ) : readyWorkspaces.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-border-theme bg-surface-raised/50 px-6 py-12 text-center">
            <LayoutDashboard className="mx-auto h-10 w-10 text-muted" />
            <h3 className="mt-3 text-sm font-medium text-secondary">
              No workspaces yet
            </h3>
            <p className="mt-1 text-sm text-muted">
              Create your first workspace to get started.
            </p>
            <Link
              href="/workspaces/catalog"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-surface-overlay px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-inset"
            >
              <Plus className="h-4 w-4" />
              Create Workspace
            </Link>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {readyWorkspaces.map((ws) => (
              <WorkspaceCard key={ws.id} workspace={ws} onDefaultChange={refetchWorkspaces} />
            ))}
          </div>
        )}
      </section>

      {/* Templates */}
      {displayTemplates.length > 0 && (
        <section className="mt-8 sm:mt-12">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-secondary sm:text-lg">
                Workspace Templates
              </h2>
              <p className="mt-0.5 text-xs text-muted sm:mt-1 sm:text-sm">
                Start with a pre-configured workspace blueprint.
              </p>
            </div>
            <Link
              href="/workspaces/catalog"
              className="text-sm text-tertiary hover:text-secondary"
            >
              View all
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {displayTemplates.map((t) => (
              <TemplateQuickCard key={t.key} template={t} />
            ))}
          </div>
        </section>
      )}

      {/* Archived Workspaces */}
      {(archivedWorkspaces?.length ?? 0) > 0 && (
        <section className="mt-8 sm:mt-12">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex items-center gap-2 text-sm text-muted hover:text-secondary transition-colors"
          >
            <Archive className="h-4 w-4" />
            Archived Workspaces ({archivedWorkspaces!.length})
            {showArchived ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {showArchived && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {archivedWorkspaces!.map((ws) => (
                <div
                  key={ws.id}
                  className="relative rounded-lg border border-border-muted bg-surface-raised/50 p-5 opacity-70"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-primary">
                          {ws.name}
                        </h3>
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-zinc-500">
                          <Archive className="h-3 w-3" />
                          Archived
                        </span>
                      </div>
                      {ws.description && (
                        <p className="mt-1 truncate text-sm text-muted">
                          {ws.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-muted">
                      {ws.agentCount} agents, {ws.taskCount} tasks
                    </span>
                    <button
                      onClick={async () => {
                        setRestoringId(ws.id);
                        try {
                          await api.workspaces.restoreArchive(ws.id);
                          refetchWorkspaces();
                          refetchArchived();
                        } catch {
                          // Restore failed
                        } finally {
                          setRestoringId(null);
                        }
                      }}
                      disabled={restoringId === ws.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-surface-overlay px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-inset disabled:opacity-50"
                    >
                      {restoringId === ws.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
