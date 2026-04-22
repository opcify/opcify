"use client";

import type { TaskWithAgent, TaskStatus } from "@opcify/core";
import { TaskBoardCard } from "./task-board-card";

const columnColors: Record<TaskStatus, { dot: string; count: string }> = {
  queued: { dot: "bg-blue-400", count: "text-blue-400/70" },
  running: { dot: "bg-emerald-400", count: "text-emerald-400/70" },
  waiting: { dot: "bg-amber-400", count: "text-amber-400/70" },
  done: { dot: "bg-emerald-400", count: "text-emerald-400/70" },
  failed: { dot: "bg-red-400", count: "text-red-400/70" },
  stopped: { dot: "bg-orange-400", count: "text-orange-400/70" },
};

const columnLabels: Record<TaskStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

interface TaskBoardColumnProps {
  status: TaskStatus;
  tasks: TaskWithAgent[];
  onStatusChange: (id: string, status: TaskStatus) => void;
  onStop?: (id: string) => void;
  onToggleFocus?: (id: string, isFocus: boolean) => void;
}

export function TaskBoardColumn({ status, tasks, onStatusChange, onStop, onToggleFocus }: TaskBoardColumnProps) {
  const colors = columnColors[status];

  return (
    <div className="flex w-[75vw] shrink-0 flex-col sm:w-64">
      {/* Column header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-zinc-950 pb-3">
        <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {columnLabels[status]}
        </span>
        <span className={`rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${colors.count}`}>
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2">
        {tasks.length === 0 && (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-zinc-800 py-10">
            <span className="text-xs text-zinc-600">No tasks</span>
          </div>
        )}
        {tasks.map((task) => (
          <TaskBoardCard
            key={task.id}
            task={task}
            onStatusChange={onStatusChange}
            onStop={onStop}
            onToggleFocus={onToggleFocus}
          />
        ))}
      </div>
    </div>
  );
}
