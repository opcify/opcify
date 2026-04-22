const CATEGORIES = [
  { value: "", label: "All" },
  { value: "research", label: "Research" },
  { value: "reporting", label: "Reporting" },
  { value: "content", label: "Content" },
  { value: "operations", label: "Operations" },
  { value: "sales", label: "Sales" },
];

interface TaskTemplateCategoryFilterProps {
  value: string;
  onChange: (v: string) => void;
}

export function TaskTemplateCategoryFilter({ value, onChange }: TaskTemplateCategoryFilterProps) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
      {CATEGORIES.map((c) => (
        <button
          key={c.value}
          onClick={() => onChange(c.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === c.value
              ? "bg-zinc-800 text-white"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
