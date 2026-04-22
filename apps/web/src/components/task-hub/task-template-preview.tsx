"use client";

import type { TaskTemplate } from "@opcify/core";

const categoryColors: Record<string, string> = {
  research: "bg-purple-500/10 text-purple-400",
  reporting: "bg-sky-500/10 text-sky-400",
  content: "bg-blue-500/10 text-blue-400",
  operations: "bg-amber-500/10 text-amber-400",
  sales: "bg-rose-500/10 text-rose-400",
};

interface TaskTemplatePreviewProps {
  template: TaskTemplate;
  onClose: () => void;
  onUse: () => void;
}

export function TaskTemplatePreview({
  template,
  onClose,
  onUse,
}: TaskTemplatePreviewProps) {
  const catColor = categoryColors[template.category] ?? "bg-zinc-500/10 text-zinc-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              {template.name}
            </h2>
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${catColor}`}>
                {template.category}
              </span>
              {!template.isBuiltIn && (
                <span className="text-[10px] text-zinc-600">Custom</span>
              )}
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

        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          {template.description}
        </p>

        <div className="mt-5">
          <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Default Title
          </h4>
          <p className="mt-1.5 text-sm font-medium text-zinc-200">
            {template.defaultTitle}
          </p>
        </div>

        <div className="mt-5">
          <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Default Description
          </h4>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-zinc-400">
            {template.defaultDescription}
          </p>
        </div>

        <div className="mt-5">
          <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Suggested Agent Roles
          </h4>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {template.suggestedAgentRoles.map((role) => (
              <span
                key={role}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
              >
                {role}
              </span>
            ))}
          </div>
        </div>

        {template.defaultTags.length > 0 && (
          <div className="mt-5">
            <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Tags
            </h4>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {template.defaultTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-zinc-800/60 px-2 py-0.5 text-xs text-zinc-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

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
