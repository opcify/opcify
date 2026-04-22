"use client";

const statusConfig: Record<string, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  inactive: {
    label: "Inactive",
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  archived: {
    label: "Archived",
    className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  },
};

export function ClientStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? statusConfig.active;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
