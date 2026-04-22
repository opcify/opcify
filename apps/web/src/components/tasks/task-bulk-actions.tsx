interface TaskBulkActionsProps {
  count: number;
  onMarkDone: () => void;
  onMarkFailed: () => void;
  onClear: () => void;
}

export function TaskBulkActions({
  count,
  onMarkDone,
  onMarkFailed,
  onClear,
}: TaskBulkActionsProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5">
      <span className="text-sm text-zinc-400">
        <span className="font-medium text-zinc-200">{count}</span> selected
      </span>

      <div className="h-4 w-px bg-zinc-800" />

      <button
        onClick={onMarkDone}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10"
      >
        Mark Done
      </button>
      <button
        onClick={onMarkFailed}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
      >
        Mark Failed
      </button>

      <div className="h-4 w-px bg-zinc-800" />

      <button
        onClick={onClear}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
      >
        Clear
      </button>
    </div>
  );
}
