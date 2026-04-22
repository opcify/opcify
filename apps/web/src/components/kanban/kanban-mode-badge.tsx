import type { KanbanMode } from "@opcify/core";

const config: Record<KanbanMode, { label: string; color: string; bg: string; dot: string }> = {
  today: {
    label: "Live",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    dot: "bg-emerald-400 animate-pulse",
  },
  past: {
    label: "Review Mode",
    color: "text-zinc-400",
    bg: "bg-zinc-500/10",
    dot: "bg-zinc-400",
  },
  future: {
    label: "Planning Mode",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    dot: "bg-blue-400",
  },
};

export function KanbanModeBadge({ mode }: { mode: KanbanMode }) {
  const c = config[mode];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${c.bg} px-2.5 py-1 text-xs font-medium ${c.color}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
