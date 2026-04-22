"use client";

import type { TaskWithAgent } from "@opcify/core";
import { WsLink as Link } from "@/lib/workspace-link";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { TaskStatusBadge } from "@/components/tasks/task-status-badge";
import { TaskTimingStrip } from "@/components/tasks/task-timing-strip";
import { AgentBadge } from "../agent-badge";
import { SourceTaskContext } from "../source-task-context";

export function AssignedTaskRow({ task }: { task: TaskWithAgent }) {
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
          <TaskPriorityBadge priority={task.priority} />
          <TaskStatusBadge status={task.status} />
          {task.sourceTask && (
            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
              Follow-up
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          <AgentBadge name={task.agent.name} />
          <TaskTimingStrip task={task} variant="queued" />
        </div>
        {task.sourceTask && (
          <SourceTaskContext sourceTask={task.sourceTask} compact />
        )}
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
