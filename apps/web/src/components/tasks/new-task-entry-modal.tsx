"use client";

import { LayoutTemplate, Plus, GitBranch } from "lucide-react";

interface NewTaskEntryModalProps {
  onFromScratch: () => void;
  onFromTemplate: () => void;
  onBreakDown: () => void;
  onClose: () => void;
}

export function NewTaskEntryModal({
  onFromScratch,
  onFromTemplate,
  onBreakDown,
  onClose,
}: NewTaskEntryModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-zinc-100">New Task</h2>
        <p className="mt-1 text-sm text-zinc-500">
          How would you like to create your task?
        </p>

        <div className="mt-5 space-y-3">
          <button
            onClick={onFromTemplate}
            className="group flex w-full items-start gap-3 rounded-lg border border-zinc-800 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <LayoutTemplate className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-200 group-hover:text-white">
                Create from Template
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Pick a pre-built task template from the Task Template
              </p>
            </div>
          </button>

          <button
            onClick={onFromScratch}
            className="group flex w-full items-start gap-3 rounded-lg border border-zinc-800 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <Plus className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-200 group-hover:text-white">
                Create from Scratch
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Start with a blank task and fill in the details
              </p>
            </div>
          </button>

          <button
            onClick={onBreakDown}
            className="group flex w-full items-start gap-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 text-left transition-colors hover:border-violet-500/40 hover:bg-violet-500/10"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
              <GitBranch className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-200 group-hover:text-white">
                Break Down
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Describe a complex goal and let AI decompose it into tasks
              </p>
            </div>
          </button>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
