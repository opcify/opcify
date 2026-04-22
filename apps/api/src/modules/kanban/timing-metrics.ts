import type { Task, KanbanTimingMetrics } from "@opcify/core";

/**
 * Pure aggregator for Kanban task timing. Used by getKanbanByDate, getKanbanSummary,
 * and the GET /workspaces/:id/kanban/stats endpoint so all consumers (web UI, Telegram,
 * future clients) read the same numbers.
 *
 * - completed: tasks in a terminal state (done/failed/stopped) within the scope window
 * - inProgress: tasks with status === "running" currently
 * - startedInScope: tasks whose startedAt fell within the scope window (for queue-wait avg)
 *
 * Tasks with NULL startedAt are skipped (they never actually entered execution).
 */
export function computeKanbanTimingMetrics(
  completed: Pick<Task, "id" | "title" | "startedAt" | "finishedAt" | "createdAt">[],
  inProgress: Pick<Task, "id" | "title" | "startedAt">[],
  startedInScope: Pick<Task, "id" | "startedAt" | "createdAt">[],
  now: Date = new Date(),
): KanbanTimingMetrics {
  let durationSum = 0;
  let durationCount = 0;
  for (const t of completed) {
    if (!t.startedAt || !t.finishedAt) continue;
    const diff = new Date(t.finishedAt).getTime() - new Date(t.startedAt).getTime();
    if (diff < 0) continue;
    durationSum += diff;
    durationCount += 1;
  }

  let queueWaitSum = 0;
  let queueWaitCount = 0;
  for (const t of startedInScope) {
    if (!t.startedAt || !t.createdAt) continue;
    const diff = new Date(t.startedAt).getTime() - new Date(t.createdAt).getTime();
    if (diff < 0) continue;
    queueWaitSum += diff;
    queueWaitCount += 1;
  }

  let longestRunningMs: number | null = null;
  let longestRunningTaskId: string | null = null;
  let longestRunningTaskTitle: string | null = null;
  const nowMs = now.getTime();
  for (const t of inProgress) {
    if (!t.startedAt) continue;
    const elapsed = nowMs - new Date(t.startedAt).getTime();
    if (elapsed < 0) continue;
    if (longestRunningMs == null || elapsed > longestRunningMs) {
      longestRunningMs = elapsed;
      longestRunningTaskId = t.id;
      longestRunningTaskTitle = t.title;
    }
  }

  return {
    avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    totalProcessingMs: durationSum,
    avgQueueWaitMs: queueWaitCount > 0 ? Math.round(queueWaitSum / queueWaitCount) : null,
    longestRunningMs,
    longestRunningTaskId,
    longestRunningTaskTitle,
    completedCount: durationCount,
    runningCount: inProgress.filter((t) => t.startedAt != null).length,
  };
}

export function emptyKanbanTimingMetrics(): KanbanTimingMetrics {
  return {
    avgDurationMs: null,
    totalProcessingMs: 0,
    avgQueueWaitMs: null,
    longestRunningMs: null,
    longestRunningTaskId: null,
    longestRunningTaskTitle: null,
    completedCount: 0,
    runningCount: 0,
  };
}
