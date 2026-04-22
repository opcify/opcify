"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import type { TaskWithAgent, TaskStatus } from "@opcify/core";
import { timeAgo } from "@/lib/time";
import { TaskStatusBadge } from "@/components/tasks/task-status-badge";
import { TaskProgress } from "@/components/tasks/task-progress";

interface AgentTaskHistoryProps {
  tasks: TaskWithAgent[];
}

export function AgentTaskHistory({ tasks }: AgentTaskHistoryProps) {
  if (tasks.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500">
        No tasks executed yet
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs text-zinc-500">
            <th className="pb-2 pr-3 font-medium">Title</th>
            <th className="pb-2 pr-3 font-medium">Status</th>
            <th className="pb-2 pr-3 font-medium">Progress</th>
            <th className="pb-2 pr-3 font-medium">Updated</th>
            <th className="pb-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr
              key={t.id}
              className="border-b border-zinc-800/50 last:border-0"
            >
              <td className="max-w-[220px] py-2.5 pr-3">
                <Link
                  href={`/tasks/${t.id}`}
                  className="block truncate text-sm text-zinc-200 hover:text-white"
                  title={t.title}
                >
                  {t.title}
                </Link>
              </td>
              <td className="py-2.5 pr-3">
                <TaskStatusBadge status={t.status as TaskStatus} />
              </td>
              <td className="py-2.5 pr-3">
                <TaskProgress value={t.progress} />
              </td>
              <td className="py-2.5 pr-3">
                <span className="text-xs text-zinc-500">{timeAgo(t.updatedAt)}</span>
              </td>
              <td className="max-w-[200px] py-2.5">
                {t.resultSummary ? (
                  <div className="truncate text-xs text-zinc-500" title={t.resultSummary}>
                    {t.resultSummary}
                  </div>
                ) : (
                  <span className="text-xs text-zinc-700">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
