"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import type { TaskGroupInfo } from "@opcify/core";

interface TaskGroupBadgeProps {
  group: TaskGroupInfo;
  compact?: boolean;
}

export function TaskGroupBadge({ group, compact = false }: TaskGroupBadgeProps) {
  if (compact) {
    return (
      <Link
        href={`/task-groups/${group.id}`}
        className="inline-flex items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/5 px-1.5 py-0.5 text-[10px] font-medium text-violet-400 transition-colors hover:border-violet-500/40 hover:bg-violet-500/10"
      >
        <span className="text-violet-400/60">▧</span>
        <span className="max-w-[100px] truncate">{group.title}</span>
      </Link>
    );
  }

  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <Link
        href={`/task-groups/${group.id}`}
        className="inline-flex items-center gap-1 rounded-md border border-violet-500/20 bg-violet-500/5 px-2 py-0.5 text-[10px] font-medium text-violet-400 transition-colors hover:border-violet-500/40 hover:bg-violet-500/10"
      >
        <span className="text-violet-400/60">▧</span>
        <span className="max-w-[140px] truncate">{group.title}</span>
      </Link>
    </div>
  );
}
