"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useWorkspace } from "@/lib/workspace-context";
import { Sparkles, Loader2, Eye } from "lucide-react";
import type { TaskDetail, TaskPriority, AgentSummary, DecompositionResult } from "@opcify/core";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { StatusBadge } from "@/components/status-badge";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { ReviewStatusBadge } from "@/components/tasks/review-status-badge";
import { Toast } from "@/components/toast";
import { timeAgo, formatTime } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import type { ReviewStatus } from "@opcify/core";

interface DecompositionItem {
  title: string;
  description: string;
  priority: TaskPriority;
  agentId: string;
  selected: boolean;
}

function parseDecompositionResult(resultContent: string | null): DecompositionResult | null {
  if (!resultContent) return null;
  try {
    const parsed = JSON.parse(resultContent);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.tasks)) {
      return parsed as DecompositionResult;
    }
    if (Array.isArray(parsed)) {
      return { goal: "", tasks: parsed };
    }
  } catch {
    // not valid JSON
  }
  return null;
}

function parseDecompositionItems(resultContent: string | null, defaultAgentId: string): DecompositionItem[] {
  const result = parseDecompositionResult(resultContent);
  if (result) {
    return result.tasks.map((t) => ({
      title: t.title ?? "",
      description: t.description ?? "",
      priority: (t.priority as TaskPriority) ?? "medium",
      agentId: defaultAgentId,
      selected: true,
    }));
  }

  if (!resultContent) return [];
  const lines = resultContent
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length > 0);
  return lines.map((line) => ({
    title: line,
    description: "",
    priority: "medium" as TaskPriority,
    agentId: defaultAgentId,
    selected: true,
  }));
}

interface DecompositionDetailProps {
  task: TaskDetail;
  onRefetch: () => void;
}

