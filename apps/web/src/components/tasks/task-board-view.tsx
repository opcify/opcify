"use client";

import { useMemo } from "react";
import type { TaskWithAgent, TaskStatus, TaskPriority } from "@opcify/core";
import { TaskBoardColumn } from "./task-board-column";

const BOARD_STATUSES: TaskStatus[] = ["queued", "running", "waiting", "done", "failed", "stopped"];
const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 };

interface TaskBoardViewProps {
  tasks: TaskWithAgent[];
  onStatusChange: (id: string, status: TaskStatus) => void;
  onStop?: (id: string) => void;
  statusFilter?: string;
  onToggleFocus?: (id: string, isFocus: boolean) => void;
}

export function TaskBoardView({ tasks, onStatusChange, onStop, statusFilter, onToggleFocus }: TaskBoardViewProps) {
  const grouped = useMemo(() => {
    const map: Record<TaskStatus, TaskWithAgent[]> = {
      queued: [],
      running: [],
      waiting: [],
      done: [],
      failed: [],
      stopped: [],
    };
    for (const task of tasks) {
      const s = task.status as TaskStatus;
      if (map[s]) map[s].push(task);
    }
    for (const status of BOARD_STATUSES) {
      map[status].sort(
        (a, b) =>
          (PRIORITY_ORDER[b.priority] ?? 2) - (PRIORITY_ORDER[a.priority] ?? 2) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
    }
    return map;
  }, [tasks]);

  const visibleStatuses =
    statusFilter && statusFilter !== "all"
      ? BOARD_STATUSES.filter((s) => s === statusFilter)
      : BOARD_STATUSES;

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {visibleStatuses.map((status) => (
        <TaskBoardColumn
          key={status}
          status={status}
          tasks={grouped[status]}
          onStatusChange={onStatusChange}
          onStop={onStop}
          onToggleFocus={onToggleFocus}
        />
      ))}
    </div>
  );
}
