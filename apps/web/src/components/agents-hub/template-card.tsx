import type { AgentTemplate } from "@opcify/core";

const modelLabels: Record<string, string> = {
  "gpt-5.4": "GPT-5.4",
  "claude-sonnet": "Claude Sonnet",
  "claude-haiku": "Claude Haiku",
};

const categoryColors: Record<string, string> = {
  research: "bg-purple-500/10 text-purple-400",
  content: "bg-blue-500/10 text-blue-400",
  assistant: "bg-emerald-500/10 text-emerald-400",
  operations: "bg-amber-500/10 text-amber-400",
  support: "bg-cyan-500/10 text-cyan-400",
  sales: "bg-rose-500/10 text-rose-400",
};

interface TemplateCardProps {
  template: AgentTemplate;
  onPreview: () => void;
  onUse: () => void;
}

export function TemplateCard({ template, onPreview, onUse }: TemplateCardProps) {
  const catColor = categoryColors[template.category] ?? "bg-zinc-500/10 text-zinc-400";

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-colors hover:border-zinc-700">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-zinc-100">
            {template.name}
          </h3>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${catColor}`}>
              {template.category}
            </span>
            <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              {modelLabels[template.defaultModel] ?? template.defaultModel}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 line-clamp-3 flex-1 text-sm text-zinc-500">
        {template.description}
      </p>

      {/* Skills count */}
      <div className="mt-3 text-xs text-zinc-600">
        {template.suggestedSkillKeys.length} suggested skill{template.suggestedSkillKeys.length !== 1 ? "s" : ""}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onUse}
          className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          Use Template
        </button>
        <button
          onClick={onPreview}
          className="rounded-lg border border-zinc-700 px-3.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
        >
          Preview
        </button>
      </div>
    </div>
  );
}
