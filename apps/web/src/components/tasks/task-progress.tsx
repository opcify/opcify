export function TaskProgress({ value }: { value: number }) {
  const color =
    value === 100
      ? "bg-emerald-500"
      : value > 0
        ? "bg-blue-500"
        : "bg-zinc-600";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${Math.max(value, value > 0 ? 4 : 0)}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums ${value === 100 ? "font-medium text-emerald-400" : "text-zinc-500"}`}>
        {value}%
      </span>
    </div>
  );
}
