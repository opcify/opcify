"use client";

import { Suspense, use, useState, useCallback, useEffect } from "react";
import { WsLink as Link } from "@/lib/workspace-link";
import { useSearchParams } from "next/navigation";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useWorkspace } from "@/lib/workspace-context";
import { Star, Sparkles, Clock, Eye, ArrowRight, CornerDownRight, Download, Maximize2, X } from "lucide-react";
import dynamic from "next/dynamic";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });
import { RecurringScheduleBadge, RecurringInfoBlock } from "@/components/tasks/recurring-badge";
import type { TaskPriority, ReviewStatus, FollowUpTaskInfo, WaitingReason, TaskWithAgent } from "@opcify/core";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useTaskEvents } from "@/lib/use-task-events";
import { StatusBadge } from "@/components/status-badge";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { ReviewStatusBadge } from "@/components/tasks/review-status-badge";
import { DecompositionDetail } from "@/components/tasks/decomposition-detail";
import { ExecutionPanel } from "@/components/tasks/execution-panel";
import { BlockingQuestionPanel } from "@/components/tasks/blocking-question-panel";
import { Toast } from "@/components/toast";
import { timeAgo, formatTime } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";

function TaskDetailFallback() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-zinc-800" />
      <div className="h-64 rounded-lg bg-zinc-900" />
    </div>
  );
}

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<TaskDetailFallback />}>
      <TaskDetailContent params={params} />
    </Suspense>
  );
}

