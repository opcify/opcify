import { describe, it, expect } from "vitest";
import { computeKanbanTimingMetrics, emptyKanbanTimingMetrics } from "./timing-metrics.js";

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe("computeKanbanTimingMetrics", () => {
  it("returns zeros/nulls for empty input", () => {
    const m = computeKanbanTimingMetrics([], [], []);
    expect(m.avgDurationMs).toBeNull();
    expect(m.totalProcessingMs).toBe(0);
    expect(m.avgQueueWaitMs).toBeNull();
    expect(m.longestRunningMs).toBeNull();
    expect(m.longestRunningTaskId).toBeNull();
    expect(m.longestRunningTaskTitle).toBeNull();
    expect(m.completedCount).toBe(0);
    expect(m.runningCount).toBe(0);
  });

  it("computes avg and total duration for a single completed task", () => {
    const start = iso(-120_000); // 2 minutes ago
    const end = iso(-60_000); // 1 minute ago
    const m = computeKanbanTimingMetrics(
      [{ id: "t1", title: "T1", startedAt: start, finishedAt: end, createdAt: start }],
      [],
      [],
    );
    expect(m.completedCount).toBe(1);
    expect(m.avgDurationMs).toBeGreaterThan(50_000);
    expect(m.avgDurationMs).toBeLessThan(70_000);
    expect(m.totalProcessingMs).toBe(m.avgDurationMs);
  });

  it("averages multiple completed tasks", () => {
    const m = computeKanbanTimingMetrics(
      [
        {
          id: "a",
          title: "A",
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(60_000).toISOString(),
          createdAt: new Date(0).toISOString(),
        },
        {
          id: "b",
          title: "B",
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(120_000).toISOString(),
          createdAt: new Date(0).toISOString(),
        },
      ],
      [],
      [],
    );
    expect(m.completedCount).toBe(2);
    expect(m.avgDurationMs).toBe(90_000); // (60 + 120) / 2 = 90
    expect(m.totalProcessingMs).toBe(180_000);
  });

  it("skips tasks with null startedAt in all aggregates", () => {
    const m = computeKanbanTimingMetrics(
      [
        {
          id: "a",
          title: "A",
          startedAt: null,
          finishedAt: new Date(100_000).toISOString(),
          createdAt: new Date(0).toISOString(),
        },
      ],
      [{ id: "b", title: "B", startedAt: null }],
      [
        { id: "c", startedAt: null, createdAt: new Date(0).toISOString() },
      ],
    );
    expect(m.completedCount).toBe(0);
    expect(m.runningCount).toBe(0);
    expect(m.avgDurationMs).toBeNull();
    expect(m.avgQueueWaitMs).toBeNull();
    expect(m.longestRunningMs).toBeNull();
  });

  it("picks the longest running task by elapsed time", () => {
    const now = new Date(10_000_000);
    const m = computeKanbanTimingMetrics(
      [],
      [
        { id: "short", title: "Short task", startedAt: new Date(9_900_000).toISOString() }, // 100s elapsed
        { id: "long", title: "Long task", startedAt: new Date(9_000_000).toISOString() }, // 1000s elapsed
        { id: "med", title: "Medium", startedAt: new Date(9_500_000).toISOString() }, // 500s elapsed
      ],
      [],
      now,
    );
    expect(m.runningCount).toBe(3);
    expect(m.longestRunningTaskId).toBe("long");
    expect(m.longestRunningTaskTitle).toBe("Long task");
    expect(m.longestRunningMs).toBe(1_000_000);
  });

  it("computes avg queue wait for startedInScope tasks", () => {
    const m = computeKanbanTimingMetrics(
      [],
      [],
      [
        {
          id: "a",
          createdAt: new Date(0).toISOString(),
          startedAt: new Date(10_000).toISOString(),
        },
        {
          id: "b",
          createdAt: new Date(0).toISOString(),
          startedAt: new Date(30_000).toISOString(),
        },
      ],
    );
    expect(m.avgQueueWaitMs).toBe(20_000); // (10 + 30) / 2 = 20
  });

  it("ignores negative durations (finishedAt < startedAt)", () => {
    const m = computeKanbanTimingMetrics(
      [
        {
          id: "a",
          title: "A",
          startedAt: new Date(100_000).toISOString(),
          finishedAt: new Date(50_000).toISOString(), // impossible
          createdAt: new Date(0).toISOString(),
        },
      ],
      [],
      [],
    );
    expect(m.completedCount).toBe(0);
  });
});

describe("emptyKanbanTimingMetrics", () => {
  it("matches the empty-input shape of computeKanbanTimingMetrics", () => {
    expect(emptyKanbanTimingMetrics()).toEqual(computeKanbanTimingMetrics([], [], []));
  });
});
