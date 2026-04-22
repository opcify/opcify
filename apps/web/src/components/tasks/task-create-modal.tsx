"use client";

import { useState } from "react";
import type { Agent, TaskPriority, RecurringFrequency, ChatAttachment } from "@opcify/core";
import { RefreshCw } from "lucide-react";
import { MarkdownEditor } from "../markdown-editor";
import { FileAttachmentPicker, type PendingFile } from "../file-attachment-picker";
import { formatDateTime } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: "high", label: "High", color: "border-red-500/60 bg-red-500/10 text-red-400" },
  { value: "medium", label: "Medium", color: "border-amber-500/60 bg-amber-500/10 text-amber-400" },
  { value: "low", label: "Low", color: "border-zinc-600 bg-zinc-800 text-zinc-400" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtTime(h: number, m: number): string {
  const period = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatRecurringSummary(freq: string, interval: number, dow: number, dom: number, h: number, m: number): string {
  const time = fmtTime(h, m);
  if (freq === "hourly") return `Every ${interval > 1 ? `${interval} hours` : "hour"} at :${String(m).padStart(2, "0")}`;
  if (freq === "daily") return `Every ${interval > 1 ? `${interval} days` : "day"} at ${time}`;
  if (freq === "weekly") return `Every ${interval > 1 ? `${interval} weeks` : "week"} on ${DAY_NAMES[dow]} at ${time}`;
  if (freq === "monthly") {
    const s = dom === 1 || dom === 21 || dom === 31 ? "st" : dom === 2 || dom === 22 ? "nd" : dom === 3 || dom === 23 ? "rd" : "th";
    return `Every ${interval > 1 ? `${interval} months` : "month"} on the ${dom}${s} at ${time}`;
  }
  return "Recurring";
}

interface ClientOption {
  id: string;
  name: string;
}

export interface RecurringConfig {
  frequency: RecurringFrequency;
  dayOfWeek?: number;
  dayOfMonth?: number;
  hour?: number;
  minute?: number;
  startDate?: string;
  interval: number;
}

export interface TaskCreateData {
  title: string;
  description: string;
  agentId: string;
  priority: TaskPriority;
  clientId?: string;
  recurring?: RecurringConfig;
  attachments?: ChatAttachment[];
}

interface TaskCreateModalProps {
  agents: Agent[];
  clients?: ClientOption[];
  onClose: () => void;
  onSubmit: (data: TaskCreateData) => void;
  submitting: boolean;
  defaultTitle?: string;
}

export function TaskCreateModal({
  agents,
  clients,
  onClose,
  onSubmit,
  submitting,
  defaultTitle,
}: TaskCreateModalProps) {
  const timezone = useTimezone();
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState(
    agents.find((a) => a.name === "COO")?.id ?? agents[0]?.id ?? "",
  );
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [clientId, setClientId] = useState("");

  // Attachments
  const [files, setFiles] = useState<PendingFile[]>([]);

  // Recurring state
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [startDate, setStartDate] = useState("");
  const [interval, setInterval_] = useState(1);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !agentId) return;

    const data: TaskCreateData = {
      title: title.trim(),
      description: description.trim(),
      agentId,
      priority,
      clientId: clientId || undefined,
      attachments: files.length > 0 ? files.map((f) => f.attachment) : undefined,
    };

    if (isRecurring) {
      data.recurring = {
        frequency,
        interval,
        hour,
        minute,
        ...(frequency === "weekly" ? { dayOfWeek } : {}),
        ...(frequency === "monthly" ? { dayOfMonth } : {}),
        ...(startDate ? { startDate: new Date(startDate).toISOString() } : {}),
      };
    }

    onSubmit(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="shrink-0 px-6 pt-6">
          <h2 className="text-lg font-semibold text-zinc-100">New Task</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Create a new task and assign it to an agent.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Title
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Research competitor pricing"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700"
            />
          </div>

          <div className="flex min-h-[320px] flex-col">
            <label className="mb-1.5 block shrink-0 text-xs font-medium text-zinc-400">
              Description
            </label>
            <div className="flex min-h-0 flex-1 flex-col">
              <MarkdownEditor
                value={description}
                onChange={setDescription}
                placeholder="Optional details…"
                fill
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Priority
            </label>
            <div className="flex gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    priority === p.value
                      ? p.color
                      : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Assign Agent
            </label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.role}
                </option>
              ))}
            </select>
          </div>

          {clients && clients.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Client <span className="text-zinc-600">(optional)</span>
              </label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
              >
                <option value="">No client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ── Attachments ────────────────────────────────────── */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Attachments <span className="text-zinc-600">(optional)</span>
            </label>
            <FileAttachmentPicker
              files={files}
              onChange={setFiles}
              disabled={submitting}
            />
          </div>

          {/* ── Recurring toggle ────────────────────────────────── */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={isRecurring}
                onClick={() => setIsRecurring(!isRecurring)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  isRecurring ? "bg-emerald-600" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    isRecurring ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                <RefreshCw className="h-3 w-3" />
                Recurring
              </span>
            </label>

            {isRecurring && (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 space-y-3">
                {/* Row 1: Frequency + day selector + interval */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-medium text-zinc-500">Frequency</label>
                    <select
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700"
                    >
                      <option value="hourly">Hourly</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>

                  {frequency === "weekly" && (
                    <div className="flex-1">
                      <label className="mb-1 block text-[11px] font-medium text-zinc-500">Day</label>
                      <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700">
                        {DAY_NAMES.map((name, i) => (<option key={i} value={i}>{name}</option>))}
                      </select>
                    </div>
                  )}

                  {frequency === "monthly" && (
                    <div className="flex-1">
                      <label className="mb-1 block text-[11px] font-medium text-zinc-500">Day of Month</label>
                      <select value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))}
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700">
                        {Array.from({ length: 28 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}</option>))}
                      </select>
                    </div>
                  )}

                  <div className="w-16">
                    <label className="mb-1 block text-[11px] font-medium text-zinc-500">Every</label>
                    <input type="number" min={1} max={12} value={interval}
                      onChange={(e) => setInterval_(Number(e.target.value))}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700" />
                  </div>
                </div>

                {/* Row 2: Time (hour + minute) */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-medium text-zinc-500">
                      {frequency === "hourly" ? "At Minute" : "Time"}
                    </label>
                    <div className="flex gap-1">
                      {frequency !== "hourly" && (
                        <select value={hour} onChange={(e) => setHour(Number(e.target.value))}
                          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700">
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
                          ))}
                        </select>
                      )}
                      <span className={`self-center text-xs text-zinc-600 ${frequency === "hourly" ? "hidden" : ""}`}>:</span>
                      <select value={minute} onChange={(e) => setMinute(Number(e.target.value))}
                        className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700">
                        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                          <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-medium text-zinc-500">
                      Start Date <span className="text-zinc-700">(optional)</span>
                    </label>
                    <input type="datetime-local" value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700 [color-scheme:dark]" />
                  </div>
                </div>

                {/* Summary */}
                <p className="text-[11px] text-zinc-600">
                  {formatRecurringSummary(frequency, interval, dayOfWeek, dayOfMonth, hour, minute)}
                  {startDate && ` · starts ${formatDateTime(startDate, timezone)}`}
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !agentId || submitting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Creating…" : isRecurring ? "Create Recurring Task" : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
