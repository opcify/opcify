"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import { Plus, LayoutTemplate, ListTodo } from "lucide-react";

interface KanbanQuickActionsProps {
  onAddTask: () => void;
}

export function KanbanQuickActions({ onAddTask }: KanbanQuickActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onAddTask}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
      >
        <Plus className="h-4 w-4" />
        Add Task
      </button>
      <Link
        href="/task-hub?from=kanban"
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
      >
        <LayoutTemplate className="h-4 w-4" />
        From Template
      </Link>
      <Link
        href="/tasks"
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
      >
        <ListTodo className="h-4 w-4" />
        Open Tasks
      </Link>
    </div>
  );
}
