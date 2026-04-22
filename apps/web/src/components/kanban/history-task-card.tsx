"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import type { TaskWithAgent } from "@opcify/core";
import { TaskStatusBadge } from "@/components/tasks/task-status-badge";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { ReviewStatusBadge } from "@/components/tasks/review-status-badge";
import { SourceTaskContext } from "./source-task-context";
import { MultiAgentBadge } from "./multi-agent-badge";
import { timeAgo } from "@/lib/time";

interface HistoryTaskCardProps {
  task: TaskWithAgent;
  showRetry?: boolean;
  showAccept?: boolean;
  showFollowUp?: boolean;
  showReviewBadge?: boolean;
  onRetry?: (id: string, overrideInstruction?: string) => void;
  onAccept?: (id: string) => void;
  onFollowUp?: () => void;
}

export function HistoryTaskCard({
  task,
  showRetry,
  showAccept,
  showFollowUp,
  showReviewBadge,
  onRetry,
  onAccept,
  onFollowUp,
}: HistoryTaskCardProps) {
  const hasActions = showRetry || showAccept || showFollowUp;

  return (
    <div className="group rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700/80">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <Link
            href={`/tasks/${task.id}?from=kanban`}
            className="truncate text-sm font-medium text-zinc-300 hover:text-white"
          >
            {task.title}
          </Link>
          <TaskPriorityBadge priority={task.priority} />
          <TaskStatusBadge status={task.status} />
          {showReviewBadge && task.status === "done" && task.reviewStatus && (
            <ReviewStatusBadge status={task.reviewStatus} />
          )}
        </div>
        {task.resultSummary && (
          <p className="mt-1.5 line-clamp-1 text-xs text-zinc-500">
            {task.resultSummary}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-medium text-zinc-500">
              {task.agent.name.charAt(0).toUpperCase()}
            </span>
            <span className="max-w-[120px] truncate">{task.agent.name}</span>
          </span>
          {task.finishedAt && (
            <>
              <span className="text-zinc-700">·</span>
              <span>{timeAgo(task.finishedAt)}</span>
            </>
          )}
          {task.executionMode !== "single" && task.executionStepsSummary && (
            <MultiAgentBadge executionMode={task.executionMode} summary={task.executionStepsSummary} />
          )}
        </div>

        {task.sourceTask && (
          <SourceTaskContext sourceTask={task.sourceTask} compact />
        )}
      </div>

      <div className={`mt-2 flex flex-wrap items-center justify-end gap-1.5 ${hasActions ? "" : "sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"}`}>
        {showAccept && onAccept && (
          <button
            onClick={() => onAccept(task.id)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Accept
          </button>
        )}
        <Link
          href={`/tasks/${task.id}?from=kanban`}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
        >
          View
        </Link>
        {showRetry && onRetry && (
          <button
            onClick={() => onRetry(task.id)}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            Retry
          </button>
        )}
        {showFollowUp && onFollowUp && (
          <button
            onClick={onFollowUp}
            className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:border-blue-500/50 hover:bg-blue-500/20"
          >
            Follow-up
          </button>
        )}
      </div>
    </div>
  );
}
