"use client";

import React, { useState } from "react";
import type { Agent, TaskPriority, TaskWithAgent } from "@opcify/core";

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: "high", label: "High", color: "border-red-500/60 bg-red-500/10 text-red-400" },
  { value: "medium", label: "Medium", color: "border-amber-500/60 bg-amber-500/10 text-amber-400" },
  { value: "low", label: "Low", color: "border-zinc-600 bg-zinc-800 text-zinc-400" },
];

interface FollowUpTaskModalProps {
  sourceTask: TaskWithAgent;
  agents: Agent[];
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    agentId?: string;
    priority: TaskPriority;
    plannedDate?: string;
  }) => void;
  submitting: boolean;
}

export function FollowUpTaskModal({
  sourceTask,
  agents,
  onClose,
  onSubmit,
  submitting,
}: FollowUpTaskModalProps) {
  const [title, setTitle] = useState(`Follow up: ${sourceTask.title}`);
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState(sourceTask.agentId);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [plannedDate, setPlannedDate] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      agentId,
      priority,
      plannedDate: plannedDate || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-zinc-100">
            Follow-up Task
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Create a new task based on the result of{" "}
            <span className="text-zinc-400">&ldquo;{sourceTask.title}&rdquo;</span>
          </p>
        </div>

        {sourceTask.resultSummary && (
          <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Previous Result
            </p>
            <p className="line-clamp-3 text-xs text-zinc-400">
              {sourceTask.resultSummary}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Title
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What should the agent do next?"
              className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700"
            />
            {sourceTask.resultSummary && (
              <p className="mt-1.5 text-[10px] text-zinc-600">
                The agent will automatically fetch the full context of the previous task.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Priority
              </label>
              <div className="flex gap-1.5">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${
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
                Planned Date
              </label>
              <input
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-700"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Assign Agent
            </label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.role}
                </option>
              ))}
            </select>
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
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Follow-up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
