"use client";

import { useState, useCallback } from "react";
import { GitBranch, Sparkles } from "lucide-react";
import type { TaskPriority } from "@opcify/core";

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: "high", label: "High", color: "border-red-500/60 bg-red-500/10 text-red-400" },
  { value: "medium", label: "Medium", color: "border-amber-500/60 bg-amber-500/10 text-amber-400" },
  { value: "low", label: "Low", color: "border-zinc-600 bg-zinc-800 text-zinc-400" },
];

interface BreakDownModalProps {
  onClose: () => void;
  onSubmit: (data: { title: string; description: string; priority: TaskPriority; plannedDate?: string }) => void;
  submitting: boolean;
  defaultTitle?: string;
}

export function BreakDownModal({
  onClose,
  onSubmit,
  submitting,
  defaultTitle,
}: BreakDownModalProps) {
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [plannedDate, setPlannedDate] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) return;
      onSubmit({
        title: title.trim(),
        description: description.trim(),
        priority,
        plannedDate: plannedDate || undefined,
      });
    },
    [title, description, priority, plannedDate, onSubmit],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-violet-500/20 bg-zinc-900 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
            <GitBranch className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Break Down</h2>
            <p className="text-xs text-zinc-500">
              Describe your goal — the Decomposition Agent will break it into tasks
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Goal / Title
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Launch a tech blog"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/40"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide context, constraints, or scope…"
              rows={3}
              className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/40"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Priority
            </label>
            <div className="flex gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    priority === p.value
                      ? p.color
                      : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Planned Date (optional)
            </label>
            <input
              type="date"
              value={plannedDate}
              onChange={(e) => setPlannedDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-500/40"
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-violet-500/10 text-violet-400">
                <Sparkles className="h-3 w-3" />
              </span>
              Handled by the <span className="font-medium text-violet-400">Decomposition Agent</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Decomposition"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
