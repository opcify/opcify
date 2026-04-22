"use client";

import { Star } from "lucide-react";
import type { TaskWithAgent, TaskStatus } from "@opcify/core";
import { TaskRow } from "./task-row";

interface TaskTableProps {
  tasks: TaskWithAgent[];
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  onSelectAll: () => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onStop?: (id: string) => void;
  onToggleFocus?: (id: string, isFocus: boolean) => void;
}

export function TaskTable({
  tasks,
  selectedIds,
  onSelect,
  onSelectAll,
  onStatusChange,
  onStop,
  onToggleFocus,
}: TaskTableProps) {
  const allSelected = tasks.length > 0 && selectedIds.size === tasks.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-zinc-800 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <th className="w-10 py-3 pl-3 pr-1">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onSelectAll}
                className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0 focus:ring-offset-0"
              />
            </th>
            <th className="w-10 py-3 pr-1 text-center"><Star className="inline h-3.5 w-3.5 text-amber-400/80" /></th>
            <th className="py-3 pr-3">Task</th>
            <th className="hidden py-3 pr-3 md:table-cell">Priority</th>
            <th className="py-3 pr-3">Status</th>
            <th className="hidden py-3 pr-3 md:table-cell">Agent</th>
            <th className="hidden py-3 pr-3 lg:table-cell">Progress</th>
            <th className="hidden py-3 pr-3 lg:table-cell">Updated</th>
            <th className="hidden py-3 pr-3 lg:table-cell">Result</th>
            <th className="w-10 py-3 pr-3" />
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              selected={selectedIds.has(task.id)}
              onSelect={onSelect}
              onStatusChange={onStatusChange}
              onStop={onStop}
              onToggleFocus={onToggleFocus}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
