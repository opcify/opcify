"use client";

import { Suspense, use, useState, useEffect, useCallback, useMemo } from "react";
import { WsLink as Link } from "@/lib/workspace-link";
import { useSearchParams } from "next/navigation";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useWorkspace } from "@/lib/workspace-context";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type {
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
  RecurringFrequency,
} from "@opcify/core";
import { formatRecurringSchedule } from "@/components/tasks/recurring-badge";
import { formatDate, formatDateTime } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import { RefreshCw } from "lucide-react";
import { MarkdownEditor } from "@/components/markdown-editor";

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  {
    value: "high",
    label: "High",
    color: "border-red-500/60 bg-red-500/10 text-red-400",
  },
  {
    value: "medium",
    label: "Medium",
    color: "border-amber-500/60 bg-amber-500/10 text-amber-400",
  },
  {
    value: "low",
    label: "Low",
    color: "border-zinc-600 bg-zinc-800 text-zinc-400",
  },
];

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "waiting", label: "Waiting" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
];

function EditTaskFallback() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-zinc-800" />
      <div className="h-96 rounded-lg bg-zinc-900" />
    </div>
  );
}

export default function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<EditTaskFallback />}>
      <EditTaskContent params={params} />
    </Suspense>
  );
}

function EditTaskContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const timezone = useTimezone();
  const router = useWorkspaceRouter();
  const { workspaceId } = useWorkspace();
  const searchParams = useSearchParams();
  const fromKanban = searchParams.get("from") === "kanban";

  const {
    data: task,
    loading: taskLoading,
    error: taskError,
    refetch: refetchTask,
  } = useApi(() => api.tasks.get(workspaceId, id), [workspaceId, id]);
  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);
  const { data: clients } = useApi(
    () => api.clients.list({ workspaceId, status: "active" }),
    [workspaceId],
  );
  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ id: c.id, name: c.name })),
    [clients],
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [clientId, setClientId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("queued");
  const [plannedDate, setPlannedDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Recurring state
  const [recFrequency, setRecFrequency] = useState<RecurringFrequency>("weekly");
  const [recInterval, setRecInterval] = useState(1);
  const [recDayOfWeek, setRecDayOfWeek] = useState(1);
  const [recDayOfMonth, setRecDayOfMonth] = useState(1);
  const [recHour, setRecHour] = useState(9);
  const [recMinute, setRecMinute] = useState(0);
  const [recStartDate, setRecStartDate] = useState("");
  const [recIsActive, setRecIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Prefill form when task loads
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description || "");
    setAgentId(task.agentId);
    setClientId(task.clientId ?? "");
    setPriority(task.priority);
    setStatus(task.status);
    const pd = task.plannedDate ? task.plannedDate.slice(0, 10) : "";
    setPlannedDate(pd);
    setShowDatePicker(!!pd);
    // Prefill recurring
    if (task.recurringRule) {
      setRecFrequency((task.recurringRule.frequency || "weekly") as RecurringFrequency);
      setRecInterval(task.recurringRule.interval || 1);
      setRecDayOfWeek(task.recurringRule.dayOfWeek ?? 1);
      setRecDayOfMonth(task.recurringRule.dayOfMonth ?? 1);
      setRecHour(task.recurringRule.hour ?? 9);
      setRecMinute(task.recurringRule.minute ?? 0);
      setRecStartDate(task.recurringRule.startDate ? task.recurringRule.startDate.slice(0, 16) : "");
      setRecIsActive(task.recurringRule.isActive);
    }
    setDirty(false);
  }, [task]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setSaved(false);
  }, []);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    setSaveError(null);

    const payload: UpdateTaskInput = {
      title: title.trim(),
      description: description.trim(),
      agentId,
      priority,
      status,
      plannedDate: plannedDate || null,
      clientId: clientId || null,
    };

    try {
      await api.tasks.update(workspaceId, id, payload);

      // Also update recurring rule if this task has one
      if (task?.recurringRule) {
        await api.recurring.update(workspaceId, task.recurringRule.id, {
          frequency: recFrequency,
          interval: recInterval,
          dayOfWeek: recFrequency === "weekly" ? recDayOfWeek : null,
          dayOfMonth: recFrequency === "monthly" ? recDayOfMonth : null,
          hour: recHour,
          minute: recMinute,
          startDate: recStartDate ? new Date(recStartDate).toISOString() : null,
          isActive: recIsActive,
        });
      }

      setDirty(false);
      setSaved(true);
      setTimeout(() => {
        router.push(`/tasks/${id}`);
      }, 600);
    } catch (err: unknown) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save changes"
      );
    } finally {
      setSaving(false);
    }
  }

  // Loading state
  if (taskLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 h-5 w-24 rounded bg-zinc-800" />
        <div className="animate-pulse space-y-6 rounded-xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="h-7 w-48 rounded bg-zinc-800" />
          <div className="h-4 w-64 rounded bg-zinc-800/60" />
          <div className="space-y-4 pt-2">
            <div className="h-10 rounded-lg bg-zinc-800/50" />
            <div className="h-24 rounded-lg bg-zinc-800/50" />
            <div className="flex gap-2">
              <div className="h-9 flex-1 rounded-lg bg-zinc-800/50" />
              <div className="h-9 flex-1 rounded-lg bg-zinc-800/50" />
              <div className="h-9 flex-1 rounded-lg bg-zinc-800/50" />
            </div>
            <div className="h-10 rounded-lg bg-zinc-800/50" />
            <div className="h-10 rounded-lg bg-zinc-800/50" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (taskError) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link
          href={fromKanban ? "/kanban" : "/tasks"}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          {fromKanban ? "← Kanban" : "← Tasks"}
        </Link>
        <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
            <span className="text-xl text-red-400">!</span>
          </div>
          <h2 className="text-lg font-semibold text-zinc-100">
            Failed to load task
          </h2>
          <p className="mt-1 text-sm text-zinc-400">{taskError}</p>
          <button
            onClick={refetchTask}
            className="mt-4 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link
          href={fromKanban ? "/kanban" : "/tasks"}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          {fromKanban ? "← Kanban" : "← Tasks"}
        </Link>
        <p className="mt-6 text-zinc-400">Task not found</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={fromKanban ? `/tasks/${id}?from=kanban` : `/tasks/${id}`}
        className="text-sm text-zinc-500 hover:text-zinc-300"
      >
        ← Back to Task
      </Link>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">
            Edit Task
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {task.title}
            <span className="mx-1.5 text-zinc-700">·</span>
            <span className="font-mono text-xs text-zinc-600">
              {id.slice(0, 8)}
            </span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                markDirty();
              }}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-700"
            />
            {!title.trim() && dirty && (
              <p className="mt-1 text-xs text-red-400">Title is required</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Description
            </label>
            <MarkdownEditor
              value={description}
              onChange={(v) => { setDescription(v); markDirty(); }}
              placeholder="Optional details…"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Priority
            </label>
            <div className="flex gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    setPriority(p.value);
                    markDirty();
                  }}
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

          {/* Status */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as TaskStatus);
                markDirty();
              }}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-700"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Assigned Agent */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Assigned Agent
            </label>
            <select
              value={agentId}
              onChange={(e) => {
                setAgentId(e.target.value);
                markDirty();
              }}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-700"
            >
              {agents?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.role}
                </option>
              ))}
            </select>
          </div>

          {/* Client (optional) */}
          {clientOptions.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Client <span className="text-zinc-600">(optional)</span>
              </label>
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  markDirty();
                }}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-700"
              >
                <option value="">No client</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Planned Date */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Planned Date
            </label>
            {showDatePicker ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={plannedDate}
                  onChange={(e) => {
                    setPlannedDate(e.target.value);
                    markDirty();
                  }}
                  autoFocus
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-zinc-700 [color-scheme:dark]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPlannedDate("");
                    setShowDatePicker(false);
                    markDirty();
                  }}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowDatePicker(true)}
                className="w-full rounded-lg border border-dashed border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-400"
              >
                Set a planned date…
              </button>
            )}
          </div>

          {/* Recurring Schedule */}
          {task.recurringRule && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Recurring Schedule
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-zinc-500">{recIsActive ? "Active" : "Paused"}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={recIsActive}
                    onClick={() => { setRecIsActive(!recIsActive); markDirty(); }}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      recIsActive ? "bg-emerald-600" : "bg-zinc-700"
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      recIsActive ? "translate-x-4" : "translate-x-0.5"
                    }`} />
                  </button>
                </label>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-500">Frequency</label>
                  <select
                    value={recFrequency}
                    onChange={(e) => { setRecFrequency(e.target.value as RecurringFrequency); markDirty(); }}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700"
                  >
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                {recFrequency === "weekly" && (
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-medium text-zinc-500">Day</label>
                    <select
                      value={recDayOfWeek}
                      onChange={(e) => { setRecDayOfWeek(Number(e.target.value)); markDirty(); }}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700"
                    >
                      {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((name, i) => (
                        <option key={i} value={i}>{name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {recFrequency === "monthly" && (
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-medium text-zinc-500">Day of Month</label>
                    <select
                      value={recDayOfMonth}
                      onChange={(e) => { setRecDayOfMonth(Number(e.target.value)); markDirty(); }}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700"
                    >
                      {Array.from({ length: 28 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>{i + 1}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="w-16">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-500">Every</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={recInterval}
                    onChange={(e) => { setRecInterval(Number(e.target.value)); markDirty(); }}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700"
                  />
                </div>
              </div>

              {/* Time (hour + minute) */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-500">
                    {recFrequency === "hourly" ? "At Minute" : "Time"}
                  </label>
                  <div className="flex gap-1">
                    {recFrequency !== "hourly" && (
                      <select value={recHour} onChange={(e) => { setRecHour(Number(e.target.value)); markDirty(); }}
                        className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700">
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
                        ))}
                      </select>
                    )}
                    {recFrequency !== "hourly" && <span className="self-center text-xs text-zinc-600">:</span>}
                    <select value={recMinute} onChange={(e) => { setRecMinute(Number(e.target.value)); markDirty(); }}
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
                  <input type="datetime-local" value={recStartDate}
                    onChange={(e) => { setRecStartDate(e.target.value); markDirty(); }}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700 [color-scheme:dark]" />
                </div>
              </div>

              {/* Summary + dates */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-500">
                <span className="text-zinc-400">
                  {formatRecurringSchedule({ frequency: recFrequency, interval: recInterval, dayOfWeek: recDayOfWeek, dayOfMonth: recDayOfMonth, hour: recHour, minute: recMinute })}
                </span>
                {task.recurringRule.nextRunAt && (
                  <span>
                    Next: <span className="text-zinc-400">{formatDateTime(task.recurringRule.nextRunAt, timezone)}</span>
                  </span>
                )}
                {task.recurringRule.lastRunAt && (
                  <span>
                    Last: <span className="text-zinc-400">{formatDateTime(task.recurringRule.lastRunAt, timezone)}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="rounded-lg border border-zinc-800/50 bg-zinc-950/50 px-4 py-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
              <span>
                Created{" "}
                {formatDate(task.createdAt, timezone)}
              </span>
              <span>
                Updated{" "}
                {formatDate(task.updatedAt, timezone)}
              </span>
              <span className="font-mono">{id}</span>
            </div>
          </div>

          {/* Save error */}
          {saveError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
              {saveError}
            </div>
          )}

          {/* Success feedback */}
          {saved && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
              Changes saved successfully. Redirecting…
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-zinc-800 pt-5">
            <div className="flex items-center gap-2">
              <Link
                href={`/tasks/${id}`}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                Cancel
              </Link>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("Archive this task? It will be hidden from the kanban board.")) return;
                  await api.tasks.archive(workspaceId, id);
                  router.push("/kanban");
                }}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
              >
                Archive
              </button>
            </div>
            <button
              type="submit"
              disabled={!title.trim() || saving || saved}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : saved ? "Saved!" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
