"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import type { TaskWithAgent } from "@opcify/core";
import { TaskStatusBadge } from "@/components/tasks/task-status-badge";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { WaitingBadge } from "@/components/tasks/waiting-blocker-badge";

interface FuturePlannedTaskCardProps {
  task: TaskWithAgent;
  onDelete: (id: string) => void;
}

export function FuturePlannedTaskCard({ task, onDelete }: FuturePlannedTaskCardProps) {
  return (
    <div className="group rounded-lg border border-blue-500/15 bg-blue-500/5 p-4 transition-colors hover:border-blue-500/25">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <Link
            href={`/tasks/${task.id}?from=kanban`}
            className="truncate text-sm font-medium text-zinc-200 hover:text-white"
          >
            {task.title}
          </Link>
          <TaskPriorityBadge priority={task.priority} />
          <TaskStatusBadge status={task.status} />
          {task.waitingReason && <WaitingBadge waitingReason={task.waitingReason} />}
        </div>
        {task.description && (
          <p className="mt-1 line-clamp-1 text-xs text-zinc-500">
            {task.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-medium text-zinc-400">
              {task.agent.name.charAt(0).toUpperCase()}
            </span>
            <span className="max-w-[120px] truncate">{task.agent.name}</span>
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1.5 sm:mt-0 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
        <Link
          href={`/tasks/${task.id}?from=kanban`}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
        >
          Edit
        </Link>
        <button
          onClick={() => onDelete(task.id)}
          className="rounded-md px-2 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
