"use client";

import type { TaskWithAgent } from "@opcify/core";
import { WsLink as Link } from "@/lib/workspace-link";
import { TaskTimingStrip } from "@/components/tasks/task-timing-strip";
import type { TaskTimingVariant } from "@/components/tasks/task-timing-strip";
import { AgentBadge } from "../agent-badge";

interface AttentionTaskRowProps {
  task: TaskWithAgent;
  onAccept: (id: string) => void;
  onRetry: (id: string) => void;
  onFollowUp: () => void;
}

export function AttentionTaskRow({
  task,
  onAccept,
  onRetry,
  onFollowUp,
}: AttentionTaskRowProps) {
  const problemType =
    task.status === "failed"
      ? "Failed"
      : task.reviewStatus === "rejected"
        ? "Rejected"
        : "Pending Review";

  const problemColor =
    task.status === "failed"
      ? "text-red-400 bg-red-500/10"
      : task.reviewStatus === "rejected"
        ? "text-orange-400 bg-orange-500/10"
        : "text-amber-400 bg-amber-500/10";

  const canRetry = task.status === "failed";
  const canAccept = task.status === "done" && task.reviewStatus === "pending";
  const canFollowUp =
    task.status === "done" &&
    (task.reviewStatus === "pending" || task.reviewStatus === "rejected");

  const variant: TaskTimingVariant =
    task.status === "failed"
      ? "failed"
      : task.status === "done"
        ? "review"
        : "running";

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
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${problemColor}`}
          >
            {problemType}
          </span>
        </div>
        {task.resultSummary && (
          <p className="mt-1 line-clamp-1 text-xs text-zinc-500">
            {task.resultSummary}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          <AgentBadge name={task.agent.name} />
          <TaskTimingStrip task={task} variant={variant} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {canAccept && (
          <button
            onClick={() => onAccept(task.id)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Accept
          </button>
        )}
        <Link
          href={`/tasks/${task.id}?from=kanban`}
          className="rounded-md bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
        >
          View
        </Link>
        {canRetry && (
          <button
            onClick={() => onRetry(task.id)}
            className="rounded-md bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
          >
            Retry
          </button>
        )}
        {canFollowUp && (
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
