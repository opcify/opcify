"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import type { TaskWithAgent } from "@opcify/core";
import { TaskProgress } from "@/components/tasks/task-progress";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { WaitingBadge } from "@/components/tasks/waiting-blocker-badge";
import { TaskTimingStrip } from "@/components/tasks/task-timing-strip";
import { SourceTaskContext } from "./source-task-context";
import { FocusToggle } from "./focus-toggle";
import { MultiAgentBadge } from "./multi-agent-badge";
import { AgentBadge } from "./agent-badge";
import { RecurringBadge } from "@/components/tasks/recurring-badge";

interface InProgressTaskCardProps {
  task: TaskWithAgent;
  isFocus?: boolean;
  onStop: (id: string) => void;
  onToggleFocus?: (id: string, isFocus: boolean) => void;
}

export function InProgressTaskCard({ task, isFocus = false, onStop, onToggleFocus }: InProgressTaskCardProps) {
  const isWaiting = task.status === "waiting";
  const hasQuestion = isWaiting && !!task.blockingQuestion;

  return (
    <div
      className={`group rounded-lg border p-4 transition-colors ${
        hasQuestion
          ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
          : "border-zinc-700 bg-zinc-900 hover:border-zinc-600"
      }`}
    >
      <div>
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
              className="truncate text-sm font-medium text-zinc-100 hover:text-white"
            >
              {task.title}
            </Link>
            <TaskPriorityBadge priority={task.priority} />
            <RecurringBadge recurringRuleId={task.recurringRuleId} />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                hasQuestion
                  ? "bg-amber-500/20 text-amber-300"
                  : isWaiting
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-emerald-500/10 text-emerald-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full animate-pulse ${
                  isWaiting ? "bg-amber-400" : "bg-emerald-400"
                }`}
              />
              {hasQuestion ? "needs input" : isWaiting ? "waiting" : "running"}
            </span>
            {task.waitingReason && !hasQuestion && <WaitingBadge waitingReason={task.waitingReason} />}
          </div>

          {hasQuestion && task.blockingQuestion && (
            <p className="mt-2 line-clamp-2 text-xs text-amber-200">
              “{task.blockingQuestion}”
            </p>
          )}

          {task.executionMode !== "single" && task.executionStepsSummary && (
            <div className="mt-2">
              <MultiAgentBadge executionMode={task.executionMode} summary={task.executionStepsSummary} />
            </div>
          )}

          <div className="mt-3 flex items-center gap-4">
            <TaskProgress value={task.progress} />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <AgentBadge name={task.agent.name} />
            <TaskTimingStrip task={task} variant="running" />
          </div>

          {task.resultSummary && (
            <p className="mt-2 line-clamp-1 text-xs text-zinc-500 italic">
              {task.resultSummary}
            </p>
          )}

          {task.sourceTask && (
            <SourceTaskContext sourceTask={task.sourceTask} compact />
          )}
        </div>

        <div
          className={`mt-2 flex items-center justify-end gap-1.5 sm:mt-0 ${
            hasQuestion ? "" : "sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
          }`}
        >
          {hasQuestion ? (
            <Link
              href={`/tasks/${task.id}?from=kanban`}
              className="rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/30 hover:text-amber-100"
            >
              Respond
            </Link>
          ) : (
            <Link
              href={`/tasks/${task.id}?from=kanban`}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
            >
              Details
            </Link>
          )}
          <button
            onClick={() => onStop(task.id)}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
