"use client";

import type { KanbanDateResponse, SuggestedTaskAction, TaskWithAgent } from "@opcify/core";
import { Star, Diamond, Zap, Eye, Check, ArrowRight, AlertTriangle } from "lucide-react";
import { KanbanSection } from "./kanban-section";
import { KanbanEmptyState } from "./kanban-empty-state";
import { PlanTaskCard } from "./plan-task-card";
import { InProgressTaskCard } from "./in-progress-task-card";
import { ReviewTaskCard } from "./review-task-card";
import { CompletedTaskItem } from "./completed-task-item";
import { NextActionCard } from "./next-action-card";
import { FocusTaskCard } from "./focus-task-card";
import { FailedTaskCard } from "./failed-task-card";
import { TaskGroupCluster, groupTasksByTaskGroup } from "./task-group-cluster";

interface TodayKanbanViewProps {
  data: KanbanDateResponse;
  onStartTask: (id: string) => void;
  onStopTask: (id: string) => void;
  onAcceptTask: (id: string) => void;
  onRetryTask: (id: string, overrideInstruction?: string) => void;
  onDeleteTask: (id: string) => void;
  onAddTask: () => void;
  onFollowUpTask: (task: TaskWithAgent) => void;
  onCreateFromSuggestion: (action: SuggestedTaskAction) => void;
  onToggleFocus: (id: string, isFocus: boolean) => void;
}

