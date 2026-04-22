import type { TaskStatus } from "@opcify/core";

const config: Record<TaskStatus, { bg: string; text: string; dot: string }> = {
  queued: { bg: "bg-blue-500/10", text: "text-blue-400", dot: "bg-blue-400" },
  running: { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400" },
  waiting: { bg: "bg-amber-500/10", text: "text-amber-400", dot: "bg-amber-400" },
  done: { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400" },
  failed: { bg: "bg-red-500/10", text: "text-red-400", dot: "bg-red-400" },
  stopped: { bg: "bg-orange-500/10", text: "text-orange-400", dot: "bg-orange-400" },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const c = config[status] ?? config.queued;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${c.dot} ${
          status === "running" ? "animate-pulse" : ""
        }`}
      />
      {status}
    </span>
  );
}
