"use client";

import { useTimezone } from "@/lib/use-timezone";

interface KanbanHeroProps {
  summary: {
    planned: number;
    running: number;
    review: number;
    completed: number;
  };
}

export function KanbanHero({ summary }: KanbanHeroProps) {
  const timezone = useTimezone();
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  });

  const stats = [
    { label: "Planned", value: summary.planned, color: "text-blue-400", bg: "bg-blue-500/10", dot: "bg-blue-400" },
    { label: "Running", value: summary.running, color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
    { label: "Review", value: summary.review, color: "text-amber-400", bg: "bg-amber-500/10", dot: "bg-amber-400" },
    { label: "Completed", value: summary.completed, color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
  ];

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            Kanban
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Plan, run, review, and continue today&apos;s work.
          </p>
        </div>
        <span className="text-sm text-zinc-600">{today}</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`flex items-center gap-3 rounded-xl border border-zinc-800 ${s.bg} px-4 py-3`}
          >
            <span className={`h-2 w-2 rounded-full ${s.dot} ${s.label === "Running" && s.value > 0 ? "animate-pulse" : ""}`} />
            <div>
              <p className={`text-xl font-semibold tabular-nums ${s.color}`}>
                {s.value}
              </p>
              <p className="text-xs text-zinc-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
