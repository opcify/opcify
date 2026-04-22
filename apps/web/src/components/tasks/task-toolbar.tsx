"use client";

import type { Agent } from "@opcify/core";

const STATUSES: { value: string; label: string; dot?: string }[] = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued", dot: "bg-blue-400" },
  { value: "running", label: "Running", dot: "bg-emerald-400" },
  { value: "waiting", label: "Waiting", dot: "bg-amber-400" },
  { value: "done", label: "Done", dot: "bg-emerald-400" },
  { value: "failed", label: "Failed", dot: "bg-red-400" },
  { value: "stopped", label: "Stopped", dot: "bg-orange-400" },
  { value: "archived", label: "Archived", dot: "bg-zinc-500" },
];

const PRIORITIES: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const SORTS: { value: string; label: string }[] = [
  { value: "updatedAt_desc", label: "Recently updated" },
  { value: "updatedAt_asc", label: "Oldest updated" },
  { value: "createdAt_desc", label: "Newest created" },
  { value: "priority_desc", label: "Highest priority" },
  { value: "progress_desc", label: "Most progress" },
  { value: "title_asc", label: "Title A→Z" },
];

interface TaskToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
  priority: string;
  onPriorityChange: (v: string) => void;
  agentId: string;
  onAgentChange: (v: string) => void;
  sort: string;
  onSortChange: (v: string) => void;
  agents: Agent[];
  onlyRunning: boolean;
  onOnlyRunningChange: (v: boolean) => void;
}

export function TaskToolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  priority,
  onPriorityChange,
  agentId,
  onAgentChange,
  sort,
  onSortChange,
  agents,
  onlyRunning,
  onOnlyRunningChange,
}: TaskToolbarProps) {
  return (
    <div className="space-y-3">
      {/* Top row: search + quick toggle */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1 0 5.65 5.65a7.5 7.5 0 0 0 10.6 10.6z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-700 focus:ring-0"
          />
        </div>

        <label className="hidden cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 sm:flex">
          <input
            type="checkbox"
            checked={onlyRunning}
            onChange={(e) => onOnlyRunningChange(e.target.checked)}
            className="h-3 w-3 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0 focus:ring-offset-0"
          />
          Running only
        </label>
      </div>

      {/* Status pills — scrollable on mobile */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 w-max sm:w-auto">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => onStatusChange(s.value)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                status === s.value
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {s.dot && <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters row — wraps on mobile */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Priority filter */}
        <select
          value={priority}
          onChange={(e) => onPriorityChange(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 outline-none transition-colors hover:border-zinc-700 focus:border-zinc-700"
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.value === "all" ? "All priorities" : p.label}
            </option>
          ))}
        </select>

        {/* Agent filter */}
        <select
          value={agentId}
          onChange={(e) => onAgentChange(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 outline-none transition-colors hover:border-zinc-700 focus:border-zinc-700"
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 outline-none transition-colors hover:border-zinc-700 focus:border-zinc-700 sm:ml-auto"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
