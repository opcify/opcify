import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import {
  enqueueTask,
  DispatchManager,
} from "../task-dispatcher/index.js";
import { eventBroadcaster } from "../events/broadcaster.js";

const log = createLogger("recurring-scheduler");

interface ScheduleParams {
  frequency: string;
  interval: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number | null;
  minute: number | null;
}

// ─── Timezone-aware date helpers ──────────────────────────────────

/** Get date/time parts (year, month, day, hour, minute, dayOfWeek) in a given timezone. */
function getPartsInTz(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
    hour12: false,
  });
  const map = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(map.year),
    month: Number(map.month) - 1, // 0-indexed
    day: Number(map.day),
    hour: Number(map.hour === "24" ? 0 : map.hour),
    minute: Number(map.minute),
    dayOfWeek: weekdayMap[map.weekday] ?? 0,
  };
}

/**
 * Build a UTC Date that corresponds to the given local-time parts in the
 * specified timezone. E.g. dateInTz("America/New_York", 2026, 3, 8, 9, 0)
 * returns the UTC instant when it's 2026-04-08 09:00 in New York.
 */
function dateInTz(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // Create a rough UTC guess, then adjust by the offset difference
  const guess = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
  const parts = getPartsInTz(guess, tz);
  const localMs = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, 0, 0);
  const offsetMs = localMs - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/**
 * Compute the next run date from now, using the user's timezone for
 * interpreting hour, minute, and day-of-week.
 */
export function computeNextRun(params: ScheduleParams, timezone = "UTC"): Date {
  const now = new Date();
  const p = getPartsInTz(now, timezone);
  const runHour = params.hour ?? 9;
  const runMinute = params.minute ?? 0;

  if (params.frequency === "hourly") {
    let next = dateInTz(timezone, p.year, p.month, p.day, p.hour, runMinute);
    if (next <= now) {
      next = new Date(next.getTime() + 3600_000);
    }
    if (params.interval > 1) {
      next = new Date(next.getTime() + (params.interval - 1) * 3600_000);
    }
    return next;
  }

  if (params.frequency === "daily") {
    let next = dateInTz(timezone, p.year, p.month, p.day, runHour, runMinute);
    if (next <= now) {
      next = new Date(next.getTime() + 86400_000);
    }
    if (params.interval > 1) {
      next = new Date(next.getTime() + (params.interval - 1) * 86400_000);
    }
    return next;
  }

  if (params.frequency === "weekly" && params.dayOfWeek != null) {
    const target = params.dayOfWeek;
    let daysUntil = target - p.dayOfWeek;
    if (daysUntil <= 0) daysUntil += 7;
    daysUntil += (params.interval - 1) * 7;
    const next = new Date(
      dateInTz(timezone, p.year, p.month, p.day, runHour, runMinute).getTime() +
        daysUntil * 86400_000,
    );
    return next;
  }

  if (params.frequency === "monthly" && params.dayOfMonth != null) {
    const targetDay = Math.min(params.dayOfMonth, 28);
    let next = dateInTz(timezone, p.year, p.month, targetDay, runHour, runMinute);
    if (next <= now) {
      next = dateInTz(timezone, p.year, p.month + 1, targetDay, runHour, runMinute);
    }
    if (params.interval > 1) {
      const np = getPartsInTz(next, timezone);
      next = dateInTz(timezone, np.year, np.month + (params.interval - 1), targetDay, runHour, runMinute);
    }
    return next;
  }

  // Fallback: 9 AM tomorrow in user's timezone
  return dateInTz(timezone, p.year, p.month, p.day + 1, 9, 0);
}

/**
 * Advance nextRunAt after a successful run.
 */
function advanceNextRun(current: Date, params: ScheduleParams): Date {
  const next = new Date(current);

  if (params.frequency === "hourly") {
    return new Date(next.getTime() + params.interval * 3600_000);
  }

  if (params.frequency === "daily") {
    return new Date(next.getTime() + params.interval * 86400_000);
  }

  if (params.frequency === "weekly") {
    return new Date(next.getTime() + params.interval * 7 * 86400_000);
  }

  if (params.frequency === "monthly") {
    next.setMonth(next.getMonth() + params.interval);
    return next;
  }

  // Fallback
  return new Date(next.getTime() + 7 * 86400_000);
}

/**
 * Process all due recurring rules:
 * - find active rules where nextRunAt <= now
 * - create a task for each
 * - advance nextRunAt
 * Returns number of tasks created.
 */
