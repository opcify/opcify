"use client";

import type { ReactNode } from "react";
import { WsLink as Link } from "@/lib/workspace-link";
import type { TaskGroupInfo, TaskWithAgent } from "@opcify/core";

interface TaskGroupClusterProps {
  group: TaskGroupInfo;
  tasks: TaskWithAgent[];
  children: ReactNode;
}

export function TaskGroupCluster({ group, tasks, children }: TaskGroupClusterProps) {
  const total = tasks.length;
  const completed = tasks.filter(
    (t) => t.status === "done" || t.reviewStatus === "accepted",
  ).length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-violet-500/15 bg-violet-500/[0.02]">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-xs text-violet-400/60">▧</span>
        <Link
          href={`/task-groups/${group.id}?from=kanban`}
          className="text-xs font-semibold text-violet-400 hover:text-violet-300"
        >
          {group.title}
        </Link>
        <div className="flex items-center gap-2">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-violet-500/60 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-zinc-600">
            {completed}/{total}
          </span>
        </div>
        <Link
          href={`/task-groups/${group.id}?from=kanban`}
          className="ml-auto rounded-md px-2 py-0.5 text-[10px] font-medium text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
        >
          View Group
        </Link>
      </div>
      <div className="space-y-2 px-2 pb-2">
        {children}
      </div>
    </div>
  );
}

export type GroupedItem = {
  type: "standalone";
  task: TaskWithAgent;
} | {
  type: "group";
  group: TaskGroupInfo;
  tasks: TaskWithAgent[];
};

/**
 * Takes a flat task list and returns items in original order,
 * but tasks sharing a group are clustered at the position of the first occurrence.
 */
export function groupTasksByTaskGroup(tasks: TaskWithAgent[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  const seenGroups = new Map<string, TaskWithAgent[]>();
  const groupOrder: { id: string; info: TaskGroupInfo }[] = [];

  for (const task of tasks) {
    if (!task.taskGroup) {
      items.push({ type: "standalone", task });
    } else {
      const gid = task.taskGroup.id;
      if (!seenGroups.has(gid)) {
        seenGroups.set(gid, []);
        groupOrder.push({ id: gid, info: task.taskGroup });
        items.push({ type: "group", group: task.taskGroup, tasks: seenGroups.get(gid)! });
      }
      seenGroups.get(gid)!.push(task);
    }
  }

  return items;
}
