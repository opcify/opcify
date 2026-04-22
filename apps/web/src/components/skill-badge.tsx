const categoryColors: Record<string, string> = {
  coding: "border-blue-800 text-blue-400",
  research: "border-purple-800 text-purple-400",
  system: "border-amber-800 text-amber-400",
  communication: "border-emerald-800 text-emerald-400",
  general: "border-zinc-700 text-zinc-400",
};

export function SkillBadge({
  name,
  category,
}: {
  name: string;
  category?: string;
}) {
  const color = categoryColors[category ?? "general"] ?? categoryColors.general;
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {name}
    </span>
  );
}
