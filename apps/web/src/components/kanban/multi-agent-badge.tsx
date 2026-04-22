"use client";

import { Sparkles } from "lucide-react";
import type { TaskExecutionStepSummary, ExecutionMode } from "@opcify/core";

interface MultiAgentBadgeProps {
  executionMode: ExecutionMode;
  summary: TaskExecutionStepSummary;
}

export function MultiAgentBadge({ executionMode, summary }: MultiAgentBadgeProps) {
  if (executionMode === "single") return null;

  const label = executionMode === "orchestrated" ? "Auto" : "Multi-Agent";
  const progressText = `${summary.completed}/${summary.total}`;
  const hasRunning = summary.running > 0 && summary.currentAgentName;

  // Build step dots: completed (green), running (blue pulse), pending (gray)
  const pending = summary.total - summary.completed - summary.running;
  const dots: Array<"completed" | "running" | "pending"> = [
    ...Array(summary.completed).fill("completed" as const),
    ...Array(summary.running).fill("running" as const),
    ...Array(Math.max(0, pending)).fill("pending" as const),
  ];

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">
      <span className="flex h-3 w-3 items-center justify-center rounded-full bg-violet-500/20"><Sparkles className="h-1.5 w-1.5" /></span>
      <span>{label}</span>
      <span className="text-violet-500/60">·</span>
      <span>{progressText} steps</span>
      {summary.total > 0 && summary.total <= 10 && (
        <>
          <span className="text-violet-500/60">·</span>
          <span className="inline-flex items-center gap-0.5">
            {dots.map((status, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "completed"
                    ? "bg-emerald-400"
                    : status === "running"
                      ? "bg-blue-400 animate-pulse"
                      : "bg-zinc-600"
                }`}
              />
            ))}
          </span>
        </>
      )}
      {hasRunning && (
        <>
          <span className="text-violet-500/60">·</span>
          <span className="max-w-[80px] truncate text-violet-300">{summary.currentAgentName}</span>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
        </>
      )}
    </span>
  );
}
