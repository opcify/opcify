"use client";

import { RefreshCw } from "lucide-react";
import { useTimezone } from "@/lib/use-timezone";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(n: number): string {
  if (n === 1 || n === 21 || n === 31) return `${n}st`;
  if (n === 2 || n === 22) return `${n}nd`;
  if (n === 3 || n === 23) return `${n}rd`;
  return `${n}th`;
}

interface RecurringInfo {
  frequency: string;
  interval: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  hour?: number | null;
  minute?: number | null;
  startDate?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  isActive?: boolean;
}

function formatDateTime(iso: string, timezone?: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

/**
 * Format a recurring schedule as a short human-readable string.
 * e.g. "Every 2h", "Daily at 9 AM", "Every Mon", "Monthly on 15th"
 */
export function formatRecurringSchedule(rule: RecurringInfo, options?: { short?: boolean }): string {
  const short = options?.short ?? false;
  const days = short ? DAY_SHORT : DAY_FULL;
  const h = rule.hour ?? 9;
  const m = rule.minute ?? 0;
  const timeStr = `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;

  if (rule.frequency === "hourly") {
    const minStr = m > 0 ? ` at :${String(m).padStart(2, "0")}` : "";
    return rule.interval > 1 ? `Every ${rule.interval}h${minStr}` : `Every hour${minStr}`;
  }

  if (rule.frequency === "daily") {
    return rule.interval > 1
      ? `Every ${rule.interval} days at ${timeStr}`
      : `Daily at ${timeStr}`;
  }

  if (rule.frequency === "weekly") {
    const day = days[rule.dayOfWeek ?? 1];
    return rule.interval > 1
      ? short ? `Every ${rule.interval}w ${DAY_SHORT[rule.dayOfWeek ?? 1]} ${timeStr}` : `Every ${rule.interval} weeks on ${day} at ${timeStr}`
      : short ? `Every ${day} ${timeStr}` : `Every ${day} at ${timeStr}`;
  }

  if (rule.frequency === "monthly") {
    const dayStr = ordinal(rule.dayOfMonth ?? 1);
    return rule.interval > 1
      ? short ? `Every ${rule.interval}mo ${dayStr} ${timeStr}` : `Every ${rule.interval} months on the ${dayStr} at ${timeStr}`
      : short ? `Monthly ${dayStr} ${timeStr}` : `Monthly on the ${dayStr} at ${timeStr}`;
  }

  return "Recurring";
}

/**
 * Tiny inline badge for kanban cards — just the icon + short label.
 */
export function RecurringBadge({ recurringRuleId }: { recurringRuleId?: string | null }) {
  if (!recurringRuleId) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400"
      title="Recurring task"
    >
      <RefreshCw className="h-2.5 w-2.5" />
    </span>
  );
}

/**
 * Larger badge for kanban cards — icon + schedule text.
 */
export function RecurringScheduleBadge({ rule }: { rule: RecurringInfo }) {
  return (
    <span className="inline-flex items-center gap-1 text-blue-400">
      <RefreshCw className="h-3 w-3" />
      <span className="text-xs">{formatRecurringSchedule(rule, { short: true })}</span>
    </span>
  );
}

/**
 * Info block for task detail / edit pages — shows full schedule + date/time details.
 */
export function RecurringInfoBlock({ rule }: { rule: RecurringInfo }) {
  const timezone = useTimezone();
  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
          <RefreshCw className="h-3.5 w-3.5" />
          Recurring Task
        </div>
        {rule.isActive != null && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            rule.isActive
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-zinc-500/10 text-zinc-500"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${rule.isActive ? "bg-emerald-400" : "bg-zinc-500"}`} />
            {rule.isActive ? "Active" : "Paused"}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm text-zinc-300">
        {formatRecurringSchedule(rule)}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
        {rule.nextRunAt && (
          <span>
            Next run: <span className="text-zinc-400">{formatDateTime(rule.nextRunAt, timezone)}</span>
          </span>
        )}
        {rule.lastRunAt && (
          <span>
            Last run: <span className="text-zinc-400">{formatDateTime(rule.lastRunAt, timezone)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
