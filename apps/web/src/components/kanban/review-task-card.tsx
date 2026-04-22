"use client";

import { useState } from "react";
import { WsLink as Link } from "@/lib/workspace-link";
import type { TaskWithAgent } from "@opcify/core";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { TaskTimingStrip } from "@/components/tasks/task-timing-strip";
import { SourceTaskContext } from "./source-task-context";
import { FocusToggle } from "./focus-toggle";
import { MultiAgentBadge } from "./multi-agent-badge";
import { AgentBadge } from "./agent-badge";
import { RecurringBadge } from "@/components/tasks/recurring-badge";

interface ReviewTaskCardProps {
  task: TaskWithAgent;
  isFocus?: boolean;
  onAccept: (id: string) => void;
  onRetry: (id: string, overrideInstruction?: string) => void;
  onFollowUp: (task: TaskWithAgent) => void;
  onToggleFocus?: (id: string, isFocus: boolean) => void;
}

export function ReviewTaskCard({ task, isFocus = false, onAccept, onRetry, onFollowUp, onToggleFocus }: ReviewTaskCardProps) {
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showRetryInput, setShowRetryInput] = useState(false);
  const [retryInstruction, setRetryInstruction] = useState("");

  async function handleAction(action: string, handler: () => void) {
    if (actionInFlight) return;
    setActionInFlight(action);
    try {
      handler();
    } finally {
      window.setTimeout(() => setActionInFlight(null), 600);
    }
  }

  return (
    <div className="group rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 transition-colors hover:border-amber-500/30">
      {/* Title + badges */}
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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          needs review
        </span>
      </div>

      {/* Result summary */}
      {task.resultSummary && (
        <div className="mt-2">
          <p
            className={`rounded-md bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400 ${expanded ? "" : "line-clamp-2"}`}
          >
            {task.resultSummary}
          </p>
          {task.resultSummary.length > 150 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-[11px] text-zinc-600 hover:text-zinc-400"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {/* Agent info */}
      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <AgentBadge name={task.agent.name} />
        <TaskTimingStrip task={task} variant="review" />
        {task.executionMode !== "single" && task.executionStepsSummary && (
          <MultiAgentBadge executionMode={task.executionMode} summary={task.executionStepsSummary} />
        )}
      </div>

      {task.sourceTask && (
        <SourceTaskContext sourceTask={task.sourceTask} />
      )}

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => handleAction("accept", () => onAccept(task.id))}
          disabled={actionInFlight !== null}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {actionInFlight === "accept" ? "Accepting…" : "Accept"}
        </button>
        <Link
          href={`/tasks/${task.id}?from=kanban`}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
        >
          View
        </Link>
        <button
          onClick={() => setShowRetryInput(!showRetryInput)}
          disabled={actionInFlight !== null}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
        >
          Retry
        </button>
        <button
          onClick={() => onFollowUp(task)}
          disabled={actionInFlight !== null}
          className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:border-blue-500/50 hover:bg-blue-500/20 disabled:opacity-50"
        >
          Follow-up
        </button>
      </div>

      {/* Retry input */}
      {showRetryInput && (
        <div className="mt-3 border-t border-zinc-800/50 pt-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={retryInstruction}
              onChange={(e) => setRetryInstruction(e.target.value)}
              placeholder="Make it shorter, use bullet points, focus on SEO…"
              className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAction("retry", () => onRetry(task.id, retryInstruction.trim() || undefined));
                  setRetryInstruction("");
                  setShowRetryInput(false);
                }
              }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  handleAction("retry", () => onRetry(task.id, retryInstruction.trim() || undefined));
                  setRetryInstruction("");
                  setShowRetryInput(false);
                }}
                disabled={actionInFlight !== null}
                className="shrink-0 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
              >
                {actionInFlight === "retry" ? "Retrying…" : "Retry"}
              </button>
              <button
                onClick={() => { setShowRetryInput(false); setRetryInstruction(""); }}
                className="shrink-0 rounded-md px-2 py-1.5 text-xs text-zinc-600 hover:text-zinc-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
