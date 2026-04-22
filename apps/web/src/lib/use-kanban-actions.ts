"use client";

import { useCallback, useState } from "react";
import type {
  Agent,
  KanbanMode,
  SuggestedTaskAction,
  TaskPriority,
  TaskWithAgent,
  UpdateTaskInput,
} from "@opcify/core";
import type { TaskCreateData } from "@/components/tasks/task-create-modal";
import { api } from "./api";
import { useWorkspaceRouter } from "./workspace-router";

interface BreakDownInput {
  title: string;
  description: string;
  priority: TaskPriority;
  plannedDate?: string;
}

interface FollowUpSubmitInput {
  title: string;
  description: string;
  agentId?: string;
  priority?: TaskPriority;
  plannedDate?: string;
}

export interface KanbanActions {
  startTask: (id: string) => Promise<void>;
  stopTask: (id: string) => Promise<void>;
  acceptTask: (id: string) => Promise<void>;
  retryTask: (id: string, overrideInstruction?: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleFocus: (id: string, isFocus: boolean) => Promise<void>;
  createTask: (input: TaskCreateData) => Promise<void>;
  breakDown: (input: BreakDownInput) => Promise<void>;
  followUpTask: (input: FollowUpSubmitInput) => Promise<void>;
  createFromSuggestion: (action: SuggestedTaskAction) => void;
}

interface UseKanbanActionsParams {
  workspaceId: string;
  agents: Agent[] | null;
  selectedDate: string;
  mode: KanbanMode | null;
  refetch: () => void;
  router: ReturnType<typeof useWorkspaceRouter>;
  onToast: (msg: string) => void;
  onCloseCreate: () => void;
  onCloseBreakDown: () => void;
  onOpenCreate: () => void;
  onClearFollowUp: () => void;
  followUpTask: TaskWithAgent | null;
}

export function useKanbanActions(params: UseKanbanActionsParams): {
  actions: KanbanActions;
  submitting: boolean;
} {
  const {
    workspaceId,
    agents,
    selectedDate,
    mode,
    refetch,
    router,
    onToast,
    onCloseCreate,
    onCloseBreakDown,
    onOpenCreate,
    onClearFollowUp,
    followUpTask,
  } = params;

  const [submitting, setSubmitting] = useState(false);

  const startTask = useCallback(
    async (id: string) => {
      await api.kanban.startTask(workspaceId, id);
      refetch();
    },
    [workspaceId, refetch],
  );

  const stopTask = useCallback(
    async (id: string) => {
      await api.tasks.stop(workspaceId, id);
      refetch();
    },
    [workspaceId, refetch],
  );

  const acceptTask = useCallback(
    async (id: string) => {
      const result = await api.kanban.acceptTask(workspaceId, id);
      if (result.parentAutoAccepted) {
        onToast("Parent task also marked as accepted");
      }
      refetch();
    },
    [workspaceId, refetch, onToast],
  );

  const retryTask = useCallback(
    async (id: string, overrideInstruction?: string) => {
      await api.kanban.retryTask(workspaceId, id, undefined, overrideInstruction);
      refetch();
    },
    [workspaceId, refetch],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      await api.tasks.updateStatus(workspaceId, id, "failed");
      refetch();
    },
    [workspaceId, refetch],
  );

  const toggleFocus = useCallback(
    async (id: string, isFocus: boolean) => {
      try {
        await api.kanban.toggleFocus(workspaceId, id, isFocus);
        refetch();
      } catch (err) {
        onToast(err instanceof Error ? err.message : "Failed to toggle focus");
      }
    },
    [workspaceId, refetch, onToast],
  );

  const createTask = useCallback(
    async (input: TaskCreateData) => {
      setSubmitting(true);
      try {
        const plannedDate = mode === "future" ? selectedDate : undefined;
        const task = await api.tasks.create(workspaceId, {
          title: input.title,
          description: input.description,
          agentId: input.agentId,
          priority: input.priority,
          clientId: input.clientId,
          plannedDate,
          attachments: input.attachments,
        });

        if (input.recurring) {
          const rule = await api.recurring.create(workspaceId, {
            title: input.title,
            frequency: input.recurring.frequency,
            interval: input.recurring.interval,
            dayOfWeek: input.recurring.dayOfWeek,
            dayOfMonth: input.recurring.dayOfMonth,
            hour: input.recurring.hour,
            minute: input.recurring.minute,
            startDate: input.recurring.startDate,
            clientId: input.clientId,
            agentId: input.agentId,
            presetData: {
              description: input.description || undefined,
              priority: input.priority,
            },
          });
          await api.tasks.update(workspaceId, task.id, {
            recurringRuleId: rule.id,
          } as UpdateTaskInput);
          onToast(
            "Recurring task created — future tasks will be generated automatically",
          );
        }

        onCloseCreate();
        refetch();
      } finally {
        setSubmitting(false);
      }
    },
    [workspaceId, mode, selectedDate, refetch, onToast, onCloseCreate],
  );

  const breakDown = useCallback(
    async (input: BreakDownInput) => {
      const decompAgent = agents?.find((a) => a.role === "decomposition");
      if (!decompAgent) {
        alert(
          'Decomposition Agent not found. Please create an agent with role "decomposition".',
        );
        return;
      }
      setSubmitting(true);
      try {
        const task = await api.tasks.create(workspaceId, {
          title: input.title,
          description: input.description,
          agentId: decompAgent.id,
          priority: input.priority,
          taskType: "decomposition",
          plannedDate: input.plannedDate,
        });
        onCloseBreakDown();
        router.push(`/tasks/${task.id}?from=kanban`);
      } finally {
        setSubmitting(false);
      }
    },
    [workspaceId, agents, router, onCloseBreakDown],
  );

  const followUpTaskAction = useCallback(
    async (input: FollowUpSubmitInput) => {
      if (!followUpTask) return;
      setSubmitting(true);
      try {
        const result = await api.kanban.followUpTask(
          workspaceId,
          followUpTask.id,
          input,
        );
        onClearFollowUp();
        onToast(`Follow-up task created: ${result.followUpTask.title}`);
        refetch();
      } finally {
        setSubmitting(false);
      }
    },
    [workspaceId, followUpTask, refetch, onClearFollowUp, onToast],
  );

  const createFromSuggestion = useCallback(
    (action: SuggestedTaskAction) => {
      if (action.sourceTaskId && action.id.startsWith("suggest-review-")) {
        router.push(`/tasks/${action.sourceTaskId}?from=kanban`);
      } else if (action.templateId) {
        router.push("/task-hub?from=kanban");
      } else {
        onOpenCreate();
      }
    },
    [router, onOpenCreate],
  );

  return {
    actions: {
      startTask,
      stopTask,
      acceptTask,
      retryTask,
      deleteTask,
      toggleFocus,
      createTask,
      breakDown,
      followUpTask: followUpTaskAction,
      createFromSuggestion,
    },
    submitting,
  };
}
