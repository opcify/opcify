"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatDate } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import { useWorkspace } from "@/lib/workspace-context";

export default function TaskGroupsPage() {
  const timezone = useTimezone();
  const { workspaceId } = useWorkspace();
  const { data: groups, loading, error } = useApi(
    () => api.taskGroups.list(workspaceId),
    [workspaceId],
  );

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-zinc-800" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  if (error) return <p className="text-red-400">Failed to load: {error}</p>;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Task Groups</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Groups of related tasks created from decomposition
          </p>
        </div>
      </div>

      {groups && groups.length > 0 ? (
        <div className="mt-6 space-y-3">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={`/task-groups/${group.id}`}
              className="group block rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700"
            >
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium text-zinc-200 group-hover:text-white">
                  {group.title}
                </h2>
                <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                  {group.type}
                </span>
              </div>
              {group.description && (
                <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500">
                  {group.description}
                </p>
              )}
              <div className="mt-2 text-[10px] text-zinc-600">
                Created{" "}
                {formatDate(group.createdAt, timezone)}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
          <p className="text-lg font-medium text-zinc-400">No task groups yet</p>
          <p className="mt-2 text-sm text-zinc-600">
            Task groups are created when you decompose a task and create the resulting sub-tasks.
          </p>
        </div>
      )}
    </>
  );
}
