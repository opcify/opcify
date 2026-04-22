import { List, LayoutGrid } from "lucide-react";

export type TaskViewMode = "table" | "board";

interface TaskViewSwitcherProps {
  view: TaskViewMode;
  onChange: (view: TaskViewMode) => void;
}

const views: { value: TaskViewMode; label: string; Icon: typeof List }[] = [
  { value: "table", label: "Table", Icon: List },
  { value: "board", label: "Board", Icon: LayoutGrid },
];

export function TaskViewSwitcher({ view, onChange }: TaskViewSwitcherProps) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
      {views.map((v) => (
        <button
          key={v.value}
          onClick={() => onChange(v.value)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
            view === v.value
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <v.Icon className="h-3.5 w-3.5" />
          {v.label}
        </button>
      ))}
    </div>
  );
}
