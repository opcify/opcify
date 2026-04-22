"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import type { AgentSummary } from "@opcify/core";
import { StatusBadge } from "./status-badge";
import { formatTokens } from "@/lib/time";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const modelLabels: Record<string, string> = {
  "gpt-5.4": "GPT-5.4",
  "claude-sonnet": "Claude Sonnet",
  "claude-haiku": "Claude Haiku",
};

interface AgentCardProps {
  agent: AgentSummary;
  onRefresh: () => void;
}

export function AgentCard({ agent, onRefresh }: AgentCardProps) {
  const { workspaceId } = useWorkspace();
  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (agent.status === "disabled") {
      await api.agents.enable(workspaceId, agent.id);
    } else {
      await api.agents.disable(workspaceId, agent.id);
    }
    onRefresh();
  }

  return (
    <Link
      href={`/agents/${agent.id}`}
      className="group flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-all hover:border-zinc-700 hover:bg-zinc-800/60"
    >
      {/* Header: avatar + name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-sm font-bold text-zinc-400 group-hover:bg-zinc-700 group-hover:text-zinc-300">
            {agent.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-zinc-100 group-hover:text-white">
              {agent.name}
            </h3>
            <p className="mt-0.5 truncate text-sm text-zinc-500">{agent.role}</p>
          </div>
        </div>
        <StatusBadge status={agent.status} />
      </div>

      {/* Current task */}
      <div className="mt-3 rounded-lg bg-zinc-800/50 px-3 py-2.5">
        {agent.currentTask ? (
          <div>
            <p className="truncate text-xs font-medium text-zinc-300">
              {agent.currentTask.title}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-700">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${agent.currentTask.progress}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-zinc-500">
                {agent.currentTask.progress}%
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-600 italic">No active task</p>
        )}
      </div>

      {/* Stats row: model + skills */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 font-medium text-zinc-400">
          {modelLabels[agent.model] ?? agent.model}
        </span>
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-zinc-500">
          {agent.installedSkillsCount} skill{agent.installedSkillsCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Token usage row */}
      <div className="mt-3 flex items-center gap-4 border-t border-zinc-800/60 pt-3 text-xs">
        <div>
          <span className="text-zinc-500">Today </span>
          <span className="font-medium tabular-nums text-zinc-300">
            {formatTokens(agent.tokenUsageToday)}
          </span>
        </div>
        <div>
          <span className="text-zinc-500">Week </span>
          <span className="font-medium tabular-nums text-zinc-300">
            {formatTokens(agent.tokenUsageWeek)}
          </span>
        </div>
        {/* Enable/Disable toggle */}
        <button
          onClick={handleToggle}
          className="ml-auto rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
        >
          {agent.status === "disabled" ? "Enable" : "Disable"}
        </button>
      </div>
    </Link>
  );
}