export async function processRecurringRules(
  dispatchManager?: DispatchManager,
): Promise<number> {
  const now = new Date();

  const dueRules = await prisma.recurringRule.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: now },
    },
    include: {
      workspace: {
        select: {
          id: true,
          owner: { select: { timezone: true } },
        },
      },
    },
  });

  if (dueRules.length === 0) return 0;

  let created = 0;

  for (const rule of dueRules) {
    try {
      // Parse preset data
      let preset: { description?: string; priority?: string } = {};
      if (rule.presetData) {
        try {
          preset = JSON.parse(rule.presetData);
        } catch {
          // ignore bad JSON
        }
      }

      // Find a default agent for the workspace if none specified
      let agentId = rule.agentId;
      if (!agentId) {
        const defaultAgent = await prisma.agent.findFirst({
          where: { workspaceId: rule.workspaceId, status: { not: "disabled" } },
          orderBy: { createdAt: "asc" },
        });
        if (!defaultAgent) {
          log.error(
            `No agent available for recurring rule "${rule.title}" (${rule.id}) in workspace ${rule.workspaceId}`,
          );
          continue;
        }
        agentId = defaultAgent.id;
      }

      // Create the task
      const createdTask = await prisma.task.create({
        data: {
          title: rule.title,
          description: preset.description || "",
          agentId,
          priority: (preset.priority as "high" | "medium" | "low") || "medium",
          status: "queued",
          plannedDate: new Date(),
          clientId: rule.clientId || undefined,
          workspaceId: rule.workspaceId,
          recurringRuleId: rule.id,
        },
      });

      // Emit SSE event for task creation
      if (createdTask.workspaceId) {
        eventBroadcaster.emit(createdTask.workspaceId, {
          type: "task:created",
          taskId: createdTask.id,
          title: createdTask.title,
          agentId: createdTask.agentId,
          priority: createdTask.priority as "high" | "medium" | "low",
          status: "queued",
        });
      }

      // Auto-dispatch: enqueue task for BullMQ processing
      if (dispatchManager) {
        const wsId = createdTask.workspaceId ?? "default";
        enqueueTask(
          dispatchManager.getQueue(wsId),
          createdTask.id,
          wsId,
          createdTask.priority,
        ).catch((err) => {
          log.warn("Failed to enqueue recurring task for dispatch", {
            taskId: createdTask.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Advance the schedule
      const r = rule as Record<string, unknown>;
      const nextRunAt = advanceNextRun(rule.nextRunAt, {
        frequency: rule.frequency,
        interval: rule.interval,
        dayOfWeek: rule.dayOfWeek,
        dayOfMonth: rule.dayOfMonth,
        hour: (r.hour as number | null) ?? null,
        minute: (r.minute as number | null) ?? null,
      });

      await prisma.recurringRule.update({
        where: { id: rule.id },
        data: {
          lastRunAt: now,
          nextRunAt,
        },
      });

      created++;
      log.info(
        `Created task from recurring rule "${rule.title}" (${rule.id}), next run: ${nextRunAt.toISOString()}`,
      );
    } catch (err) {
      log.error(
        `Failed to process recurring rule ${rule.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return created;
}

// ── Inbox snooze wakeup ─────────────────────────────────────────────

async function wakeUpSnoozedInboxItems(): Promise<number> {
  const now = new Date();
  const result = await prisma.inboxItem.updateMany({
    where: {
      status: "snoozed",
      snoozedUntil: { lte: now },
    },
    data: {
      status: "inbox",
      snoozedUntil: null,
      actionTaken: null,
    },
  });
  if (result.count > 0) {
    log.info(`Woke up ${result.count} snoozed inbox item(s)`);
  }
  return result.count;
}

// ── Background interval runner ──────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startRecurringScheduler(
  intervalMs = 60_000,
  dispatchManager?: DispatchManager,
) {
  if (intervalHandle) return; // already running

  log.info(`Recurring scheduler started (interval: ${intervalMs}ms)`);

  const tick = () => {
    processRecurringRules(dispatchManager).catch((err) =>
      log.error(`Scheduler tick failed: ${err}`),
    );
    wakeUpSnoozedInboxItems().catch((err) =>
      log.error(`Inbox snooze wakeup failed: ${err}`),
    );
  };

  // Run immediately on start
  tick();

  intervalHandle = setInterval(tick, intervalMs);
}

export function stopRecurringScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info("Recurring scheduler stopped");
  }
}
