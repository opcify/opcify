"use client";

import { Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useWorkspace } from "@/lib/workspace-context";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useKanbanData } from "@/lib/use-kanban-data";
import { useKanbanModals } from "@/lib/use-kanban-modals";
import { useKanbanActions } from "@/lib/use-kanban-actions";
import { getTodayStr } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";

import { KanbanHeader } from "@/components/kanban/kanban-header";
import { KanbanSummaryStrip } from "@/components/kanban/kanban-summary-strip";
import { KanbanQuickActions } from "@/components/kanban/kanban-quick-actions";
import { KanbanPageSkeleton } from "@/components/kanban/kanban-page-skeleton";
import { KanbanSectionNav } from "@/components/kanban/kanban-section-nav";
import { KanbanErrorState } from "@/components/kanban/kanban-error-state";
import { TodayKanbanView } from "@/components/kanban/today-kanban-view";
import { PastKanbanView } from "@/components/kanban/past-kanban-view";
import { FutureKanbanView } from "@/components/kanban/future-kanban-view";
import { Toast } from "@/components/toast";

import { NewTaskEntryModal } from "@/components/tasks/new-task-entry-modal";
import { TaskCreateModal } from "@/components/tasks/task-create-modal";
import { BreakDownModal } from "@/components/tasks/break-down-modal";
import { FollowUpTaskModal } from "@/components/kanban/follow-up-task-modal";

export default function KanbanPageWrapper() {
  return (
    <Suspense fallback={<KanbanPageSkeleton />}>
      <KanbanPage />
    </Suspense>
  );
}

function KanbanPage() {
  const router = useWorkspaceRouter();
  const { workspaceId } = useWorkspace();
  const searchParams = useSearchParams();
  const timezone = useTimezone();

  const selectedDate = searchParams.get("date") || getTodayStr(timezone);

  const { data, loading, error, refetch } = useKanbanData(
    selectedDate,
    workspaceId,
    timezone,
  );
  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);

  const modals = useKanbanModals();
  const { actions, submitting } = useKanbanActions({
    workspaceId,
    agents: agents ?? null,
    selectedDate,
    mode: data?.mode ?? null,
    refetch,
    router,
    onToast: modals.setToastMessage,
    onCloseCreate: modals.closeCreateModal,
    onCloseBreakDown: modals.closeBreakDown,
    onOpenCreate: modals.openCreateModal,
    onClearFollowUp: () => modals.setFollowUpTask(null),
    followUpTask: modals.followUpTask,
  });

  const handleDateChange = useCallback(
    (date: string) => {
      const today = getTodayStr();
      if (date === today) {
        router.push("/kanban");
      } else {
        router.push(`/kanban?date=${date}`);
      }
    },
    [router],
  );

  const handleGoToToday = useCallback(() => {
    handleDateChange(getTodayStr());
  }, [handleDateChange]);

  if (loading) return <KanbanPageSkeleton />;
  if (error) {
    return (
      <KanbanErrorState
        error={error}
        onRetry={refetch}
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
      />
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <KanbanHeader
        mode={data.mode}
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
      />

      <KanbanSummaryStrip summary={data.summary} timingMetrics={data.timingMetrics} />

      {(data.mode === "today" || data.mode === "future") && (
        <KanbanQuickActions onAddTask={modals.openEntryModal} />
      )}

      {data.mode === "today" && (
        <TodayKanbanView
          data={data}
          onStartTask={actions.startTask}
          onStopTask={actions.stopTask}
          onAcceptTask={actions.acceptTask}
          onRetryTask={actions.retryTask}
          onDeleteTask={actions.deleteTask}
          onAddTask={modals.openEntryModal}
          onFollowUpTask={modals.setFollowUpTask}
          onCreateFromSuggestion={actions.createFromSuggestion}
          onToggleFocus={actions.toggleFocus}
        />
      )}

      {data.mode === "past" && (
        <PastKanbanView
          data={data}
          onAcceptTask={actions.acceptTask}
          onRetryTask={actions.retryTask}
          onFollowUpTask={modals.setFollowUpTask}
          onCreateFromSuggestion={actions.createFromSuggestion}
          onGoToToday={handleGoToToday}
        />
      )}

      {data.mode === "future" && (
        <FutureKanbanView
          data={data}
          onAddTask={modals.openEntryModal}
          onDeleteTask={actions.deleteTask}
          onCreateFromSuggestion={actions.createFromSuggestion}
        />
      )}

      {data.mode === "today" && <KanbanSectionNav />}

      {modals.showEntryModal && (
        <NewTaskEntryModal
          onFromScratch={() => {
            modals.closeEntryModal();
            modals.openCreateModal();
          }}
          onFromTemplate={() => {
            modals.closeEntryModal();
            router.push("/task-hub?from=kanban");
          }}
          onBreakDown={() => {
            modals.closeEntryModal();
            modals.openBreakDown();
          }}
          onClose={modals.closeEntryModal}
        />
      )}

      {modals.showCreateModal && agents && (
        <TaskCreateModal
          agents={agents}
          onClose={modals.closeCreateModal}
          onSubmit={actions.createTask}
          submitting={submitting}
        />
      )}

      {modals.showBreakDown && (
        <BreakDownModal
          onClose={modals.closeBreakDown}
          onSubmit={actions.breakDown}
          submitting={submitting}
        />
      )}

      {modals.followUpTask && agents && (
        <FollowUpTaskModal
          sourceTask={modals.followUpTask}
          agents={agents}
          onClose={() => modals.setFollowUpTask(null)}
          onSubmit={actions.followUpTask}
          submitting={submitting}
        />
      )}

      {modals.toastMessage && (
        <Toast
          message={modals.toastMessage}
          onClose={() => modals.setToastMessage(null)}
        />
      )}
    </div>
  );
}
