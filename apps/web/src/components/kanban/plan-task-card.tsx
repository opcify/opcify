"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import type { TaskWithAgent } from "@opcify/core";
import { TaskStatusBadge } from "@/components/tasks/task-status-badge";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { WaitingBadge } from "@/components/tasks/waiting-blocker-badge";
import { TaskTimingStrip } from "@/components/tasks/task-timing-strip";
import { SourceTaskContext } from "./source-task-context";
import { FocusToggle } from "./focus-toggle";
import { MultiAgentBadge } from "./multi-agent-badge";
import { AgentBadge } from "./agent-badge";
import { RecurringBadge } from "@/components/tasks/recurring-badge";

interface PlanTaskCardProps {
  task: TaskWithAgent;
  isFocus?: boolean;
  onStart: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleFocus?: (id: string, isFocus: boolean) => void;
}

export function PlanTaskCard({ task, isFocus = false, onStart, onDelete, onToggleFocus }: PlanTaskCardProps) {
  const accentBorder = task.priority === "high" ? "border-l-2 border-l-red-500/60" : task.priority === "low" ? "border-l-2 border-l-zinc-700" : "";

  return (
    <div className={`group rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700 ${accentBorder}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {onToggleFocus && (
            <FocusToggle
              isFocus={isFocus}
              onToggle={() => onToggleFocus(task.id, !isFocus)}
            />
          )}
          <Link
            href={`/tasks/${task.id}?from=kanban`}
            className="truncate text-sm font-medium text-zinc-200 hover:text-white"
          >
            {task.title}
          </Link>
          <TaskPriorityBadge priority={task.priority} />
          <TaskStatusBadge status={task.status} />
          <RecurringBadge recurringRuleId={task.recurringRuleId} />
          {task.waitingReason && <WaitingBadge waitingReason={task.waitingReason} />}
        </div>
        {task.description && (
          <p className="mt-1 line-clamp-1 text-xs text-zinc-500">
            {task.description}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <AgentBadge name={task.agent.name} />
          {task.executionMode !== "single" && task.executionStepsSummary && (
            <MultiAgentBadge executionMode={task.executionMode} summary={task.executionStepsSummary} />
          )}
          <TaskTimingStrip task={task} variant="queued" />
        </div>

        {task.sourceTask && (
          <SourceTaskContext sourceTask={task.sourceTask} compact />
        )}
      </div>

      <div className="mt-2 flex items-center justify-end gap-1.5 sm:mt-0 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
        <button
          onClick={() => onStart(task.id)}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          Start
        </button>
        <Link
          href={`/tasks/${task.id}?from=kanban`}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
        >
          View
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
