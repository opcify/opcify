"use client";

import Link from "next/link";
import type { WorkspaceSummary } from "@opcify/core";
import { api } from "@/lib/api";
import {
  LayoutDashboard,
  Bot,
  ListTodo,
  ChevronRight,
  Loader2,
  AlertCircle,
  Archive,
  FileEdit,
  Star,
} from "lucide-react";

const statusConfig: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ComponentType<{ className?: string }> }
> = {
  ready: { label: "Ready", color: "text-emerald-400", bg: "bg-emerald-400/10", icon: LayoutDashboard },
  draft: { label: "Draft", color: "text-zinc-400", bg: "bg-zinc-400/10", icon: FileEdit },
  provisioning: { label: "Setting up...", color: "text-amber-400", bg: "bg-amber-400/10", icon: Loader2 },
  failed: { label: "Failed", color: "text-red-400", bg: "bg-red-400/10", icon: AlertCircle },
  archived: { label: "Archived", color: "text-zinc-500", bg: "bg-zinc-500/10", icon: Archive },
};

export function WorkspaceCard({
  workspace,
  onDefaultChange,
}: {
  workspace: WorkspaceSummary;
  onDefaultChange?: () => void;
}) {
  const status = statusConfig[workspace.status] || statusConfig.draft;
  const isClickable = workspace.status === "ready";
  const href = `/workspaces/${workspace.id}/kanban`;

  async function handleStarClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (workspace.isDefault) return;
    await api.workspaces.setDefault(workspace.id);
    onDefaultChange?.();
  }

  const card = (
    <div
      className={`group relative rounded-lg border border-border-muted bg-surface-raised p-5 transition-all ${
        isClickable
          ? "cursor-pointer hover:border-border-theme hover:bg-surface-overlay/80"
          : "opacity-75"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-base font-semibold text-primary" style={{ maxWidth: "16ch" }} title={workspace.name}>
              {workspace.name}
            </h3>
            <button
              onClick={handleStarClick}
              className="shrink-0 p-0.5 transition-transform hover:scale-110"
              title={workspace.isDefault ? "Default workspace" : "Set as default"}
            >
              <Star
                className={`h-3.5 w-3.5 ${
                  workspace.isDefault
                    ? "fill-amber-400 text-amber-400"
                    : "text-zinc-600 hover:text-amber-400/60"
                }`}
              />
            </button>
            {workspace.status === "ready" ? (
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" title="Ready" />
            ) : (
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.bg} ${status.color}`}
              >
                {workspace.status === "provisioning" && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {status.label}
              </span>
            )}
          </div>
          {workspace.description && (
            <p className="mt-1 text-sm text-muted line-clamp-2 sm:truncate">
              {workspace.description}
            </p>
          )}
        </div>
        {isClickable && (
          <ChevronRight className="h-5 w-5 shrink-0 text-muted transition-colors group-hover:text-tertiary" />
        )}
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Bot className="h-3.5 w-3.5" />
          {workspace.agentCount} agents
        </span>
        <span className="inline-flex items-center gap-1">
          <ListTodo className="h-3.5 w-3.5" />
          {workspace.taskCount} tasks
        </span>
      </div>
    </div>
  );

  if (isClickable) {
    return <Link href={href}>{card}</Link>;
  }

  return card;
}
