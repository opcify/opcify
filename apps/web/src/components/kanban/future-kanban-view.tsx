"use client";

import type { KanbanDateResponse, SuggestedTaskAction } from "@opcify/core";
import { Diamond, LayoutGrid } from "lucide-react";
import { KanbanSection } from "./kanban-section";
import { FuturePlannedTaskCard } from "./future-planned-task-card";
import { NextActionCard } from "./next-action-card";
import { TaskGroupCluster, groupTasksByTaskGroup } from "./task-group-cluster";

interface FutureKanbanViewProps {
  data: KanbanDateResponse;
  onAddTask: () => void;
  onDeleteTask: (id: string) => void;
  onCreateFromSuggestion: (action: SuggestedTaskAction) => void;
}

export function FutureKanbanView({
  data,
  onAddTask,
  onDeleteTask,
  onCreateFromSuggestion,
}: FutureKanbanViewProps) {
  const s = data.sections;
  const planned = s.plannedTasks ?? [];
  const suggested = s.suggestedTasks ?? [];

  const planItems = groupTasksByTaskGroup(planned);

  return (
    <div className="space-y-6">
      <KanbanSection
        title="Planned Tasks"
        subtitle="Tasks scheduled for this date"
        count={planned.length}
        icon={<Diamond />}
        accentColor="text-blue-400"
        emphasis="medium"
        action={
          <button
            onClick={onAddTask}
            className="rounded-md bg-blue-600/80 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
          >
            + Plan Task
          </button>
        }
      >
        {planned.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-zinc-600">
              Nothing planned yet for this date.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={onAddTask}
                className="rounded-lg bg-blue-600/80 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                Plan Task
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {planItems.map((item) =>
              item.type === "standalone" ? (
                <FuturePlannedTaskCard
                  key={item.task.id}
                  task={item.task}
                  onDelete={onDeleteTask}
                />
              ) : (
                <TaskGroupCluster key={item.group.id} group={item.group} tasks={item.tasks}>
                  {item.tasks.map((task) => (
                    <FuturePlannedTaskCard
                      key={task.id}
                      task={task}
                      onDelete={onDeleteTask}
                    />
                  ))}
                </TaskGroupCluster>
              ),
            )}
          </div>
        )}
      </KanbanSection>

      {suggested.length > 0 && (
        <KanbanSection
          title="Suggested Tasks"
          subtitle="Quick start from templates"
          count={suggested.length}
          icon={<LayoutGrid />}
          accentColor="text-zinc-500"
          emphasis="low"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {suggested.map((action) => (
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
