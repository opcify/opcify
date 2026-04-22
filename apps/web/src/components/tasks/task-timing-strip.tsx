"use client";

import { memo, useEffect, useState } from "react";
import type { Task } from "@opcify/core";
import {
  formatDateTime,
  formatDuration,
  formatDurationMs,
  timeAgo,
} from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";

export type TaskTimingVariant =
  | "queued"
  | "running"
  | "review"
  | "completed"
  | "failed";

interface TaskTimingStripProps {
  task: Pick<
    Task,
    "createdAt" | "startedAt" | "finishedAt" | "updatedAt" | "status"
  >;
  variant: TaskTimingVariant;
}

/**
 * Compact inline strip showing task timing info.
 * - queued: "Created 5m ago · Queued 5m"
 * - running: "Started 3m ago · Running 3m"  (ticks every 10s)
 * - review/completed: "Duration 4m · Done 2m ago"
 * - failed: "Failed 5m ago · Ran 2m"
 *
 * Each fragment has a native title tooltip with the full ISO datetime.
 */
function TaskTimingStripInner({ task, variant }: TaskTimingStripProps) {
  const timezone = useTimezone();

  // Tick every 10s only when running — used so the live "Running Xm" updates.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (variant !== "running") return;
    const h = setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => clearInterval(h);
  }, [variant]);

  const fragments: { label: string; title?: string }[] = [];

  if (variant === "queued") {
    fragments.push({
      label: `Created ${timeAgo(task.createdAt)}`,
      title: `Created ${formatDateTime(task.createdAt, timezone)}`,
    });
    const queueWait = formatDuration(task.createdAt, null);
    if (queueWait) fragments.push({ label: `Queued ${queueWait}` });
  } else if (variant === "running") {
    if (task.startedAt) {
      fragments.push({
        label: `Started ${timeAgo(task.startedAt)}`,
        title: `Started ${formatDateTime(task.startedAt, timezone)}`,
      });
      const running = formatDuration(task.startedAt, null);
      if (running) fragments.push({ label: `Running ${running}` });
    } else {
      fragments.push({
        label: `Created ${timeAgo(task.createdAt)}`,
        title: `Created ${formatDateTime(task.createdAt, timezone)}`,
      });
    }
  } else if (variant === "review" || variant === "completed") {
    if (task.startedAt && task.finishedAt) {
      const duration = formatDuration(task.startedAt, task.finishedAt);
      if (duration) {
        fragments.push({
          label: `Duration ${duration}`,
          title: `Started ${formatDateTime(task.startedAt, timezone)} · Finished ${formatDateTime(task.finishedAt, timezone)}`,
        });
      }
    }
    if (task.finishedAt) {
      fragments.push({
        label: `Done ${timeAgo(task.finishedAt)}`,
        title: `Finished ${formatDateTime(task.finishedAt, timezone)}`,
      });
    }
  } else if (variant === "failed") {
    if (task.finishedAt) {
      fragments.push({
        label: `Failed ${timeAgo(task.finishedAt)}`,
        title: `Failed ${formatDateTime(task.finishedAt, timezone)}`,
      });
    }
    if (task.startedAt && task.finishedAt) {
      const duration = formatDuration(task.startedAt, task.finishedAt);
      if (duration) fragments.push({ label: `Ran ${duration}` });
    }
  }

  if (fragments.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
      {fragments.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-zinc-700">·</span>}
          <span className="text-zinc-500" title={f.title}>
            {f.label}
          </span>
        </span>
      ))}
    </span>
  );
}

export const TaskTimingStrip = memo(TaskTimingStripInner, (prev, next) => {
  return (
    prev.variant === next.variant &&
    prev.task.createdAt === next.task.createdAt &&
    prev.task.startedAt === next.task.startedAt &&
    prev.task.finishedAt === next.task.finishedAt &&
    prev.task.status === next.task.status
  );
});

// Re-export the ms formatter for any caller that only has a number.
export { formatDurationMs };
