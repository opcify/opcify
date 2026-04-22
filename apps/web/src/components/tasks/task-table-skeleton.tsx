export function TaskTableSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-3 flex gap-3">
        <div className="h-4 w-48 rounded bg-zinc-800" />
        <div className="h-4 w-16 rounded bg-zinc-800" />
        <div className="h-4 w-16 rounded bg-zinc-800" />
        <div className="h-4 w-20 rounded bg-zinc-800" />
        <div className="h-4 w-16 rounded bg-zinc-800" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-zinc-800/50 py-3"
        >
          <div className="h-3.5 w-3.5 rounded bg-zinc-800" />
          <div className="h-4 w-40 rounded bg-zinc-800" />
          <div className="h-5 w-16 rounded-full bg-zinc-800" />
          <div className="h-4 w-20 rounded bg-zinc-800" />
          <div className="h-1.5 w-20 rounded-full bg-zinc-800" />
          <div className="h-4 w-14 rounded bg-zinc-800" />
          <div className="ml-auto h-4 w-24 rounded bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}
