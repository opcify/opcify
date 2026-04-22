"use client";

import { Suspense, use } from "react";
import { WsLink as Link } from "@/lib/workspace-link";
import { useSearchParams } from "next/navigation";
import { Clock, ChevronRight } from "lucide-react";
import type { TaskWithAgent } from "@opcify/core";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatDate } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import { useWorkspace } from "@/lib/workspace-context";
import { StatusBadge } from "@/components/status-badge";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { ReviewStatusBadge } from "@/components/tasks/review-status-badge";
import { WaitingBadge } from "@/components/tasks/waiting-blocker-badge";
import type { ReviewStatus } from "@opcify/core";

type GroupHealth = "on_track" | "needs_attention" | "blocked";

function computeGroupHealth(tasks: TaskWithAgent[]): GroupHealth {
  const hasBlocked = tasks.some(
    (t) => t.blockedByTaskId || t.waitingReason === "waiting_for_dependency",
  );
  if (hasBlocked) return "needs_attention";

  const hasFailed = tasks.some((t) => t.status === "failed");
  const hasRejected = tasks.some((t) => t.reviewStatus === "rejected");
  if (hasFailed || hasRejected) return "needs_attention";

  return "on_track";
}

function computeNextTask(tasks: TaskWithAgent[]): { task: TaskWithAgent; isBlocker: boolean } | null {
  const pOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const actionable = tasks.filter(
    (t) =>
      t.status !== "done" ||
      (t.status === "done" && t.reviewStatus !== "accepted"),
  );
  if (actionable.length === 0) return null;

  const sorted = [...actionable].sort(
    (a, b) => (pOrder[b.priority] ?? 2) - (pOrder[a.priority] ?? 2),
  );

  const topTask = sorted[0];

  if (topTask.blockedByTaskId) {
    const blocker = tasks.find((t) => t.id === topTask.blockedByTaskId);
    if (blocker) return { task: blocker, isBlocker: true };
  }

  const unblocked = sorted.filter((t) => !t.blockedByTaskId);
  if (unblocked.length > 0) return { task: unblocked[0], isBlocker: false };

  return { task: topTask, isBlocker: false };
}

const HEALTH_STYLES: Record<GroupHealth, { label: string; color: string; dot: string; bg: string }> = {
  on_track: { label: "On Track", color: "text-emerald-400", dot: "bg-emerald-400", bg: "bg-emerald-500/10" },
  needs_attention: { label: "Needs Attention", color: "text-orange-400", dot: "bg-orange-400", bg: "bg-orange-500/10" },
  blocked: { label: "Blocked", color: "text-red-400", dot: "bg-red-400", bg: "bg-red-500/10" },
};

function TaskGroupSummaryStrip({ tasks }: { tasks: TaskWithAgent[] }) {
  const total = tasks.length;
  const completed = tasks.filter(
    (t) => t.status === "done" && t.reviewStatus === "accepted",
  ).length;
  const inProgress = tasks.filter(
    (t) => t.status === "running" || t.status === "waiting",
  ).length;
  const pendingReview = tasks.filter(
    (t) => t.status === "done" && t.reviewStatus === "pending",
  ).length;
  const queued = tasks.filter((t) => t.status === "queued").length;
  const blocked = tasks.filter((t) => t.blockedByTaskId).length;

  const items = [
    { label: "Total", value: total, color: "text-zinc-300", dot: "bg-zinc-400" },
    { label: "Completed", value: completed, color: "text-emerald-400", dot: "bg-emerald-400" },
    { label: "In Progress", value: inProgress, color: "text-blue-400", dot: "bg-blue-400" },
    { label: "Review", value: pendingReview, color: "text-amber-400", dot: "bg-amber-400" },
    { label: "Queued", value: queued, color: "text-zinc-400", dot: "bg-zinc-500" },
    ...(blocked > 0
      ? [{ label: "Blocked", value: blocked, color: "text-red-400", dot: "bg-red-400" }]
      : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-6">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${item.dot}`} />
          <span className="text-xs text-zinc-500">{item.label}</span>
          <span className={`text-sm font-semibold ${item.color}`}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function GroupTaskRow({ task }: { task: TaskWithAgent }) {
  return (
    <div className="group flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:border-zinc-700">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          task.reviewStatus === "accepted"
            ? "bg-emerald-400"
            : task.status === "running"
              ? "bg-emerald-400 animate-pulse"
              : task.status === "done"
                ? "bg-amber-400"
                : task.status === "failed"
                  ? "bg-red-400"
                  : "bg-zinc-600"
        }`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/tasks/${task.id}`}
            className="truncate text-sm font-medium text-zinc-200 hover:text-white"
          >
            {task.title}
          </Link>
        </div>
        {task.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
            {task.description}
          </p>
        )}
      </div>

      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-medium text-zinc-400">
          {task.agent.name.charAt(0).toUpperCase()}
        </span>
        <span className="max-w-[100px] truncate">{task.agent.name}</span>
      </span>

      <TaskPriorityBadge priority={task.priority} />
      <StatusBadge status={task.status} />
      {task.reviewStatus && (
        <ReviewStatusBadge status={task.reviewStatus as ReviewStatus} />
      )}
      {task.waitingReason && <WaitingBadge waitingReason={task.waitingReason} />}

      <Link
        href={`/tasks/${task.id}`}
        className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 opacity-0 transition-all hover:bg-zinc-700 hover:text-zinc-200 group-hover:opacity-100"
      >
        View
      </Link>
    </div>
  );
}

