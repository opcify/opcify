export function KanbanPageSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {/* Header skeleton */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-7 w-28 rounded bg-zinc-800" />
            <div className="h-6 w-28 rounded-full bg-zinc-800/60" />
          </div>
          <div className="mt-2 h-4 w-64 rounded bg-zinc-800/40" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-8 w-8 rounded-lg bg-zinc-800/60" />
          <div className="h-8 w-36 rounded-lg bg-zinc-800/60" />
          <div className="h-8 w-8 rounded-lg bg-zinc-800/60" />
        </div>
      </div>

      {/* Summary strip skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-xl border border-zinc-800 bg-zinc-900/50"
          />
        ))}
      </div>

      {/* Quick actions skeleton */}
      <div className="flex gap-2">
        <div className="h-9 w-28 rounded-lg bg-zinc-800" />
        <div className="h-9 w-32 rounded-lg bg-zinc-800/60" />
        <div className="h-9 w-24 rounded-lg bg-zinc-800/40" />
      </div>

      {/* Section skeletons */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-zinc-800 bg-zinc-900/50"
        >
          <div className="border-b border-zinc-800/60 px-5 py-3.5">
            <div className="h-4 w-32 rounded bg-zinc-800" />
          </div>
          <div className="space-y-3 p-4">
            {Array.from({ length: 2 }).map((_, j) => (
              <div
                key={j}
                className="h-16 rounded-lg border border-zinc-800 bg-zinc-900/60"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
