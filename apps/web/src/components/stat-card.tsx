const accents: Record<string, string> = {
  default: "border-zinc-800",
  emerald: "border-emerald-800",
  red: "border-red-800",
  amber: "border-amber-800",
  blue: "border-blue-800",
};

export function StatCard({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div
      className={`rounded-lg border-l-2 bg-zinc-900 px-5 py-4 ${accents[accent] ?? accents.default}`}
    >
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-zinc-400">{label}</p>
    </div>
  );
}
