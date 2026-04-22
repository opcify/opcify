"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import type { SourceTaskInfo } from "@opcify/core";

interface SourceTaskContextProps {
  sourceTask: SourceTaskInfo;
  compact?: boolean;
}

export function SourceTaskContext({ sourceTask, compact }: SourceTaskContextProps) {
  if (compact) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-600">
        <span className="text-blue-500/60">↳</span>
        <span className="text-zinc-600">from</span>
        <Link
          href={`/tasks/${sourceTask.id}?from=kanban`}
          className="max-w-[200px] truncate text-blue-400/70 hover:text-blue-400"
        >
          {sourceTask.title}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-2.5 rounded-md border border-zinc-800/80 bg-zinc-950/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
        <span className="text-blue-400/60">↳</span>
        Follow-up from
      </div>
      <Link
        href={`/tasks/${sourceTask.id}?from=kanban`}
        className="mt-1 block truncate text-xs text-zinc-400 hover:text-zinc-200"
      >
        {sourceTask.title}
      </Link>
      {sourceTask.resultSummary && (
        <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600">
          {sourceTask.resultSummary}
        </p>
      )}
      {sourceTask.reviewStatus === "followed_up" && (
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400/80">
          <span className="h-1 w-1 rounded-full bg-blue-400/60" />
          followed up
        </span>
      )}
    </div>
  );
}
