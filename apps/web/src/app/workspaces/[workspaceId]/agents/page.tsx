"use client";

import { WsLink as Link } from "@/lib/workspace-link";
import { Bot } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useWorkspace } from "@/lib/workspace-context";
import { AgentCard } from "@/components/agent-card";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";

export default function AgentsPage() {
  const { workspaceId } = useWorkspace();
  const { data: agents, loading, error, refetch } = useApi(
    () => api.agents.list(workspaceId),
    [workspaceId],
  );

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Manage your OpenClaw agents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/agents-hub"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Agent Hub
          </Link>
          <Link
            href="/agents/create"
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Create Agent
          </Link>
          <div className="hidden md:block"><UserProfileDropdown /></div>
        </div>
      </div>

      {loading && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="h-5 w-32 rounded bg-zinc-800" />
                  <div className="mt-2 h-3 w-24 rounded bg-zinc-800" />
                </div>
                <div className="h-5 w-16 rounded-full bg-zinc-800" />
              </div>
              <div className="mt-3 h-12 rounded-lg bg-zinc-800/50" />
              <div className="mt-3 flex gap-3">
                <div className="h-4 w-20 rounded bg-zinc-800" />
                <div className="h-4 w-16 rounded bg-zinc-800" />
              </div>
              <div className="mt-2.5 flex gap-4">
                <div className="h-4 w-20 rounded bg-zinc-800" />
                <div className="h-4 w-20 rounded bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 py-16">
          <p className="text-sm text-red-400">Failed to load agents</p>
          <p className="mt-1 text-xs text-zinc-500">{error}</p>
          <button
            onClick={refetch}
            className="mt-3 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Retry
          </button>
        </div>
      )}

      {agents && agents.length === 0 && (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 py-20">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-500">
            <Bot className="h-7 w-7" />
          </div>
          <h3 className="text-base font-semibold text-zinc-200">No agents yet</h3>
          <p className="mt-1.5 max-w-xs text-center text-sm text-zinc-500">
            Create your first agent to start automating tasks.
          </p>
          <Link
            href="/agents/create"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Create Agent
          </Link>
        </div>
      )}

      {agents && agents.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onRefresh={refetch} />
          ))}
        </div>
      )}
    </>
  );
}
