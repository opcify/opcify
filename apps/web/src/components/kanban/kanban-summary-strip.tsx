import type { KanbanSummaryCards, KanbanTimingMetrics } from "@opcify/core";
import { formatDurationMs } from "@/lib/time";

interface KanbanSummaryStripProps {
  summary: KanbanSummaryCards;
  timingMetrics?: KanbanTimingMetrics;
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return formatDurationMs(ms);
}

export function KanbanSummaryStrip({
  summary,
  timingMetrics,
}: KanbanSummaryStripProps) {
  const hasMetrics =
    timingMetrics &&
    (timingMetrics.completedCount > 0 ||
      timingMetrics.runningCount > 0 ||
      timingMetrics.avgQueueWaitMs != null);

  return (
    <div className="space-y-3">
      <div
        className={`grid gap-3 ${summary.items.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}
      >
        {summary.items.map((s) => (
          <div
            key={s.label}
            className={`flex items-center gap-3 rounded-xl border border-zinc-800 ${s.bg} px-4 py-3`}
          >
            <span className={`h-2 w-2 rounded-full ${s.dot}`} />
            <div>
              <p className={`text-xl font-semibold tabular-nums ${s.color}`}>
                {s.value}
              </p>
              <p className="text-xs text-zinc-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {hasMetrics && timingMetrics && (
        <div
          className={`grid gap-3 ${
            timingMetrics.avgQueueWaitMs != null
              ? "grid-cols-2 sm:grid-cols-4"
              : "grid-cols-3"
          }`}
        >
          <MetricTile
            label="Avg duration"
            value={formatMs(timingMetrics.avgDurationMs)}
            hint={`${timingMetrics.completedCount} task${timingMetrics.completedCount === 1 ? "" : "s"}`}
            accent="text-emerald-400"
            bg="bg-emerald-500/5"
            dot="bg-emerald-400"
          />
          <MetricTile
            label="Total processing"
            value={formatMs(timingMetrics.totalProcessingMs || null)}
            hint="today"
            accent="text-blue-400"
            bg="bg-blue-500/5"
            dot="bg-blue-400"
          />
          <MetricTile
            label="Longest running"
            value={formatMs(timingMetrics.longestRunningMs)}
            hint={
              timingMetrics.longestRunningTaskTitle ??
              (timingMetrics.runningCount === 0 ? "none" : "")
            }
            title={timingMetrics.longestRunningTaskTitle ?? undefined}
            accent="text-amber-400"
            bg="bg-amber-500/5"
            dot="bg-amber-400"
          />
          {timingMetrics.avgQueueWaitMs != null && (
            <MetricTile
              label="Avg queue wait"
              value={formatMs(timingMetrics.avgQueueWaitMs)}
              hint="before start"
              accent="text-violet-400"
              bg="bg-violet-500/5"
              dot="bg-violet-400"
            />
          )}
        </div>
      )}
    </div>
  );
}

interface MetricTileProps {
  label: string;
  value: string;
  hint?: string;
  title?: string;
  accent: string;
  bg: string;
  dot: string;
}

function MetricTile({ label, value, hint, title, accent, bg, dot }: MetricTileProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-zinc-800 ${bg} px-4 py-3`}
      title={title}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <div className="min-w-0">
        <p className={`text-xl font-semibold tabular-nums ${accent}`}>{value}</p>
        <p className="truncate text-xs text-zinc-500">
          {label}
          {hint ? ` · ${hint}` : ""}
        </p>
      </div>
    </div>
  );
}
