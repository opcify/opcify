import type { ComponentType } from "react";
import type { TaskPriority } from "@opcify/core";
import { ArrowUp, ArrowRight, ArrowDown } from "lucide-react";

const config: Record<
  TaskPriority,
  { bg: string; text: string; Icon: ComponentType<{ className?: string }> }
> = {
  high: { bg: "bg-red-500/10", text: "text-red-400", Icon: ArrowUp },
  medium: { bg: "bg-amber-500/10", text: "text-amber-400", Icon: ArrowRight },
  low: { bg: "bg-zinc-500/10", text: "text-zinc-400", Icon: ArrowDown },
};

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const c = config[priority] ?? config.medium;
  const Icon = c.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}
    >
      <Icon className="h-3 w-3" />
      {priority}
    </span>
  );
}
