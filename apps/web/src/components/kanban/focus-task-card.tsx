"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import type { TaskWithAgent, TaskStatus } from "@opcify/core";
import { TaskStatusBadge } from "@/components/tasks/task-status-badge";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { RecurringBadge } from "@/components/tasks/recurring-badge";
import {
  TaskTimingStrip,
  type TaskTimingVariant,
} from "@/components/tasks/task-timing-strip";
import { AgentBadge } from "./agent-badge";
import { FocusToggle } from "./focus-toggle";

function variantForStatus(status: TaskStatus): TaskTimingVariant {
  if (status === "running" || status === "waiting") return "running";
  if (status === "failed" || status === "stopped") return "failed";
  if (status === "done") return "completed";
  return "queued";
}

interface FocusTaskCardProps {
  task: TaskWithAgent;
  onUnfocus: (id: string) => void;
  onStart?: (id: string) => void;
}

export function FocusTaskCard({ task, onUnfocus, onStart }: FocusTaskCardProps) {
  const canStart = task.status === "queued";

  return (
    <div className="group rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 transition-colors hover:border-amber-500/30">
      <div className="flex items-start gap-3">
        <FocusToggle isFocus onToggle={() => onUnfocus(task.id)} />

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
            <RecurringBadge recurringRuleId={task.recurringRuleId} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <AgentBadge name={task.agent.name} />
            <TaskTimingStrip task={task} variant={variantForStatus(task.status)} />
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1.5 sm:mt-0 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
        {canStart && onStart && (
          <button
            onClick={() => onStart(task.id)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Start
          </button>
        )}
        <Link
          href={`/tasks/${task.id}?from=kanban`}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
        >
          View
        </Link>
      </div>
    </div>
  );
}
