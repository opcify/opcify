"use client";

import { BarChart3, ClipboardCheck, Plus } from "lucide-react";

interface ChatQuickActionsProps {
  onSend: (message: string) => void;
  onCreateTask: () => void;
  streaming: boolean;
  disabled?: boolean;
}

const PROMPTS = {
  briefing:
    "Give me a daily briefing. Summarize: How many tasks are planned today? Which are in progress? Any waiting for my review? Any failures I should know about? Keep it concise.",
  review:
    "List all tasks currently waiting for my review. For each, show the title, agent who worked on it, and a one-line summary of what was done. Ask me if I want to accept, retry, or follow up on any of them.",
};

export function ChatQuickActions({
  onSend,
  onCreateTask,
  streaming,
  disabled,
}: ChatQuickActionsProps) {
  const isDisabled = streaming || disabled;

  return (
    <div className="flex items-center gap-2 border-b border-border-muted px-4 py-2 overflow-x-auto">
      <button
        onClick={() => onSend(PROMPTS.briefing)}
        disabled={isDisabled}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <BarChart3 className="h-3.5 w-3.5" />
        Daily Briefing
      </button>
      <button
        onClick={() => onSend(PROMPTS.review)}
        disabled={isDisabled}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ClipboardCheck className="h-3.5 w-3.5" />
        Review Tasks
      </button>
      <button
        onClick={onCreateTask}
        disabled={disabled}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus className="h-3.5 w-3.5" />
        Create Task
      </button>
    </div>
  );
}