export function TodayKanbanView({
  data,
  onStartTask,
  onStopTask,
  onAcceptTask,
  onRetryTask,
  onDeleteTask,
  onAddTask,
  onFollowUpTask,
  onCreateFromSuggestion,
  onToggleFocus,
}: TodayKanbanViewProps) {
  const s = data.sections;
  const focusTasks = data.focusTasks ?? [];
  const todayPlan = s.todayPlan ?? [];
  const inProgress = s.inProgress ?? [];
  const readyForReview = s.readyForReview ?? [];
  const completedToday = s.completedToday ?? [];
  const failedToday = s.failedToday ?? [];
  const nextActions = s.nextActions ?? [];

  const focusIds = new Set(focusTasks.map((t) => t.id));

  const isEmpty =
    focusTasks.length === 0 &&
    todayPlan.length === 0 &&
    inProgress.length === 0 &&
    readyForReview.length === 0 &&
    completedToday.length === 0 &&
    failedToday.length === 0;

  if (isEmpty) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 py-16 text-center">
        <p className="text-lg font-medium text-zinc-400">
          No work yet today
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          Create your first task or start from a template to get going.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={onAddTask}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Add Task
          </button>
        </div>
      </div>
    );
  }

  const planItems = groupTasksByTaskGroup(todayPlan);
  const progressItems = groupTasksByTaskGroup(inProgress);
  const reviewItems = groupTasksByTaskGroup(readyForReview);
  const completedItems = groupTasksByTaskGroup(completedToday);

  return (
    <div className="space-y-6">
      {/* Focus Section */}
      <KanbanSection
        id="kanban-focus"
        title="Today's Focus"
        subtitle="Your most important tasks for today"
        count={focusTasks.length}
        icon={<Star />}
        accentColor="text-amber-400"
        emphasis="high"
      >
        {focusTasks.length === 0 ? (
          <div className="py-3 text-center">
            <p className="text-sm text-zinc-500">No focus set for today</p>
            <p className="mt-1 text-xs text-zinc-600">
              Mark important tasks as focus with the ☆ button
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {focusTasks.map((task) => (
              <FocusTaskCard
                key={task.id}
                task={task}
                onUnfocus={(id) => onToggleFocus(id, false)}
                onStart={onStartTask}
              />
            ))}
          </div>
        )}
      </KanbanSection>

      <KanbanSection
        id="kanban-plan"
        title="Today Plan"
        subtitle="Tasks ready to be started"
        count={todayPlan.length}
        icon={<Diamond />}
        accentColor="text-blue-400"
        emphasis="medium"
        action={
          <button
            onClick={onAddTask}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            + Add
          </button>
        }
      >
        {todayPlan.length === 0 ? (
          <KanbanEmptyState
            message="No planned tasks. Add a task to get started."
            actionLabel="Add Task"
            onAction={onAddTask}
          />
        ) : (
          <div className="space-y-2">
            {planItems.map((item) =>
              item.type === "standalone" ? (
                <PlanTaskCard
                  key={item.task.id}
                  task={item.task}
                  isFocus={focusIds.has(item.task.id)}
                  onStart={onStartTask}
                  onDelete={onDeleteTask}
                  onToggleFocus={onToggleFocus}
                />
              ) : (
                <TaskGroupCluster key={item.group.id} group={item.group} tasks={item.tasks}>
                  {item.tasks.map((task) => (
                    <PlanTaskCard
                      key={task.id}
                      task={task}
                      isFocus={focusIds.has(task.id)}
                      onStart={onStartTask}
                      onDelete={onDeleteTask}
                      onToggleFocus={onToggleFocus}
                    />
                  ))}
                </TaskGroupCluster>
              ),
            )}
          </div>
        )}
      </KanbanSection>

      <KanbanSection
        id="kanban-in-progress"
        title="In Progress"
        subtitle="Work being done right now"
        count={inProgress.length}
        icon={<Zap />}
        accentColor="text-emerald-400"
        emphasis="high"
      >
        {inProgress.length === 0 ? (
          <KanbanEmptyState
            message="No work is currently running."
            actionLabel="Start a task"
            onAction={() => {
              if (todayPlan.length > 0) onStartTask(todayPlan[0].id);
              else onAddTask();
            }}
          />
        ) : (
          <div className="space-y-2">
            {progressItems.map((item) =>
              item.type === "standalone" ? (
                <InProgressTaskCard
                  key={item.task.id}
                  task={item.task}
                  isFocus={focusIds.has(item.task.id)}
                  onStop={onStopTask}
                  onToggleFocus={onToggleFocus}
                />
              ) : (
                <TaskGroupCluster key={item.group.id} group={item.group} tasks={item.tasks}>
                  {item.tasks.map((task) => (
                    <InProgressTaskCard
                      key={task.id}
                      task={task}
                      isFocus={focusIds.has(task.id)}
                      onStop={onStopTask}
                      onToggleFocus={onToggleFocus}
                    />
                  ))}
                </TaskGroupCluster>
              ),
            )}
          </div>
        )}
      </KanbanSection>

      <KanbanSection
        id="kanban-review"
        title="Ready for Review"
        subtitle="Approve or retry completed work"
        count={readyForReview.length}
        icon={<Eye />}
        accentColor="text-amber-400"
        emphasis="high"
      >
        {readyForReview.length === 0 ? (
          <KanbanEmptyState message="Nothing is waiting for review." />
        ) : (
          <div className="space-y-2">
            {reviewItems.map((item) =>
              item.type === "standalone" ? (
                <ReviewTaskCard
                  key={item.task.id}
                  task={item.task}
                  isFocus={focusIds.has(item.task.id)}
                  onAccept={onAcceptTask}
                  onRetry={onRetryTask}
                  onFollowUp={onFollowUpTask}
                  onToggleFocus={onToggleFocus}
                />
              ) : (
                <TaskGroupCluster key={item.group.id} group={item.group} tasks={item.tasks}>
                  {item.tasks.map((task) => (
                    <ReviewTaskCard
                      key={task.id}
                      task={task}
                      isFocus={focusIds.has(task.id)}
                      onAccept={onAcceptTask}
                      onRetry={onRetryTask}
                      onFollowUp={onFollowUpTask}
                      onToggleFocus={onToggleFocus}
                    />
                  ))}
                </TaskGroupCluster>
              ),
            )}
          </div>
        )}
      </KanbanSection>

      <KanbanSection
        title="Completed Today"
        subtitle="Finished and accepted work"
        count={completedToday.length}
        icon={<Check />}
        accentColor="text-emerald-400"
        emphasis="low"
      >
        {completedToday.length === 0 ? (
          <KanbanEmptyState message="No completed work yet today." />
        ) : (
          <div className="-mx-3 divide-y divide-zinc-800/50">
            {completedItems.map((item) =>
              item.type === "standalone" ? (
                <CompletedTaskItem key={item.task.id} task={item.task} />
              ) : (
                <div key={item.group.id} className="mx-3 my-2">
                  <TaskGroupCluster group={item.group} tasks={item.tasks}>
                    {item.tasks.map((task) => (
                      <CompletedTaskItem key={task.id} task={task} />
                    ))}
                  </TaskGroupCluster>
                </div>
              ),
            )}
          </div>
        )}
      </KanbanSection>

      {failedToday.length > 0 && (
        <KanbanSection
          id="kanban-failed"
          title="Failed / Stopped"
          subtitle="Tasks that encountered errors or were stopped"
          count={failedToday.length}
          icon={<AlertTriangle />}
          accentColor="text-red-400"
          emphasis="low"
        >
          <div className="space-y-2">
            {failedToday.map((task) => (
              <FailedTaskCard key={task.id} task={task} onRetry={onRetryTask} />
            ))}
          </div>
        </KanbanSection>
      )}

      {nextActions.length > 0 && (
        <KanbanSection
          id="kanban-next-actions"
          title="Next Actions"
          subtitle="Suggested next steps"
          count={nextActions.length}
          icon={<ArrowRight />}
          accentColor="text-zinc-500"
          emphasis="low"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {nextActions.map((action) => (
              <NextActionCard
                key={action.id}
                action={action}
                onCreateTask={onCreateFromSuggestion}
              />
            ))}
          </div>
        </KanbanSection>
      )}
    </div>
  );
}