function TaskGroupDetailFallback() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-60 rounded bg-zinc-800" />
      <div className="h-40 rounded-lg bg-zinc-900" />
    </div>
  );
}

export default function TaskGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<TaskGroupDetailFallback />}>
      <TaskGroupDetailContent params={params} />
    </Suspense>
  );
}

function TaskGroupDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const timezone = useTimezone();
  const searchParams = useSearchParams();
  const fromKanban = searchParams.get("from") === "kanban";
  const { workspaceId } = useWorkspace();
  const { data: group, loading, error } = useApi(
    () => api.taskGroups.get(workspaceId, id),
    [workspaceId, id],
  );

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-60 rounded bg-zinc-800" />
        <div className="h-40 rounded-lg bg-zinc-900" />
      </div>
    );
  }
  if (error) return <p className="text-red-400">Failed to load: {error}</p>;
  if (!group) return <p className="text-zinc-400">Task group not found</p>;

  const completedCount = group.tasks.filter(
    (t) => t.status === "done" && t.reviewStatus === "accepted",
  ).length;
  const progressPercent =
    group.tasks.length > 0
      ? Math.round((completedCount / group.tasks.length) * 100)
      : 0;

  const health = computeGroupHealth(group.tasks);
  const healthStyle = HEALTH_STYLES[health];
  const nextStep = computeNextTask(group.tasks);

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
            <h1 className="text-2xl font-bold tracking-tight">{group.title}</h1>
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
              {group.type}
            </span>
            <span className={`rounded-full ${healthStyle.bg} px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${healthStyle.color} flex items-center gap-1.5`}>
              <span className={`h-1.5 w-1.5 rounded-full ${healthStyle.dot}`} />
              {healthStyle.label}
            </span>
          </div>
          {group.description && (
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              {group.description}
            </p>
          )}
        </div>
        {group.sourceTaskId && (
          <Link
            href={`/tasks/${group.sourceTaskId}`}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
          >
            View Source Task
          </Link>
        )}
      </div>

      {/* Progress */}
      <div className="mt-5 flex items-center gap-4">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-sm font-medium text-zinc-400">
          {completedCount}/{group.tasks.length} done
        </span>
      </div>

      {/* Summary strip */}
      <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-5 py-3">
        <TaskGroupSummaryStrip tasks={group.tasks} />
      </div>

      {/* Next Step */}
      {nextStep && (
        <div className={`mt-5 rounded-lg border p-4 ${
          nextStep.isBlocker
            ? "border-red-500/20 bg-red-500/5"
            : "border-emerald-500/20 bg-emerald-500/5"
        }`}>
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider ${
              nextStep.isBlocker ? "text-red-400/60" : "text-emerald-400/60"
            }`}>
              {nextStep.isBlocker ? <><Clock className="h-3 w-3" /> Resolve first</> : <><ChevronRight className="h-3 w-3" /> Next step</>}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Link
              href={`/tasks/${nextStep.task.id}`}
              className={`text-sm font-medium hover:underline ${
                nextStep.isBlocker ? "text-red-300" : "text-emerald-300"
              }`}
            >
              {nextStep.task.title}
            </Link>
            <StatusBadge status={nextStep.task.status} />
            {nextStep.task.reviewStatus && (
              <ReviewStatusBadge status={nextStep.task.reviewStatus as ReviewStatus} />
            )}
          </div>
          {nextStep.isBlocker && (
            <p className="mt-1.5 text-xs text-zinc-500">
              This task is blocking another task in the group. Resolve it to unblock progress.
            </p>
          )}
          <div className="mt-3">
            <Link
              href={`/tasks/${nextStep.task.id}`}
              className={`inline-flex rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                nextStep.isBlocker
                  ? "bg-red-600 text-white hover:bg-red-500"
                  : "bg-emerald-600 text-white hover:bg-emerald-500"
              }`}
            >
              {nextStep.isBlocker ? "Open Blocker Task" : "Open Task"}
            </Link>
          </div>
        </div>
      )}

      {/* Task list */}
      <section className="mt-6">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Tasks in this group
        </h2>
        {group.tasks.length > 0 ? (
          <div className="space-y-2">
            {group.tasks.map((task) => (
              <GroupTaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center">
            <p className="text-sm text-zinc-500">
              No tasks in this group yet
            </p>
          </div>
        )}
      </section>

      {/* Metadata */}
      <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Details
        </h2>
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-zinc-500">
          <div>
            <span className="text-zinc-600">Created:</span>{" "}
            {formatDate(group.createdAt, timezone)}
          </div>
          <div>
            <span className="text-zinc-600">Updated:</span>{" "}
            {formatDate(group.updatedAt, timezone)}
          </div>
          <div>
            <span className="text-zinc-600">ID:</span>{" "}
            <span className="font-mono text-zinc-600">{group.id}</span>
          </div>
        </div>
      </section>
    </>
  );
}
