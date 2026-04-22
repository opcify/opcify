"use client";

import { Suspense, useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useWorkspace } from "@/lib/workspace-context";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useTaskEvents } from "@/lib/use-task-events";
import type { TaskStatus } from "@opcify/core";
import {
  TaskToolbar,
  TaskTable,
  TaskTableSkeleton,
  TaskEmptyState,
  TaskBulkActions,
  TaskCreateModal,
  TaskViewSwitcher,
  TaskBoardView,
  TaskBoardSkeleton,
  NewTaskEntryModal,
  BreakDownModal,
} from "@/components/tasks";
import type { TaskViewMode } from "@/components/tasks/task-view-switcher";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";

export default function TasksPage() {
  return (
    <Suspense fallback={<TaskTableSkeleton />}>
      <TasksPageContent />
    </Suspense>
  );
}

function TasksPageContent() {
  const router = useWorkspaceRouter();
  const { workspaceId } = useWorkspace();
  const searchParams = useSearchParams();

  // Initial view from URL only so server and client match (avoids hydration mismatch).
  const [view, setView] = useState<TaskViewMode>(() => {
    const fromUrl = searchParams.get("view") as TaskViewMode | null;
    if (fromUrl === "table" || fromUrl === "board") return fromUrl;
    return "board";
  });

  // After hydration, restore view from localStorage when URL has no view param.
  useEffect(() => {
    if (searchParams.get("view")) return;
    const saved = localStorage.getItem("tasks-view") as TaskViewMode | null;
    if (saved === "table" || saved === "board") setView(saved);
  }, [searchParams]);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "all");
  const [priority, setPriority] = useState(searchParams.get("priority") ?? "all");
  const [agentId, setAgentId] = useState(searchParams.get("agent") ?? "");
  const [sort, setSort] = useState(searchParams.get("sort") ?? "updatedAt_desc");
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBreakDown, setShowBreakDown] = useState(false);
  const [creating, setCreating] = useState(false);

  const isArchived = status === "archived";
  const effectiveStatus = isArchived ? undefined : onlyRunning ? "running" : status === "all" ? undefined : status;
  const effectivePriority = priority === "all" ? undefined : priority;

  // For board view, don't send status filter to API — we need all statuses to group into columns.
  // Status filtering happens visually in the board by showing/hiding columns.
  const apiStatus = view === "board" && !isArchived ? undefined : effectiveStatus;

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (search) p.q = search;
    if (apiStatus) p.status = apiStatus;
    if (isArchived) p.archived = "true";
    if (effectivePriority) p.priority = effectivePriority;
    if (agentId) p.agentId = agentId;
    if (sort && sort !== "updatedAt_desc") p.sort = sort;
    return Object.keys(p).length > 0 ? p : undefined;
  }, [search, apiStatus, isArchived, effectivePriority, agentId, sort]);

  const {
    data: tasks,
    loading,
    error,
    refetch,
  } = useApi(
    () => api.tasks.list(workspaceId, params),
    [workspaceId, search, apiStatus, isArchived, effectivePriority, agentId, sort],
  );

  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);
  const { data: clients } = useApi(
    () => api.clients.list({ workspaceId, status: "active" }),
    [workspaceId],
  );
  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ id: c.id, name: c.name })),
    [clients],
  );

  // SSE: live task updates
  const { lastEvent } = useTaskEvents(workspaceId);

  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === "task:updated" && tasks) {
      // Update task in-place without full refetch
      const updated = tasks.map((t) =>
        t.id === lastEvent.taskId
          ? {
              ...t,
              ...(lastEvent.status ? { status: lastEvent.status } : {}),
              ...(lastEvent.progress !== undefined
                ? { progress: lastEvent.progress }
                : {}),
              ...(lastEvent.reviewStatus !== undefined
                ? { reviewStatus: lastEvent.reviewStatus }
                : {}),
              ...(lastEvent.priority ? { priority: lastEvent.priority } : {}),
              ...(lastEvent.currentAgentName !== undefined && t.executionStepsSummary
                ? {
                    executionStepsSummary: {
                      ...t.executionStepsSummary,
                      currentAgentName: lastEvent.currentAgentName,
                    },
                  }
                : {}),
            }
          : t,
      );
      // Trigger refetch to pick up any server-side changes
      if (updated !== tasks) {
        refetch();
      }
    }

    if (lastEvent.type === "task:created" || lastEvent.type === "queue:changed") {
      refetch();
    }
  }, [lastEvent, refetch, tasks]);

  const updateUrl = useCallback(
    (updates: Record<string, string>) => {
      const p = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(updates)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const qs = p.toString();
      router.replace(`/tasks${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router],
  );

  function handleViewChange(v: TaskViewMode) {
    setView(v);
    setSelectedIds(new Set());
    localStorage.setItem("tasks-view", v);
    updateUrl({ view: v === "board" ? "" : v });
  }

  function handleSearchChange(v: string) {
    setSearch(v);
    updateUrl({ q: v });
  }

  function handleStatusChange(v: string) {
    setStatus(v);
    setOnlyRunning(false);
    updateUrl({ status: v === "all" ? "" : v });
  }

  function handlePriorityChange(v: string) {
    setPriority(v);
    updateUrl({ priority: v === "all" ? "" : v });
  }

  function handleAgentChange(v: string) {
    setAgentId(v);
    updateUrl({ agent: v });
  }

  function handleSortChange(v: string) {
    setSort(v);
    updateUrl({ sort: v === "updatedAt_desc" ? "" : v });
  }

  function handleOnlyRunningChange(v: boolean) {
    setOnlyRunning(v);
    if (v) setStatus("all");
  }

  function handleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    if (!tasks) return;
    if (selectedIds.size === tasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
    }
  }

  async function handleStatusUpdate(id: string, newStatus: TaskStatus) {
    await api.tasks.updateStatus(workspaceId, id, newStatus);
    refetch();
  }

  async function handleStopTask(id: string) {
    await api.tasks.stop(workspaceId, id);
    refetch();
  }

  async function handleToggleFocus(id: string, isFocus: boolean) {
    try {
      await api.kanban.toggleFocus(workspaceId, id, isFocus);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to toggle focus");
    }
  }

  async function handleBulkAction(newStatus: TaskStatus) {
    const promises = Array.from(selectedIds).map((id) =>
      api.tasks.updateStatus(workspaceId, id, newStatus),
    );
    await Promise.all(promises);
    setSelectedIds(new Set());
    refetch();
  }

  async function handleCreateTask(data: {
    title: string;
    description: string;
    agentId: string;
    priority?: import("@opcify/core").TaskPriority;
    attachments?: import("@opcify/core").ChatAttachment[];
  }) {
    setCreating(true);
    try {
      await api.tasks.create(workspaceId, data);
      setShowCreateModal(false);
      refetch();
    } finally {
      setCreating(false);
    }
  }

  async function handleBreakDown(data: {
    title: string;
    description: string;
    priority: import("@opcify/core").TaskPriority;
    plannedDate?: string;
  }) {
    const decompAgent = agents?.find((a) => a.role === "decomposition");
    if (!decompAgent) {
      alert("Decomposition Agent not found. Please create an agent with role \"decomposition\".");
      return;
    }
    setCreating(true);
    try {
      const task = await api.tasks.create(workspaceId, {
        title: data.title,
        description: data.description,
        agentId: decompAgent.id,
        priority: data.priority,
        taskType: "decomposition",
        plannedDate: data.plannedDate,
      });
      setShowBreakDown(false);
      router.push(`/tasks/${task.id}`);
    } finally {
      setCreating(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setStatus("all");
    setPriority("all");
    setAgentId("");
    setOnlyRunning(false);
    updateUrl({ q: "", status: "", priority: "", agent: "" });
  }

  const hasFilters = search || status !== "all" || priority !== "all" || agentId || onlyRunning;
  const isEmpty = !loading && !error && tasks && tasks.length === 0;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Tasks</h1>
          <p className="mt-0.5 hidden text-sm text-zinc-400 sm:block">
            Manage and monitor agent task execution
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <TaskViewSwitcher view={view} onChange={handleViewChange} />
          <button
            onClick={() => setShowEntryModal(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 sm:px-4 sm:py-2 sm:text-sm"
          >
            New Task
          </button>
          <div className="hidden md:block"><UserProfileDropdown /></div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-6">
        <TaskToolbar
          search={search}
          onSearchChange={handleSearchChange}
          status={onlyRunning ? "all" : status}
          onStatusChange={handleStatusChange}
          priority={priority}
          onPriorityChange={handlePriorityChange}
          agentId={agentId}
          onAgentChange={handleAgentChange}
          sort={sort}
          onSortChange={handleSortChange}
          agents={agents ?? []}
          onlyRunning={onlyRunning}
          onOnlyRunningChange={handleOnlyRunningChange}
        />
      </div>

      {/* Bulk actions bar (table view only) */}
      {view === "table" && selectedIds.size > 0 && (
        <div className="mt-3">
          <TaskBulkActions
            count={selectedIds.size}
            onMarkDone={() => handleBulkAction("done")}
            onMarkFailed={() => handleBulkAction("failed")}
            onClear={() => setSelectedIds(new Set())}
          />
        </div>
      )}

      {/* Main content */}
      <div className={`mt-4 ${view === "table" || isArchived ? "rounded-xl border border-zinc-800 bg-zinc-900/50" : ""}`}>
        {/* Loading */}
        {loading && (
          <div className={view === "table" ? "p-4" : ""}>
            {view === "table" ? <TaskTableSkeleton /> : <TaskBoardSkeleton />}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-red-400">Failed to load tasks</p>
            <p className="mt-1 text-xs text-zinc-500">{error}</p>
            <button
              onClick={refetch}
              className="mt-3 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty — no tasks at all */}
        {isEmpty && !hasFilters && (
          <TaskEmptyState onCreateTask={() => setShowEntryModal(true)} />
        )}

        {/* Empty — filters active but no matches */}
        {isEmpty && hasFilters && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-zinc-400">No tasks match your filters</p>
            <button
              onClick={clearFilters}
              className="mt-3 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Table View (also forced for archived filter) */}
        {!loading && !error && tasks && tasks.length > 0 && (view === "table" || isArchived) && (
          <TaskTable
            tasks={tasks}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onSelectAll={handleSelectAll}
            onStatusChange={handleStatusUpdate}
            onStop={handleStopTask}
            onToggleFocus={handleToggleFocus}
          />
        )}

        {/* Board View */}
        {!loading && !error && tasks && tasks.length > 0 && view === "board" && !isArchived && (
          <TaskBoardView
            tasks={tasks}
            onStatusChange={handleStatusUpdate}
            onStop={handleStopTask}
            statusFilter={effectiveStatus ?? status}
            onToggleFocus={handleToggleFocus}
          />
        )}
      </div>

      {/* Entry Modal: choose template, scratch, or break down */}
      {showEntryModal && (
        <NewTaskEntryModal
          onFromTemplate={() => {
            setShowEntryModal(false);
            router.push("/task-hub");
          }}
          onFromScratch={() => {
            setShowEntryModal(false);
            setShowCreateModal(true);
          }}
          onBreakDown={() => {
            setShowEntryModal(false);
            setShowBreakDown(true);
          }}
          onClose={() => setShowEntryModal(false)}
        />
      )}

      {/* Create from Scratch Modal */}
      {showCreateModal && agents && (
        <TaskCreateModal
          agents={agents}
          clients={clientOptions}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateTask}
          submitting={creating}
        />
      )}

      {/* Break Down Modal */}
      {showBreakDown && (
        <BreakDownModal
          onClose={() => setShowBreakDown(false)}
          onSubmit={handleBreakDown}
          submitting={creating}
        />
      )}
    </>
  );
}