export function DecompositionDetail({ task, onRefetch }: DecompositionDetailProps) {
  const timezone = useTimezone();
  const router = useWorkspaceRouter();
  const { workspaceId } = useWorkspace();
  const searchParams = useSearchParams();
  const fromKanban = searchParams.get("from") === "kanban";
  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);

  const defaultAgentId = agents?.[0]?.id ?? "";
  const [items, setItems] = useState<DecompositionItem[]>(() =>
    parseDecompositionItems(task.resultContent, defaultAgentId),
  );
  const [initialized, setInitialized] = useState(!!task.resultContent);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [retryInstruction, setRetryInstruction] = useState("");
  const [showRetryContext, setShowRetryContext] = useState(false);

  if (agents && !initialized && items.length === 0 && task.resultContent) {
    setItems(parseDecompositionItems(task.resultContent, agents[0]?.id ?? ""));
    setInitialized(true);
  }
  if (agents && items.length > 0 && items[0].agentId === "" && agents[0]) {
    setItems((prev) => prev.map((it) => it.agentId === "" ? { ...it, agentId: agents[0].id } : it));
  }

  const hasResult = task.status === "done" && task.resultContent;
  const isReviewable = task.status === "done" && task.reviewStatus !== "accepted" && task.reviewStatus !== "followed_up";
  const decompositionResult = parseDecompositionResult(task.resultContent);

  const toggleItem = useCallback((idx: number) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, selected: !item.selected } : item));
  }, []);

  const updateItem = useCallback((idx: number, field: keyof DecompositionItem, value: string | boolean) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }, []);

  const addItem = useCallback(() => {
    setItems((prev) => [...prev, { title: "", description: "", priority: "medium", agentId: defaultAgentId, selected: true }]);
  }, [defaultAgentId]);

  const removeItem = useCallback((idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const selectedItems = items.filter((item) => item.selected && item.title.trim());
  const selectedCount = selectedItems.length;

  const handleCreateTasks = useCallback(async () => {
    if (selectedCount === 0 || creating) return;
    const invalid = selectedItems.filter((item) => !item.agentId);
    if (invalid.length > 0) {
      setError("Please assign an agent to all selected tasks");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const result = await api.taskGroups.createFromDecomposition(
        workspaceId,
        task.id,
        {
          tasks: selectedItems.map((item) => ({
            title: item.title.trim(),
            description: item.description.trim() || undefined,
            priority: item.priority,
            agentId: item.agentId,
          })),
        },
      );
      setToastMessage(`Task group created with ${result.tasks.length} tasks`);
      setTimeout(() => router.push(`/task-groups/${result.taskGroup.id}`), 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task group");
    } finally {
      setCreating(false);
    }
  }, [workspaceId, selectedItems, selectedCount, creating, task.id, router]);

  const handleAccept = useCallback(async () => {
    if (actionInFlight) return;
    setActionInFlight("accept");
    try {
      await api.kanban.acceptTask(workspaceId, task.id, reviewNotes || undefined);
      setReviewNotes("");
      onRefetch();
    } finally {
      setActionInFlight(null);
    }
  }, [workspaceId, task.id, reviewNotes, actionInFlight, onRefetch]);

  const handleRetry = useCallback(async () => {
    if (actionInFlight) return;
    setActionInFlight("retry");
    try {
      await api.kanban.retryTask(workspaceId, task.id, reviewNotes || undefined, retryInstruction.trim() || undefined);
      setReviewNotes("");
      setRetryInstruction("");
      setShowRetryContext(false);
      onRefetch();
    } finally {
      setActionInFlight(null);
    }
  }, [workspaceId, task.id, reviewNotes, retryInstruction, actionInFlight, onRefetch]);

  return (
    <>
      <Link
        href={fromKanban ? "/" : "/tasks"}
        className="text-sm text-zinc-500 hover:text-zinc-300"
      >
        {fromKanban ? "← Kanban" : "← Tasks"}
      </Link>

      {/* Header */}
      <div className="mt-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
              decomposition
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="flex h-4 w-4 items-center justify-center rounded bg-violet-500/10 text-violet-400"><Sparkles className="h-2.5 w-2.5" /></span>
              Decomposition Agent
            </span>
            <span className="mx-2 text-zinc-700">·</span>
            Created {timeAgo(task.createdAt)}
            {task.finishedAt && (
              <>
                <span className="mx-2 text-zinc-700">·</span>
                Finished {timeAgo(task.finishedAt)}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={task.status} />
          {task.reviewStatus && (
            <ReviewStatusBadge status={task.reviewStatus as ReviewStatus} />
          )}
          <TaskPriorityBadge priority={task.priority} />
        </div>
      </div>

      {/* Goal Summary */}
      <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Goal
        </h2>
        <p className="text-sm font-medium text-zinc-200">{task.title}</p>
        {task.description && (
          <p className="mt-2 text-sm text-zinc-400">{task.description}</p>
        )}
      </div>

      {/* Waiting / Running state */}
      {(task.status === "queued" || task.status === "running" || task.status === "waiting") && (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center">
          <div className="mb-3 flex justify-center">
            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${
              task.status === "running" ? "bg-emerald-500/10 text-emerald-400 animate-pulse" :
              task.status === "waiting" ? "bg-amber-500/10 text-amber-400" :
              "bg-zinc-800 text-zinc-500"
            }`}>
              <Loader2 className={`h-5 w-5 ${task.status === "running" ? "animate-spin" : ""}`} />
            </span>
          </div>
          <p className="text-sm font-medium text-zinc-300">
            {task.status === "running"
              ? "Decomposing goal into tasks…"
              : task.status === "waiting"
                ? "Waiting for input…"
                : "Queued — waiting to start"}
          </p>
          {task.progress > 0 && (
            <div className="mx-auto mt-4 max-w-xs">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500">{task.progress}%</p>
            </div>
          )}
        </div>
      )}

      {/* Failed state */}
      {task.status === "failed" && (
        <section className="mt-6 rounded-xl border border-red-500/20 bg-red-500/5 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <span className="text-red-400">✕</span>
            Decomposition Failed
          </h2>
          {task.resultSummary && (
            <p className="mb-3 text-sm text-zinc-400">{task.resultSummary}</p>
          )}
          <input
            type="text"
            value={retryInstruction}
            onChange={(e) => setRetryInstruction(e.target.value)}
            placeholder="Provide more context or adjust the goal…"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600"
          />
          <div className="mt-3">
            <button
              onClick={handleRetry}
              disabled={actionInFlight !== null}
              className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
            >
              {actionInFlight === "retry" ? "Retrying…" : "Retry Decomposition"}
            </button>
          </div>
        </section>
      )}

      {/* Result: generated tasks list */}
      {hasResult && (
        <>
          {/* Result summary */}
          {task.resultSummary && (
            <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Decomposition Summary
              </h2>
              <p className="text-sm text-zinc-300">{task.resultSummary}</p>
            </div>
          )}

          {/* Review panel */}
          {isReviewable && (
            <section className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900/80 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <Eye className="h-4 w-4 text-amber-400" />
                  Review Decomposition
                </h2>
                {task.reviewStatus && <ReviewStatusBadge status={task.reviewStatus as ReviewStatus} />}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                  Notes (optional)
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Add a note…"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-700"
                />
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleAccept}
                  disabled={actionInFlight !== null}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {actionInFlight === "accept" ? "Accepting…" : "Accept Result"}
                </button>
                <button
                  onClick={() => setShowRetryContext(!showRetryContext)}
                  disabled={actionInFlight !== null}
                  className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                >
                  Retry Decomposition
                </button>
              </div>

              {showRetryContext && (
                <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                    Retry with additional context (optional)
                  </label>
                  <input
                    type="text"
                    value={retryInstruction}
                    onChange={(e) => setRetryInstruction(e.target.value)}
                    placeholder="Be more specific, focus on marketing, limit to 5 tasks…"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600"
                  />
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={handleRetry}
                      disabled={actionInFlight !== null}
                      className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
                    >
                      {actionInFlight === "retry" ? "Retrying…" : "Retry"}
                    </button>
                    <button
                      onClick={() => { setShowRetryContext(false); setRetryInstruction(""); }}
                      className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Generated tasks list */}
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Generated Tasks ({items.length})
              </h2>
              {decompositionResult?.goal && (
                <span className="text-xs text-zinc-600">
                  Goal: {decompositionResult.goal}
                </span>
              )}
            </div>

            {items.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-6 py-8 text-center">
                <p className="text-sm text-zinc-500">No tasks could be extracted from the result.</p>
                <p className="mt-1 text-xs text-zinc-600">The raw result is shown above.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className={`rounded-lg border p-3 transition-colors ${
                      item.selected
                        ? "border-zinc-700 bg-zinc-900/80"
                        : "border-zinc-800/50 bg-zinc-900/30 opacity-50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <label className="mt-1 flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => toggleItem(idx)}
                          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-violet-500 focus:ring-violet-500/20"
                        />
                      </label>
                      <div className="min-w-0 flex-1 space-y-2">
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => updateItem(idx, "title", e.target.value)}
                          placeholder="Task title"
                          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600"
                        />
                        <textarea
                          value={item.description}
                          onChange={(e) => updateItem(idx, "description", e.target.value)}
                          placeholder="Description (optional)"
                          rows={1}
                          className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-700 outline-none focus:border-zinc-600"
                        />
                        <div className="flex gap-2">
                          <select
                            value={item.priority}
                            onChange={(e) => updateItem(idx, "priority", e.target.value)}
                            className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-zinc-600"
                          >
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                          <select
                            value={item.agentId || defaultAgentId}
                            onChange={(e) => updateItem(idx, "agentId", e.target.value)}
                            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-zinc-600"
                          >
                            <option value="">Select agent…</option>
                            {(agents ?? []).map((a: AgentSummary) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeItem(idx)}
                            className="rounded-md px-2 py-1 text-xs text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={addItem}
              className="mt-3 w-full rounded-lg border border-dashed border-zinc-700 py-2 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-300"
            >
              + Add Task
            </button>
          </section>

          {/* Create tasks action */}
          <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 px-5 py-4">
            {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-500">
                {selectedCount > 0
                  ? `Create a task group with ${selectedCount} selected task${selectedCount === 1 ? "" : "s"}`
                  : "Select at least one task to create a group"}
              </p>
              <button
                onClick={handleCreateTasks}
                disabled={selectedCount === 0 || creating}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
              >
                {creating ? "Creating…" : `Create Selected Tasks (${selectedCount})`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Raw result (if no structured data) */}
      {hasResult && items.length === 0 && task.resultContent && (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Raw Result
          </h2>
          <pre className="whitespace-pre-wrap text-xs text-zinc-400">
            {task.resultContent}
          </pre>
        </div>
      )}

      {/* Logs */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Logs
        </h2>
        {task.logs.length > 0 ? (
          <div className="space-y-1">
            {task.logs.map((log) => (
              <div
                key={log.id}
                className="flex gap-3 rounded-md bg-zinc-900 px-4 py-2.5 font-mono text-xs"
              >
                <span className="shrink-0 text-zinc-600">
                  {formatTime(log.createdAt, timezone)}
                </span>
                <span
                  className={`shrink-0 font-medium ${
                    log.level === "error" ? "text-red-400" : "text-zinc-500"
                  }`}
                >
                  {log.level.toUpperCase().padEnd(5)}
                </span>
                <span className="text-zinc-300">{log.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No logs recorded</p>
        )}
      </section>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </>
  );
}
