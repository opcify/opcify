"use client";

import type { TaskWithAgent } from "@opcify/core";
import { WsLink } from "@/lib/workspace-link";
import { AgentBadge } from "./agent-badge";
import { TaskTimingStrip } from "@/components/tasks/task-timing-strip";

interface FailedTaskCardProps {
  task: TaskWithAgent;
  onRetry: (id: string) => void;
}

export function FailedTaskCard({ task, onRetry }: FailedTaskCardProps) {
  const isStopped = task.status === "stopped";
  return (
    <div
      className={`rounded-lg border p-3 ${
        isStopped
          ? "border-orange-500/20 bg-orange-500/5"
          : "border-red-500/20 bg-red-500/5"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <WsLink
            href={`/tasks/${task.id}?from=kanban`}
            className="text-sm font-medium text-zinc-200 hover:text-white"
          >
            {task.title}
          </WsLink>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <AgentBadge name={task.agent.name} />
            <span
              className={`h-1.5 w-1.5 rounded-full ${isStopped ? "bg-orange-400" : "bg-red-400"}`}
            />
            <span className={isStopped ? "text-orange-400" : "text-red-400"}>
              {isStopped ? task.resultSummary || "stopped" : "failed"}
            </span>
            <TaskTimingStrip task={task} variant="failed" />
          </div>
        </div>
        <button
          onClick={() => onRetry(task.id)}
          className="shrink-0 rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
        >
          {isStopped ? "Resume" : "Retry"}
        </button>
      </div>
    </div>
  );
}
