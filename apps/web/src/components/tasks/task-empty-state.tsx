import { ListTodo, Plus } from "lucide-react";

interface TaskEmptyStateProps {
  onCreateTask: () => void;
}

export function TaskEmptyState({ onCreateTask }: TaskEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-500">
        <ListTodo className="h-7 w-7" />
      </div>
      <h3 className="text-base font-semibold text-zinc-200">No tasks yet</h3>
      <p className="mt-1.5 max-w-xs text-center text-sm text-zinc-500">
        Create your first task to start managing agent work.
      </p>
      <button
        onClick={onCreateTask}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
      >
        <Plus className="h-4 w-4" />
        New Task
      </button>
    </div>
  );
}
