"use client";

import type { ReactNode } from "react";
import type {
  KanbanDateResponse,
  SuggestedTaskAction,
  TaskWithAgent,
} from "@opcify/core";
import { Diamond, Check, Clock, AlertTriangle, ArrowRight } from "lucide-react";
import { TaskGroupCluster, groupTasksByTaskGroup } from "./task-group-cluster";
import { AgentBadge } from "./agent-badge";
import { AssignedTaskRow } from "./past/assigned-task-row";
import { CompletedTaskRow } from "./past/completed-task-row";
import { InProgressTaskRow } from "./past/in-progress-task-row";
import { AttentionTaskRow } from "./past/attention-task-row";

interface PastKanbanViewProps {
  data: KanbanDateResponse;
  onAcceptTask: (id: string) => void;
  onRetryTask: (id: string, overrideInstruction?: string) => void;
  onFollowUpTask: (task: TaskWithAgent) => void;
  onCreateFromSuggestion: (action: SuggestedTaskAction) => void;
  onGoToToday: () => void;
}

export function PastKanbanView({
  data,
  onAcceptTask,
  onRetryTask,
  onFollowUpTask,
  onCreateFromSuggestion,
  onGoToToday,
}: PastKanbanViewProps) {
  const s = data.sections;
  const assigned = s.assignedThatDay ?? [];
  const completed = s.completedThatDay ?? [];
  const inProgress = s.stillInProgress ?? [];
  const attention = s.attentionNeeded ?? [];
  const suggestions = s.suggestedNextSteps ?? [];

  const isEmpty =
    assigned.length === 0 &&
    completed.length === 0 &&
    inProgress.length === 0 &&
    attention.length === 0;

  if (isEmpty) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
          <span className="text-lg text-zinc-600">📋</span>
        </div>
        <p className="text-lg font-medium text-zinc-400">
          No activity recorded for this date
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-zinc-600">
          There were no tasks created, completed, or active on this day.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={onGoToToday}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Go to Today
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {data.dailySummaryText && (
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-5 py-3">
          <p className="text-sm text-zinc-400">{data.dailySummaryText}</p>
        </div>
      )}

      {assigned.length > 0 && (
        <ReportSection
          title="Assigned That Day"
          subtitle="Tasks created or assigned on this date"
          icon={<Diamond />}
          accentColor="text-blue-400"
          count={assigned.length}
        >
          <GroupedTaskRows
            tasks={assigned}
            renderCard={(task) => <AssignedTaskRow key={task.id} task={task} />}
          />
        </ReportSection>
      )}

      {completed.length > 0 && (
        <ReportSection
          title="Completed That Day"
          subtitle="Tasks finished on this date"
          icon={<Check />}
          accentColor="text-emerald-400"
          count={completed.length}
        >
          <GroupedTaskRows
            tasks={completed}
            renderCard={(task) => <CompletedTaskRow key={task.id} task={task} />}
          />
        </ReportSection>
      )}

      {inProgress.length > 0 && (
        <ReportSection
          title="Still In Progress"
          subtitle="Tasks that were active or unfinished"
          icon={<Clock />}
          accentColor="text-amber-400"
          count={inProgress.length}
        >
          <GroupedTaskRows
            tasks={inProgress}
            renderCard={(task) => <InProgressTaskRow key={task.id} task={task} />}
          />
        </ReportSection>
      )}

      {attention.length > 0 && (
        <ReportSection
          title="Attention Needed"
          subtitle="Tasks that required action or awareness"
          icon={<AlertTriangle />}
          accentColor="text-red-400"
          count={attention.length}
        >
          <GroupedTaskRows
            tasks={attention}
            renderCard={(task) => (
              <AttentionTaskRow
                key={task.id}
                task={task}
                onAccept={onAcceptTask}
                onRetry={onRetryTask}
                onFollowUp={() => onFollowUpTask(task)}
              />
            )}
          />
        </ReportSection>
      )}

      {suggestions.length > 0 && (
        <ReportSection
          title="Suggested Next Steps"
          subtitle="Turn this recap into action"
          icon={<ArrowRight />}
          accentColor="text-violet-400"
          count={suggestions.length}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((action) => (
              <SuggestionCard
                key={action.id}
                action={action}
                onCreateTask={onCreateFromSuggestion}
              />
            ))}
          </div>
        </ReportSection>
      )}
    </div>
  );
}

function GroupedTaskRows({
  tasks,
  renderCard,
}: {
  tasks: TaskWithAgent[];
  renderCard: (task: TaskWithAgent) => ReactNode;
}) {
  const items = groupTasksByTaskGroup(tasks);
  return (
    <>
      {items.map((item) =>
        item.type === "standalone" ? (
          renderCard(item.task)
        ) : (
          <div key={item.group.id} className="mx-1 my-1">
            <TaskGroupCluster group={item.group} tasks={item.tasks}>
              {item.tasks.map((task) => renderCard(task))}
            </TaskGroupCluster>
          </div>
        ),
      )}
    </>
  );
}

function ReportSection({
  title,
  subtitle,
  icon,
  accentColor,
  count,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  accentColor: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800/60 bg-zinc-950/40">
      <div className="flex items-center justify-between border-b border-zinc-800/40 px-5 py-3">
        <div className="flex items-center gap-3">
          <span
            className={`flex shrink-0 [&_svg]:h-4 [&_svg]:w-4 ${accentColor}`}
          >
            {icon}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-300">{title}</h2>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-800/80 px-1.5 text-xs font-medium tabular-nums text-zinc-500">
                {count}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-600">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-zinc-800/30 px-1">{children}</div>
    </section>
  );
}

function SuggestionCard({
  action,
  onCreateTask,
}: {
  action: SuggestedTaskAction;
  onCreateTask: (action: SuggestedTaskAction) => void;
}) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-4 transition-colors hover:border-zinc-700/60">
      <div>
        <p className="text-sm font-medium text-zinc-300">{action.title}</p>
        {action.suggestedAgentName && (
          <div className="mt-1.5">
            <AgentBadge name={action.suggestedAgentName} />
          </div>
        )}
        <p className="mt-2 text-xs italic text-zinc-600">{action.reason}</p>
      </div>
      <button
        onClick={() => onCreateTask(action)}
        className="mt-3 w-full rounded-md bg-zinc-800/80 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
      >
        Create Task
      </button>
    </div>
  );
}
