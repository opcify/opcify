function SkeletonColumn() {
  return (
    <div className="w-64 shrink-0">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-zinc-800" />
        <div className="h-3 w-16 rounded bg-zinc-800" />
        <div className="h-3 w-4 rounded bg-zinc-800" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
          >
            <div className="h-4 w-3/4 rounded bg-zinc-800" />
            <div className="mt-2 h-3 w-full rounded bg-zinc-800" />
            <div className="mt-2.5 h-1.5 w-full rounded-full bg-zinc-800" />
            <div className="mt-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-4 w-4 rounded-full bg-zinc-800" />
                <div className="h-3 w-16 rounded bg-zinc-800" />
              </div>
              <div className="h-3 w-10 rounded bg-zinc-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TaskBoardSkeleton() {
  return (
    <div className="flex animate-pulse gap-4 overflow-hidden">
      {Array.from({ length: 5 }).map((_, i) => (
        <SkeletonColumn key={i} />
      ))}
    </div>
  );
}
