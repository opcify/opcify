"use client";

import { Check } from "lucide-react";
import type { TaskWithAgent } from "@opcify/core";
import { WsLink as Link } from "@/lib/workspace-link";
import { ReviewStatusBadge } from "@/components/tasks/review-status-badge";
import { TaskTimingStrip } from "@/components/tasks/task-timing-strip";
import { AgentBadge } from "../agent-badge";

export function CompletedTaskRow({ task }: { task: TaskWithAgent }) {
  return (
    <div className="group flex items-start gap-4 px-4 py-3 transition-colors hover:bg-zinc-900/40">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
        <Check className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/tasks/${task.id}?from=kanban`}
            className="truncate text-sm font-medium text-zinc-300 hover:text-white"
          >
            {task.title}
          </Link>
          {task.reviewStatus && <ReviewStatusBadge status={task.reviewStatus} />}
        </div>
        {task.resultSummary && (
          <p className="mt-1 line-clamp-1 text-xs text-zinc-500">
            {task.resultSummary}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          <AgentBadge name={task.agent.name} />
          <TaskTimingStrip task={task} variant="completed" />
        </div>
      </div>
      <Link
        href={`/tasks/${task.id}?from=kanban`}
        className="shrink-0 rounded-md bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-500 opacity-0 transition-all hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
      >
        View Result
      </Link>
    </div>
  );
}
