"use client";

import type { SuggestedTaskAction } from "@opcify/core";

interface NextActionCardProps {
  action: SuggestedTaskAction;
  onCreateTask: (action: SuggestedTaskAction) => void;
}

export function NextActionCard({ action, onCreateTask }: NextActionCardProps) {
  return (
    <div className="group flex flex-col justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700">
      <div>
        <p className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100">
          {action.title}
        </p>
        {action.suggestedAgentName && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-zinc-600">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-medium text-zinc-500">
              {action.suggestedAgentName.charAt(0).toUpperCase()}
            </span>
            {action.suggestedAgentName}
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-600 italic">{action.reason}</p>
      </div>
      <button
        onClick={() => onCreateTask(action)}
        className="mt-3 w-full rounded-md bg-zinc-800 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
      >
        Create Task
      </button>
    </div>
  );
}
