"use client";

import { KanbanHeader } from "./kanban-header";

interface KanbanErrorStateProps {
  error: string;
  onRetry: () => void;
  selectedDate: string;
  onDateChange: (date: string) => void;
}

export function KanbanErrorState({
  error,
  onRetry,
  selectedDate,
  onDateChange,
}: KanbanErrorStateProps) {
  const isConnectionError =
    /failed to fetch|networkerror|load failed|connection refused/i.test(error) ||
    error === "Failed to fetch";
  const isServerError =
    /^HTTP 5\d\d$/.test(error) || /internal server error/i.test(error);

  return (
    <div className="space-y-6">
      <KanbanHeader
        mode="today"
        selectedDate={selectedDate}
        onDateChange={onDateChange}
      />
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 py-20 px-6">
        <p className="text-sm font-medium text-red-400">Failed to load workspace</p>
        <p className="mt-1 text-xs text-zinc-500 text-center max-w-sm">{error}</p>
        {isConnectionError && (
          <p className="mt-3 text-xs text-zinc-500 text-center max-w-sm">
            Make sure the API is running (e.g.{" "}
            <code className="rounded bg-zinc-800 px-1">pnpm dev</code> or{" "}
            <code className="rounded bg-zinc-800 px-1">pnpm dev:api</code>).
          </p>
        )}
        {isServerError && !isConnectionError && (
          <p className="mt-3 text-xs text-zinc-500 text-center max-w-sm">
            If using the default database, run{" "}
            <code className="rounded bg-zinc-800 px-1">pnpm db:push</code> from the
            project root.
          </p>
        )}
        <button
          onClick={onRetry}
          className="mt-4 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
