"use client";

import { useWorkspaceRouter } from "@/lib/workspace-router";
import type { TaskWithAgent, TaskStatus } from "@opcify/core";
import { timeAgo } from "@/lib/time";
import { TaskProgress } from "./task-progress";
import { TaskPriorityBadge } from "./task-priority-badge";
import { ReviewStatusBadge } from "./review-status-badge";
import { TaskActionsMenu } from "./task-actions-menu";
import { FocusToggle } from "@/components/kanban/focus-toggle";
import { TaskGroupBadge } from "@/components/task-groups/task-group-badge";

interface TaskBoardCardProps {
  task: TaskWithAgent;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onStop?: (id: string) => void;
  onToggleFocus?: (id: string, isFocus: boolean) => void;
}

export function TaskBoardCard({ task, onStatusChange, onStop, onToggleFocus }: TaskBoardCardProps) {
  const router = useWorkspaceRouter();

  const accentBorder = task.priority === "high" ? "border-l-red-500/60" : task.priority === "low" ? "border-l-zinc-700" : "";

  return (
    <div
      onClick={() => router.push(`/tasks/${task.id}`)}
      className={`group cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition-colors hover:border-zinc-700 hover:bg-zinc-800/60 ${accentBorder ? `border-l-2 ${accentBorder}` : ""}`}
    >
      {/* Title row + actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {onToggleFocus && (
              <FocusToggle
                isFocus={task.isFocus}
                onToggle={() => onToggleFocus(task.id, !task.isFocus)}
              />
            )}
            <h4 className="line-clamp-2 text-sm font-medium text-zinc-200 group-hover:text-white">
              {task.title}
            </h4>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <TaskPriorityBadge priority={task.priority} />
            {task.status === "done" && task.reviewStatus && (
              <ReviewStatusBadge status={task.reviewStatus} />
            )}
          </div>
        </div>
        <TaskActionsMenu
          taskId={task.id}
          taskStatus={task.status}
          onViewDetails={() => router.push(`/tasks/${task.id}`)}
          onMarkDone={() => onStatusChange(task.id, "done")}
          onMarkFailed={() => onStatusChange(task.id, "failed")}
          onStop={onStop ? () => onStop(task.id) : undefined}
        />
      </div>


      {/* Description */}
      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
          {task.description}
        </p>
      )}

      {/* Progress */}
      <div className="mt-2.5">
        <TaskProgress value={task.progress} />
      </div>

      {/* Footer: agent + time */}
      <div className="mt-2.5 flex items-center justify-between border-t border-zinc-800/50 pt-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-800 text-[10px] font-bold text-zinc-400">
            {task.agent.name.charAt(0).toUpperCase()}
          </span>
          <span className="max-w-[100px] truncate">{task.agent.name}</span>
        </span>
        <span className="text-[11px] text-zinc-600">{timeAgo(task.updatedAt)}</span>
      </div>

      {/* Stopped reason */}
      {task.status === "stopped" && task.resultSummary && (
        <div className="mt-1.5 rounded bg-orange-500/10 px-2 py-1 text-[11px] text-orange-400">
          {task.resultSummary}
        </div>
      )}

      {/* Current running agent (multi-agent tasks) */}
      {task.status === "running" &&
        task.executionStepsSummary?.currentAgentName &&
        task.executionStepsSummary.currentAgentName !== task.agent.name && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-violet-400">
            <span className="h-1 w-1 animate-pulse rounded-full bg-violet-400" />
            <span className="truncate">Running by: {task.executionStepsSummary.currentAgentName}</span>
          </div>
        )}

      {/* Task group badge */}
      {task.taskGroup && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <TaskGroupBadge group={task.taskGroup} compact />
        </div>
      )}

      {/* Result summary */}
      {task.resultSummary && (
        <p className="mt-2 line-clamp-1 rounded bg-zinc-800/50 px-2 py-1 text-[11px] text-zinc-500">
          {task.resultSummary}
        </p>
      )}
    </div>
  );
}
