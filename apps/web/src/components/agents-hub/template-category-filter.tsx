const CATEGORIES = [
  { value: "", label: "All" },
  { value: "research", label: "Research" },
  { value: "content", label: "Content" },
  { value: "assistant", label: "Assistant" },
  { value: "operations", label: "Operations" },
  { value: "support", label: "Support" },
  { value: "sales", label: "Sales" },
];

interface TemplateCategoryFilterProps {
  value: string;
  onChange: (v: string) => void;
}

export function TemplateCategoryFilter({ value, onChange }: TemplateCategoryFilterProps) {
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
