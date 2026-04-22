"use client";

import { useWorkspaceRouter } from "@/lib/workspace-router";
import type { TaskWithAgent, TaskStatus } from "@opcify/core";
import { timeAgo } from "@/lib/time";
import { TaskStatusBadge } from "./task-status-badge";
import { TaskPriorityBadge } from "./task-priority-badge";
import { ReviewStatusBadge } from "./review-status-badge";
import { TaskProgress } from "./task-progress";
import { TaskActionsMenu } from "./task-actions-menu";
import { FocusToggle } from "@/components/kanban/focus-toggle";
import { TaskGroupBadge } from "@/components/task-groups/task-group-badge";

function truncate(text: string, max = 50): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

interface TaskRowProps {
  task: TaskWithAgent;
  selected: boolean;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onStop?: (id: string) => void;
  onToggleFocus?: (id: string, isFocus: boolean) => void;
}

export function TaskRow({ task, selected, onSelect, onStatusChange, onStop, onToggleFocus }: TaskRowProps) {
  const router = useWorkspaceRouter();

  return (
    <tr
      onClick={() => router.push(`/tasks/${task.id}`)}
      className={`group cursor-pointer border-b border-zinc-800/50 transition-colors last:border-0 ${
        selected
          ? "bg-zinc-800/40"
          : "hover:bg-zinc-800/20"
      }`}
    >
      {/* Checkbox */}
      <td className="w-10 py-2.5 pl-3 pr-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onSelect(task.id);
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0 focus:ring-offset-0"
        />
      </td>

      {/* Focus */}
      <td className="w-10 py-2.5 pr-1 text-center">
        {onToggleFocus && (
          <FocusToggle
            isFocus={task.isFocus}
            onToggle={() => onToggleFocus(task.id, !task.isFocus)}
          />
        )}
      </td>

      {/* Title + Description */}
      <td className="py-2.5 pr-3">
        <div className="truncate text-sm font-medium text-zinc-200 group-hover:text-white" title={task.title}>
          {truncate(task.title)}
        </div>
        {task.description && (
          <div className="mt-0.5 truncate text-xs text-zinc-500" title={task.description}>
            {truncate(task.description)}
          </div>
        )}
        {task.taskGroup && (
          <div className="mt-0.5" onClick={(e) => e.stopPropagation()}>
            <TaskGroupBadge group={task.taskGroup} compact />
          </div>
        )}
      </td>

      {/* Priority */}
      <td className="hidden py-2.5 pr-3 md:table-cell">
        <TaskPriorityBadge priority={task.priority} />
      </td>

      {/* Status */}
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-1.5">
          <TaskStatusBadge status={task.status as TaskStatus} />
          {task.status === "done" && task.reviewStatus && (
            <ReviewStatusBadge status={task.reviewStatus} />
          )}
        </div>
      </td>

      {/* Agent */}
      <td className="hidden py-2.5 pr-3 md:table-cell">
        <span className="text-sm text-zinc-400" title={task.agent.name}>{truncate(task.agent.name)}</span>
        {task.status === "running" &&
          task.executionStepsSummary?.currentAgentName &&
          task.executionStepsSummary.currentAgentName !== task.agent.name && (
            <span className="ml-1.5 text-xs text-violet-400">
              ↳ {task.executionStepsSummary.currentAgentName}
            </span>
          )}
      </td>

      {/* Progress */}
      <td className="hidden py-2.5 pr-3 lg:table-cell">
        <TaskProgress value={task.progress} />
      </td>

      {/* Updated */}
      <td className="hidden py-2.5 pr-3 lg:table-cell">
        <span className="text-xs text-zinc-500">{timeAgo(task.updatedAt)}</span>
      </td>

      {/* Result Summary */}
      <td className="hidden py-2.5 pr-3 lg:table-cell">
        {task.resultSummary ? (
          <span className="truncate text-xs text-zinc-500" title={task.resultSummary}>
            {truncate(task.resultSummary)}
          </span>
        ) : (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="w-10 py-2.5 pr-3">
        <TaskActionsMenu
          taskId={task.id}
          taskStatus={task.status}
          onViewDetails={() => router.push(`/tasks/${task.id}`)}
          onMarkDone={() => onStatusChange(task.id, "done")}
          onMarkFailed={() => onStatusChange(task.id, "failed")}
          onStop={onStop ? () => onStop(task.id) : undefined}
        />
      </td>
    </tr>
  );
}
