"use client";

import type { TaskWithAgent } from "@opcify/core";
import { WsLink as Link } from "@/lib/workspace-link";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { TaskStatusBadge } from "@/components/tasks/task-status-badge";
import { TaskTimingStrip } from "@/components/tasks/task-timing-strip";
import { AgentBadge } from "../agent-badge";

export function InProgressTaskRow({ task }: { task: TaskWithAgent }) {
  const variant = task.status === "running" ? "running" : "queued";
  return (
    <div className="group flex items-start gap-4 px-4 py-3 transition-colors hover:bg-zinc-900/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/tasks/${task.id}?from=kanban`}
            className="truncate text-sm font-medium text-zinc-300 hover:text-white"
          >
            {task.title}
          </Link>
          <TaskStatusBadge status={task.status} />
          <TaskPriorityBadge priority={task.priority} />
        </div>
        {task.progress > 0 && task.progress < 100 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 w-24 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-amber-500/60 transition-all"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-zinc-600">
              {task.progress}%
            </span>
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          <AgentBadge name={task.agent.name} />
          <TaskTimingStrip task={task} variant={variant} />
        </div>
      </div>
      <Link
        href={`/tasks/${task.id}?from=kanban`}
        className="shrink-0 rounded-md bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-500 opacity-0 transition-all hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
      >
        View
      </Link>
    </div>
  );
}
