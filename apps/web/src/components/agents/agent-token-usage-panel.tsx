import type { AgentTokenUsage } from "@opcify/core";
import { formatTokens } from "@/lib/time";

interface AgentTokenUsagePanelProps {
  usage: AgentTokenUsage;
}

export function AgentTokenUsagePanel({ usage }: AgentTokenUsagePanelProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-lg bg-zinc-900 px-4 py-3 text-center">
        <p className="text-xl font-semibold tabular-nums text-zinc-100">
          {formatTokens(usage.today)}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">Today</p>
      </div>
      <div className="rounded-lg bg-zinc-900 px-4 py-3 text-center">
        <p className="text-xl font-semibold tabular-nums text-blue-400">
          {formatTokens(usage.week)}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">This Week</p>
      </div>
      <div className="rounded-lg bg-zinc-900 px-4 py-3 text-center">
        <p className="text-xl font-semibold tabular-nums text-zinc-400">
          {formatTokens(usage.total)}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">All Time</p>
      </div>
    </div>
  );
}