function TaskDetailContent({
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
  const { data: task, loading, error, refetch } = useApi(
    () => api.tasks.get(workspaceId, id),
    [workspaceId, id],
  );
  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);

  // SSE: live updates for this task
  const { lastEvent } = useTaskEvents(workspaceId);

  useEffect(() => {
    if (!lastEvent || !task) return;

    // Refetch on any update to this task (status, progress, steps)
    if (
      (lastEvent.type === "task:updated" && lastEvent.taskId === id) ||
      (lastEvent.type === "step:updated" && lastEvent.taskId === id)
    ) {
      refetch();
    }
  }, [lastEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling fallback: keep task state fresh while running/waiting
  useEffect(() => {
    if (!task || (task.status !== "running" && task.status !== "waiting")) return;
    const interval = setInterval(refetch, 5000);
    return () => clearInterval(interval);
  }, [task?.status, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [retryInstruction, setRetryInstruction] = useState("");
  const [showRetryContext, setShowRetryContext] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [resultFullscreen, setResultFullscreen] = useState(false);

  // Lock body scroll when fullscreen overlay is open
  useEffect(() => {
    if (resultFullscreen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [resultFullscreen]);
  const [followUpTitle, setFollowUpTitle] = useState("");
  const [followUpDesc, setFollowUpDesc] = useState("");
  const [followUpAgentId, setFollowUpAgentId] = useState("");
  const [followUpPriority, setFollowUpPriority] = useState<TaskPriority>("medium");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [focusToggling, setFocusToggling] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [editingBlocker, setEditingBlocker] = useState(false);
  const [blockerReason, setBlockerReason] = useState<WaitingReason | "">("");
  const [blockerTaskId, setBlockerTaskId] = useState<string>("");
  const [savingBlocker, setSavingBlocker] = useState(false);

  const { data: allTasks } = useApi(
    () => api.tasks.list(workspaceId, { limit: "100" }),
    [workspaceId],
  );
  const followUpTasks = task?.followUpTasks ?? [];

  const handleAccept = useCallback(async () => {
    if (actionInFlight) return;
    setActionInFlight("accept");
    try {
      const result = await api.kanban.acceptTask(workspaceId, id, reviewNotes || undefined);
      if (result.parentAutoAccepted) {
        setToastMessage("Parent task also marked as accepted");
      }
      setReviewNotes("");
      refetch();
    } finally {
      setActionInFlight(null);
    }
  }, [workspaceId, id, reviewNotes, actionInFlight, refetch]);

  const handleRetry = useCallback(async () => {
    if (actionInFlight) return;
    setActionInFlight("retry");
    try {
      await api.kanban.retryTask(
        workspaceId,
        id,
        reviewNotes || undefined,
        retryInstruction.trim() || undefined,
      );
      setReviewNotes("");
      setRetryInstruction("");
      setShowRetryContext(false);
      refetch();
    } finally {
      setActionInFlight(null);
    }
  }, [workspaceId, id, reviewNotes, retryInstruction, actionInFlight, refetch]);

  const handleFollowUp = useCallback(async () => {
    if (actionInFlight || !followUpTitle.trim()) return;
    setActionInFlight("followup");
    try {
      const result = await api.kanban.followUpTask(workspaceId, id, {
        title: followUpTitle.trim(),
        description: followUpDesc.trim() || undefined,
        agentId: followUpAgentId || undefined,
        priority: followUpPriority,
      });
      setShowFollowUp(false);
      router.push(`/tasks/${result.followUpTask.id}`);
    } finally {
      setActionInFlight(null);
    }
  }, [workspaceId, id, followUpTitle, followUpDesc, followUpAgentId, followUpPriority, actionInFlight, router]);

  const handleToggleFocus = useCallback(async () => {
    if (!task || focusToggling) return;
    setFocusToggling(true);
    try {
      await api.kanban.toggleFocus(workspaceId, id, !task.isFocus);
      refetch();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : "Failed to toggle focus");
    } finally {
      setFocusToggling(false);
    }
  }, [workspaceId, id, task, focusToggling, refetch]);

  const handleSaveAsTemplate = useCallback(async () => {
    if (savingTemplate) return;
    setSavingTemplate(true);
    try {
      await api.taskTemplates.saveFromTask(workspaceId, id);
      setToastMessage("Saved to Task Template");
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSavingTemplate(false);
    }
  }, [workspaceId, id, savingTemplate]);

  const handleSaveBlocker = useCallback(async () => {
    if (savingBlocker) return;
    setSavingBlocker(true);
    try {
      await api.tasks.update(workspaceId, id, {
        waitingReason: blockerReason || null,
        blockedByTaskId: blockerTaskId || null,
      });
      setEditingBlocker(false);
      refetch();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : "Failed to save blocker info");
    } finally {
      setSavingBlocker(false);
    }
  }, [workspaceId, id, blockerReason, blockerTaskId, savingBlocker, refetch]);

  const handleStop = useCallback(async () => {
    if (actionInFlight) return;
    setActionInFlight("stop");
    try {
      await api.tasks.stop(workspaceId, id);
      refetch();
    } catch (err) {
      setToastMessage(
        err instanceof Error ? err.message : "Failed to stop task",
      );
    } finally {
      setActionInFlight(null);
    }
  }, [workspaceId, id, actionInFlight, refetch]);

  const handleClearBlocker = useCallback(async () => {
    if (savingBlocker) return;
    setSavingBlocker(true);
    try {
      await api.tasks.update(workspaceId, id, {
        waitingReason: null,
        blockedByTaskId: null,
      });
      setBlockerReason("");
      setBlockerTaskId("");
      setEditingBlocker(false);
      refetch();
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : "Failed to clear blocker");
    } finally {
      setSavingBlocker(false);
    }
  }, [workspaceId, id, savingBlocker, refetch]);

  const openFollowUp = useCallback(() => {
    if (!task) return;
    setFollowUpTitle(`Follow up: ${task.title}`);
    setFollowUpDesc("");
    setFollowUpAgentId(task.agent.id);
    setShowFollowUp(true);
  }, [task]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-60 rounded bg-zinc-800" />
        <div className="h-40 rounded-lg bg-zinc-900" />
      </div>
    );
  }
  if (error) return <p className="text-red-400">Failed to load: {error}</p>;
  if (!task) return <p className="text-zinc-400">Task not found</p>;

  if (task.taskType === "decomposition") {
    return <DecompositionDetail task={task} onRefetch={refetch} />;
  }

  const isReviewable = task.status === "done" && task.reviewStatus !== "accepted" && task.reviewStatus !== "followed_up";
  const isAccepted = task.status === "done" && task.reviewStatus === "accepted";
  const isFollowedUp = task.status === "done" && task.reviewStatus === "followed_up";

  return (
    <>
      <Link
        href={fromKanban ? "/kanban" : "/tasks"}
        className="text-sm text-zinc-500 hover:text-zinc-300"
      >
        {fromKanban ? "← Kanban" : "← Tasks"}
      </Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Agent:{" "}
            <Link
              href={`/agents/${task.agent.id}`}
              className="text-zinc-300 hover:text-white"
            >
              {task.agent.name}
            </Link>
            <span className="mx-2 text-zinc-700">·</span>
            {task.agent.role}
            {task.client && (
              <>
                <span className="mx-2 text-zinc-700">·</span>
                Client:{" "}
                <Link
                  href={`/clients/${task.client.id}`}
                  className="text-zinc-300 hover:text-white"
                >
                  {task.client.name}
                </Link>
              </>
            )}
            {task.recurringRule && (
              <>
                <span className="mx-2 text-zinc-700">·</span>
                <RecurringScheduleBadge rule={task.recurringRule} />
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleFocus}
            disabled={focusToggling}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              task.isFocus
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/20"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {task.isFocus ? <><Star className="inline h-3.5 w-3.5 fill-current" /> Focused</> : <><Star className="inline h-3.5 w-3.5" /> Focus</>}
          </button>
          {(task.status === "running" || task.status === "queued") && (
            <button
              onClick={handleStop}
              disabled={actionInFlight !== null}
              className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-400 transition-colors hover:border-orange-500/50 hover:bg-orange-500/20 disabled:opacity-50"
            >
              {actionInFlight === "stop" ? "Stopping…" : "Stop"}
            </button>
          )}
          {(task.status === "done" || task.reviewStatus === "accepted") && (
            <button
              onClick={handleSaveAsTemplate}
              disabled={savingTemplate}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-50"
            >
              {savingTemplate ? "Saving…" : "Save as Template"}
            </button>
          )}
          <Link
            href={fromKanban ? `/tasks/${id}/edit?from=kanban` : `/tasks/${id}/edit`}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Edit
          </Link>
          <TaskPriorityBadge priority={task.priority} />
          <StatusBadge status={task.status} />
          {task.executionMode !== "single" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">
              <Sparkles className="h-3 w-3" />
              {task.executionMode === "orchestrated" ? "Orchestrated" : "Multi-Agent"}
            </span>
          )}
          {task.reviewStatus && (
            <ReviewStatusBadge status={task.reviewStatus as ReviewStatus} />
          )}
        </div>
      </div>

      {task.description && (
        <p className="mt-3 text-sm text-zinc-400">{task.description}</p>
      )}

      {task.recurringRule && (
        <div className="mt-3">
          <RecurringInfoBlock rule={task.recurringRule} />
        </div>
      )}

      {task.sourceTask && (
        <div className="mt-3 rounded-md border border-blue-500/15 bg-blue-500/5 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            <CornerDownRight className="h-3 w-3 text-blue-400/60" />
            Follow-up from
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Link
              href={`/tasks/${task.sourceTask.id}`}
              className="text-sm text-zinc-300 hover:text-white"
            >
              {task.sourceTask.title}
            </Link>
            {task.sourceTask.reviewStatus && (
              <ReviewStatusBadge status={task.sourceTask.reviewStatus as ReviewStatus} />
            )}
          </div>
          {task.sourceTask.resultSummary && (
            <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500">
              {task.sourceTask.resultSummary}
            </p>
          )}
        </div>
      )}

      {!task.sourceTask && task.sourceTaskId && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <span className="text-xs text-zinc-600">Derived from</span>
          <Link
            href={`/tasks/${task.sourceTaskId}`}
            className="text-xs text-zinc-400 underline hover:text-zinc-200"
          >
            parent task
          </Link>
        </div>
      )}

      {task.taskGroup && (
        <div className="mt-3 rounded-md border border-violet-500/15 bg-violet-500/5 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            <span className="text-violet-400/60">▧</span>
            Task Group
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Link
              href={`/task-groups/${task.taskGroup.id}`}
              className="text-sm text-zinc-300 hover:text-white"
            >
              {task.taskGroup.title}
            </Link>
            <Link
              href={`/task-groups/${task.taskGroup.id}`}
              className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400 transition-colors hover:border-violet-500/50 hover:bg-violet-500/20"
            >
              View Group
            </Link>
          </div>
        </div>
      )}

      {/* Stopped Section */}
      {task.status === "stopped" && (
        <div className="mt-3 rounded-md border border-orange-500/15 bg-orange-500/5 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            <Clock className="h-3 w-3 text-orange-400/60" />
            Stopped
          </div>
          <p className="mt-2 text-sm text-orange-400">
            {task.resultSummary || "Task was stopped by the user"}
          </p>
          {task.finishedAt && (
            <p className="mt-1 text-xs text-zinc-600">
              Stopped {timeAgo(task.finishedAt)}
            </p>
          )}
        </div>
      )}

      {/* Blocking question — when the agent is waiting for CEO input */}
      {task.status === "waiting" && task.blockingQuestion && (
        <BlockingQuestionPanel
          workspaceId={workspaceId}
          taskId={task.id}
          question={task.blockingQuestion}
          onResolved={(summary) => {
            setToastMessage(summary);
            refetch();
          }}
        />
      )}

      {/* Waiting / Blocker Section */}
      {(task.waitingReason || task.blockedByTask || editingBlocker) && (
        <div className="mt-3 rounded-md border border-orange-500/15 bg-orange-500/5 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              <Clock className="h-3 w-3 text-orange-400/60" />
              Waiting / Blocker
            </div>
            {!editingBlocker && (
              <button
                onClick={() => {
                  setBlockerReason(task.waitingReason ?? "");
                  setBlockerTaskId(task.blockedByTaskId ?? "");
                  setEditingBlocker(true);
                }}
                className="rounded-md px-2 py-0.5 text-[10px] font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                Edit
              </button>
            )}
          </div>

          {!editingBlocker ? (
            <div className="mt-2 space-y-1.5">
              {task.waitingReason && (
                <p className="text-sm text-orange-400">
                  {task.waitingReason === "waiting_for_review" && "Waiting for review"}
                  {task.waitingReason === "waiting_for_input" && "Waiting for input"}
                  {task.waitingReason === "waiting_for_dependency" && "Blocked by dependency"}
                  {task.waitingReason === "waiting_for_retry" && "Waiting for retry"}
                  {task.waitingReason === "waiting_for_external" && "Waiting (external)"}
                </p>
              )}
              {task.blockedByTask && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Blocked by:</span>
                  <Link
                    href={`/tasks/${task.blockedByTask.id}`}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    {task.blockedByTask.title}
                  </Link>
                  <StatusBadge status={task.blockedByTask.status} />
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Waiting Reason
                </label>
                <select
                  value={blockerReason}
                  onChange={(e) => setBlockerReason(e.target.value as WaitingReason | "")}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
                >
                  <option value="">None</option>
                  <option value="waiting_for_review">Waiting for review</option>
                  <option value="waiting_for_input">Waiting for input</option>
                  <option value="waiting_for_dependency">Waiting for dependency</option>
                  <option value="waiting_for_retry">Waiting for retry</option>
                  <option value="waiting_for_external">Waiting (external)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Blocked By Task
                </label>
                <select
                  value={blockerTaskId}
                  onChange={(e) => setBlockerTaskId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
                >
                  <option value="">None</option>
                  {(allTasks ?? [])
                    .filter((t: TaskWithAgent) => t.id !== id)
                    .map((t: TaskWithAgent) => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({t.status})
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveBlocker}
                  disabled={savingBlocker}
                  className="rounded-md bg-orange-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-500 disabled:opacity-50"
                >
                  {savingBlocker ? "Saving…" : "Save"}
                </button>
                {(task.waitingReason || task.blockedByTaskId) && (
                  <button
                    onClick={handleClearBlocker}
                    disabled={savingBlocker}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setEditingBlocker(false)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!task.waitingReason && !task.blockedByTask && !editingBlocker && (
        <button
          onClick={() => {
            setBlockerReason("");
            setBlockerTaskId("");
            setEditingBlocker(true);
          }}
          className="mt-3 rounded-md border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-600 transition-colors hover:border-zinc-700 hover:text-zinc-400"
        >
          + Add Waiting Reason / Blocker
        </button>
      )}

      {followUpTasks.length > 0 && (
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Continued by
            </p>
            {followUpTasks.length > 1 && (
              <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                {followUpTasks.length}
              </span>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            {followUpTasks.map((ft: FollowUpTaskInfo) => (
              <div key={ft.id} className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    ft.reviewStatus === "accepted"
                      ? "bg-emerald-400"
                      : ft.status === "done"
                        ? "bg-amber-400"
                        : ft.status === "running"
                          ? "bg-emerald-400 animate-pulse"
                          : "bg-zinc-600"
                  }`}
                />
                <Link
                  href={`/tasks/${ft.id}`}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  {ft.title}
                </Link>
                <span className={`text-[10px] ${
                  ft.reviewStatus === "accepted"
                    ? "text-emerald-500"
                    : ft.status === "running"
                      ? "text-emerald-500"
                      : ft.status === "done"
                        ? "text-amber-500"
                        : "text-zinc-600"
                }`}>
                  {ft.reviewStatus === "accepted" ? "accepted" : ft.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs ${
              task.status === "done"
                ? "bg-emerald-500/15 text-emerald-400"
                : task.status === "failed"
                  ? "bg-red-500/15 text-red-400"
                  : task.status === "running"
                    ? "bg-blue-500/15 text-blue-400"
                    : "bg-zinc-800 text-zinc-500"
            }`}>
              {task.status === "done" ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : task.status === "failed" ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              ) : task.status === "running" ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-current" />
              )}
            </span>
            <span className="text-xs font-medium text-zinc-300">
              {task.status === "done" ? "Completed" : task.status === "failed" ? "Failed" : task.status === "running" ? "In Progress" : task.status === "waiting" ? "Waiting" : "Queued"}
            </span>
          </div>
          <span className={`text-lg font-bold tabular-nums ${
            task.progress >= 100
              ? "text-emerald-400"
              : task.status === "failed"
                ? "text-red-400"
                : task.progress > 0
                  ? "text-zinc-200"
                  : "text-zinc-600"
          }`}>
            {task.progress}%
          </span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              task.status === "failed"
                ? "bg-red-500"
                : task.progress >= 100
                  ? "bg-emerald-500"
                  : "bg-gradient-to-r from-blue-500 to-cyan-400"
            }`}
            style={{ width: `${task.progress}%` }}
          />
        </div>
      </div>

      {/* Execution Panel for multi-agent tasks — unified tracker + step cards + lifecycle */}
      {task.executionMode !== "single" && task.executionSteps && task.executionSteps.length > 0 && (
        <ExecutionPanel
          executionMode={task.executionMode}
          steps={task.executionSteps}
          task={task}
        />
      )}


      {/* Agent Context */}
      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Agent Context
        </h2>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600">Agent:</span>
            <Link
              href={`/agents/${task.agent.id}`}
              className="text-sm font-medium text-zinc-200 hover:text-white"
            >
              {task.agent.name}
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600">Model:</span>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
              {task.agent.model}
            </span>
          </div>
        </div>
      </div>

      {/* Result Section */}
      {(task.resultSummary || task.resultContent) && (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Result Output
            </h2>
            {task.resultContent && (
              <button
                onClick={() => {
                  const content = `# ${task.title}\n\n${task.resultSummary ? `> ${task.resultSummary}\n\n` : ""}${task.resultContent}`;
                  const blob = new Blob([content], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${task.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
              >
                <Download className="h-3 w-3" />
                Download
              </button>
            )}
          </div>
          {task.resultSummary && (
            <p className="mt-2 text-sm text-zinc-300">{task.resultSummary}</p>
          )}
          {task.resultContent && (
            <div className="group/viewer relative mt-3 result-preview-container" data-color-mode="dark">
              <button
                onClick={() => setResultFullscreen(true)}
                className="absolute right-2 top-2 z-10 rounded-md border border-zinc-700 bg-zinc-900/80 p-1.5 text-zinc-500 opacity-0 backdrop-blur-sm transition-all hover:border-zinc-600 hover:text-zinc-200 group-hover/viewer:opacity-100"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <MDEditor
                value={task.resultContent}
                preview="preview"
                hideToolbar
                height={Math.min(600, Math.max(200, task.resultContent.split("\n").length * 24))}
                visibleDragbar={false}
                style={{
                  backgroundColor: "rgb(9, 9, 11)",
                  borderRadius: "0.5rem",
                  border: "1px solid rgb(39, 39, 42)",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Fullscreen Result Overlay */}
      {resultFullscreen && task.resultContent && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-zinc-950/95 backdrop-blur-sm">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200">{task.title}</h2>
              {task.resultSummary && (
                <p className="mt-0.5 text-xs text-zinc-500">{task.resultSummary}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const content = `# ${task.title}\n\n${task.resultSummary ? `> ${task.resultSummary}\n\n` : ""}${task.resultContent}`;
                  const blob = new Blob([content], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${task.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
              <button
                onClick={() => setResultFullscreen(false)}
                className="rounded-md border border-zinc-700 p-1.5 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-6 result-fullscreen-container" data-color-mode="dark">
            <div className="mx-auto max-w-4xl pb-12">
              <MDEditor
                value={task.resultContent}
                preview="preview"
                hideToolbar
                height={99999}
                visibleDragbar={false}
                style={{
                  backgroundColor: "transparent",
                  border: "none",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Review Panel */}
      {(isReviewable || isAccepted || isFollowedUp) && (
        <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900/80 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Eye className={`h-4 w-4 ${isFollowedUp ? "text-blue-400" : "text-amber-400"}`} />
              Review Panel
            </h2>
            {task.reviewStatus && (
              <ReviewStatusBadge status={task.reviewStatus as ReviewStatus} />
            )}
          </div>

          {/* Followed-up state */}
          {isFollowedUp && (
            <div className="space-y-2 text-sm">
              <p className="text-xs text-zinc-500">
                This task has been continued through a follow-up task.
              </p>
              {followUpTasks.length > 0 && (
                <div className="mt-2 space-y-1">
                  {followUpTasks.map((ft: FollowUpTaskInfo) => (
                    <Link
                      key={ft.id}
                      href={`/tasks/${ft.id}`}
                      className="flex items-center gap-2 rounded-md bg-blue-500/5 px-3 py-2 text-xs text-blue-400 hover:bg-blue-500/10"
                    >
                      <ArrowRight className="h-3 w-3 shrink-0 text-blue-400/60" />
                      {ft.title}
                      <span className="ml-auto text-[10px] text-zinc-600">{ft.status}</span>
                    </Link>
                  ))}
                </div>
              )}
              <div className="pt-2">
                <button
                  onClick={openFollowUp}
                  className="rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs font-medium text-blue-400 transition-colors hover:border-blue-500/50 hover:bg-blue-500/20"
                >
                  Add Another Follow-up
                </button>
              </div>
            </div>
          )}

          {/* Review details when accepted */}
          {isAccepted && (
            <div className="space-y-2 text-sm">
              {task.reviewedAt && (
                <p className="text-xs text-zinc-500">
                  Accepted {timeAgo(task.reviewedAt)}
                  {task.finishedAt && (
                    <span className="ml-1 text-zinc-700">
                      · finished {timeAgo(task.finishedAt)}
                    </span>
                  )}
                </p>
              )}
              {task.reviewNotes && (
                <div className="mt-2 rounded-md bg-zinc-800/50 px-3 py-2">
                  <p className="text-xs text-zinc-500">Review Notes</p>
                  <div className="mt-1 result-preview-container" data-color-mode="dark">
                    <MDEditor
                      value={task.reviewNotes}
                      preview="preview"
                      hideToolbar
                      height={Math.min(300, Math.max(80, task.reviewNotes.split("\n").length * 24))}
                      visibleDragbar={false}
                      style={{
                        backgroundColor: "transparent",
                        border: "none",
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="pt-2">
                <button
                  onClick={openFollowUp}
                  className="rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs font-medium text-blue-400 transition-colors hover:border-blue-500/50 hover:bg-blue-500/20"
                >
                  Add Follow-up Task
                </button>
              </div>
            </div>
          )}

          {/* Reviewable state: show actions */}
          {isReviewable && (
            <div className="space-y-4">
              {task.resultSummary && (
                <div className="rounded-md bg-zinc-800/40 px-3 py-2.5">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    Result Summary
                  </p>
                  <p className="text-sm text-zinc-300">{task.resultSummary}</p>
                </div>
              )}

              {task.finishedAt && (
                <p className="text-xs text-zinc-600">
                  Finished {timeAgo(task.finishedAt)}
                </p>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                  Review Notes (optional)
                </label>
                <div data-color-mode="dark">
                  <MDEditor
                    value={reviewNotes}
                    onChange={(v) => setReviewNotes(v ?? "")}
                    preview="edit"
                    hideToolbar={false}
                    height={160}
                    textareaProps={{ placeholder: "Add a note about this result…" }}
                    visibleDragbar={false}
                    style={{
                      backgroundColor: "rgb(9, 9, 11)",
                      borderRadius: "0.5rem",
                      border: "1px solid rgb(39, 39, 42)",
                      fontSize: "14px",
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleAccept}
                  disabled={actionInFlight !== null}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {actionInFlight === "accept" ? "Accepting…" : "Accept"}
                </button>
                <button
                  onClick={() => setShowRetryContext(!showRetryContext)}
                  disabled={actionInFlight !== null}
                  className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                >
                  Retry
                </button>
                <button
                  onClick={openFollowUp}
                  disabled={actionInFlight !== null}
                  className="rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-400 transition-colors hover:border-blue-500/50 hover:bg-blue-500/20 disabled:opacity-50"
                >
                  Follow-up
                </button>
              </div>

              {showRetryContext && (
                <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                    Retry with instruction (optional)
                  </label>
                  <input
                    type="text"
                    value={retryInstruction}
                    onChange={(e) => setRetryInstruction(e.target.value)}
                    placeholder="Make it shorter, use bullet points, focus on SEO…"
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
            </div>
          )}
        </section>
      )}

      {/* Retry with Context for failed tasks */}
      {task.status === "failed" && (
        <section className="mt-6 rounded-xl border border-red-500/20 bg-red-500/5 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <span className="text-red-400">✕</span>
            Task Failed
          </h2>
          <p className="mb-4 text-xs text-zinc-500">
            This task failed. You can retry it with an optional instruction to guide the agent.
          </p>
          <input
            type="text"
            value={retryInstruction}
            onChange={(e) => setRetryInstruction(e.target.value)}
            placeholder="Make it shorter, use bullet points, focus on SEO…"
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
          </div>
        </section>
      )}

      {/* Inline Follow-up Form */}
      {showFollowUp && (
        <section className="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">
            Create Follow-up Task
          </h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">Title</label>
              <input
                type="text"
                value={followUpTitle}
                onChange={(e) => setFollowUpTitle(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">Description</label>
              <textarea
                value={followUpDesc}
                onChange={(e) => setFollowUpDesc(e.target.value)}
                rows={2}
                placeholder="What should the agent do next?"
                className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700"
              />
            </div>
            {task && (task.resultSummary || (task.executionSteps && task.executionSteps.length > 0)) && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Previous context (auto-included for the agent)
                </p>
                {task.executionSteps && task.executionSteps.length > 0 && (
                  <div className="space-y-1">
                    {task.executionSteps.map((step: { stepOrder: number; agentName: string | null; title: string | null; outputSummary: string | null }) => (
                      <p key={step.stepOrder} className="text-xs text-zinc-500">
                        <span className="text-zinc-400">{step.stepOrder}. [{step.agentName}]</span>{" "}
                        {step.title}
                        {step.outputSummary && (
                          <span className="text-zinc-600"> — {step.outputSummary.length > 80 ? step.outputSummary.slice(0, 80) + "..." : step.outputSummary}</span>
                        )}
                      </p>
                    ))}
                  </div>
                )}
                {task.resultSummary && !task.executionSteps?.length && (
                  <p className="text-xs text-zinc-500">{task.resultSummary}</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Agent</label>
                <select
                  value={followUpAgentId}
                  onChange={(e) => setFollowUpAgentId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
                >
                  {(agents ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Priority</label>
                <select
                  value={followUpPriority}
                  onChange={(e) => setFollowUpPriority(e.target.value as TaskPriority)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleFollowUp}
                disabled={!followUpTitle.trim() || actionInFlight !== null}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                {actionInFlight === "followup" ? "Creating…" : "Create Follow-up"}
              </button>
              <button
                onClick={() => setShowFollowUp(false)}
                className="rounded-md px-4 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Logs */}
      <section className="mt-8">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
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
