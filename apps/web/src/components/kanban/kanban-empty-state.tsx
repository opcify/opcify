interface KanbanEmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function KanbanEmptyState({
  message,
  actionLabel,
  onAction,
}: KanbanEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <p className="text-sm text-zinc-600">{message}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-3 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
