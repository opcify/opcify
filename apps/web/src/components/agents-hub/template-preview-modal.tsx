"use client";

import type { AgentTemplateDetail } from "@opcify/core";
import { SkillBadge } from "@/components/skill-badge";

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

interface TemplatePreviewModalProps {
  template: AgentTemplateDetail;
  onClose: () => void;
  onUse: () => void;
}

export function TemplatePreviewModal({
  template,
  onClose,
  onUse,
}: TemplatePreviewModalProps) {
  const catColor = categoryColors[template.category] ?? "bg-zinc-500/10 text-zinc-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              {template.name}
            </h2>
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${catColor}`}>
                {template.category}
              </span>
              <span className="text-xs text-zinc-500">{template.role}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Description */}
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          {template.description}
        </p>

        {/* Model */}
        <div className="mt-5">
          <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Default Model
          </h4>
          <p className="mt-1.5 text-sm font-medium text-zinc-200">
            {modelLabels[template.defaultModel] ?? template.defaultModel}
          </p>
        </div>

        {/* Responsibilities */}
        <div className="mt-5">
          <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Responsibilities
          </h4>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-zinc-400">
            {template.responsibilitiesSummary}
          </p>
        </div>

        {/* Suggested Skills */}
        <div className="mt-5">
          <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Suggested Skills ({template.suggestedSkills.length})
          </h4>
          {template.suggestedSkills.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {template.suggestedSkills.map((s) => (
                <SkillBadge key={s.id} name={s.name} category={s.category} />
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-zinc-600">
              Skills not yet in catalog — they can be created after the agent is set up.
            </p>
          )}
          {template.suggestedSkillKeys.length > template.suggestedSkills.length && (
            <p className="mt-2 text-xs text-zinc-600">
              +{template.suggestedSkillKeys.length - template.suggestedSkills.length} skill{template.suggestedSkillKeys.length - template.suggestedSkills.length !== 1 ? "s" : ""} not yet in catalog
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Close
          </button>
          <button
            onClick={onUse}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Use This Template
          </button>
        </div>
      </div>
    </div>
  );
}
