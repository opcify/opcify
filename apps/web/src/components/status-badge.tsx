const styles: Record<string, string> = {
  idle: "bg-zinc-700 text-zinc-300",
  running: "bg-emerald-950 text-emerald-400",
  blocked: "bg-amber-950 text-amber-400",
  error: "bg-red-950 text-red-400",
  disabled: "bg-zinc-800 text-zinc-500",
  queued: "bg-blue-950 text-blue-400",
  waiting: "bg-amber-950 text-amber-400",
  done: "bg-emerald-950 text-emerald-400",
  failed: "bg-red-950 text-red-400",
  stopped: "bg-orange-950 text-orange-400",
};

const dots: Record<string, string> = {
  idle: "bg-zinc-400",
  running: "bg-emerald-400",
  blocked: "bg-amber-400",
  error: "bg-red-400",
  disabled: "bg-zinc-500",
  queued: "bg-blue-400",
  waiting: "bg-amber-400",
  done: "bg-emerald-400",
  failed: "bg-red-400",
  stopped: "bg-orange-400",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.idle}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dots[status] ?? dots.idle}`} />
      {status}
    </span>
  );
}
