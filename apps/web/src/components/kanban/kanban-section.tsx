import type { ReactNode } from "react";

interface KanbanSectionProps {
  id?: string;
  title: string;
  subtitle?: string;
  count: number;
  icon: ReactNode;
  accentColor?: string;
  emphasis?: "high" | "medium" | "low";
  action?: ReactNode;
  children: ReactNode;
}

export function KanbanSection({
  id,
  title,
  subtitle,
  count,
  icon,
  accentColor = "text-zinc-400",
  emphasis = "medium",
  action,
  children,
}: KanbanSectionProps) {
  const borderColor =
    emphasis === "high"
      ? "border-zinc-700"
      : "border-zinc-800";
  const bgColor =
    emphasis === "high"
      ? "bg-zinc-900/80"
      : emphasis === "medium"
        ? "bg-zinc-900/50"
        : "bg-zinc-950/50";

  return (
    <section
      id={id}
      className={`scroll-mt-24 rounded-xl border ${borderColor} ${bgColor}`}
    >
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className={`flex shrink-0 [&_svg]:h-4 [&_svg]:w-4 ${accentColor}`}>{icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-800 px-1.5 text-xs font-medium tabular-nums text-zinc-400">
                {count}
              </span>
            </div>
            {subtitle && (
              <p className="mt-0.5 text-xs text-zinc-600">{subtitle}</p>
            )}
          </div>
        </div>
        {action && <div>{action}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
