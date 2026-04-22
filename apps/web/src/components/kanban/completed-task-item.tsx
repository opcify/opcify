"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import { Check } from "lucide-react";
import type { TaskWithAgent } from "@opcify/core";
import { TaskTimingStrip } from "@/components/tasks/task-timing-strip";
import { AgentBadge } from "./agent-badge";
import { RecurringBadge } from "@/components/tasks/recurring-badge";

interface CompletedTaskItemProps {
  task: TaskWithAgent;
}

export function CompletedTaskItem({ task }: CompletedTaskItemProps) {
  return (
    <Link
      href={`/tasks/${task.id}?from=kanban`}
      className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-zinc-800/50"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
        <Check className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm text-zinc-400 group-hover:text-zinc-200">
          {task.title}
          <RecurringBadge recurringRuleId={task.recurringRuleId} />
        </p>
        {task.resultSummary && (
          <p className="mt-0.5 truncate text-xs text-zinc-600">
            {task.resultSummary}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs text-zinc-600">
        <AgentBadge name={task.agent.name} />
        <TaskTimingStrip task={task} variant="completed" />
      </div>
    </Link>
  );
}
