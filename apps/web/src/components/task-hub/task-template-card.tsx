import type { TaskTemplate } from "@opcify/core";

const categoryColors: Record<string, string> = {
  research: "bg-purple-500/10 text-purple-400",
  reporting: "bg-sky-500/10 text-sky-400",
  content: "bg-blue-500/10 text-blue-400",
  operations: "bg-amber-500/10 text-amber-400",
  sales: "bg-rose-500/10 text-rose-400",
};

const priorityLabels: Record<string, { label: string; color: string }> = {
  high: { label: "High", color: "text-red-400" },
  medium: { label: "Med", color: "text-amber-400" },
  low: { label: "Low", color: "text-zinc-500" },
};

interface TaskTemplateCardProps {
  template: TaskTemplate;
  agentName?: string;
  onPreview: () => void;
  onUse: () => void;
  onCustomize: () => void;
  onDelete?: () => void;
}

export function TaskTemplateCard({ template, agentName, onPreview, onUse, onCustomize, onDelete }: TaskTemplateCardProps) {
  const catColor = categoryColors[template.category] ?? "bg-zinc-500/10 text-zinc-400";
  const prio = template.defaultPriority ? priorityLabels[template.defaultPriority] : null;

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-colors hover:border-zinc-700">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-zinc-100">
            {template.name}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${catColor}`}>
              {template.category}
            </span>
            {prio && (
              <span className={`text-[10px] font-medium ${prio.color}`}>
                {prio.label}
              </span>
            )}
            {template.suggestedAgentRoles.slice(0, 2).map((role) => (
              <span
                key={role}
                className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
              >
                {role}
              </span>
            ))}
          </div>
        </div>
        {!template.isBuiltIn && (
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            Custom
          </span>
        )}
      </div>

      <p className="mt-3 line-clamp-3 flex-1 text-sm text-zinc-500">
        {template.description}
      </p>

      {agentName && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[10px] text-zinc-600">Agent:</span>
          <span className="text-[10px] font-medium text-zinc-400">{agentName}</span>
        </div>
      )}

      {template.defaultTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {template.defaultTags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-500"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onUse}
          className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          Use Template
        </button>
        <button
          onClick={onCustomize}
          className="rounded-lg border border-zinc-700 px-3.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
        >
          Customize
        </button>
        <button
          onClick={onPreview}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
        >
          Preview
        </button>
        {!template.isBuiltIn && onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="ml-auto rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:text-red-400"
            title="Delete template"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
