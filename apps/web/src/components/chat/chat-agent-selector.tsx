"use client";

import { useEffect, useState, useRef } from "react";
import type { AgentSummary } from "@opcify/core";
import { api } from "@/lib/api";
import { Bot, ChevronDown } from "lucide-react";

interface ChatAgentSelectorProps {
  workspaceId: string;
  selectedAgentId: string | null;
  onSelect: (agentId: string, name?: string) => void;
}

export function ChatAgentSelector({
  workspaceId,
  selectedAgentId,
  onSelect,
}: ChatAgentSelectorProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.agents
      .list(workspaceId)
      .then((list) => {
        const active = list.filter((a) => a.status !== "disabled");
        setAgents(active);
        if (active.length === 0) return;

        // If the page restored an ID from localStorage on first render, surface
        // the matching name to the parent (so the title bar updates) — and if
        // that ID no longer exists, fall through to the default-pick logic.
        if (selectedAgentId) {
          const current = active.find((a) => a.id === selectedAgentId);
          if (current) {
            onSelect(current.id, current.name);
            return;
          }
        }

        // No valid selection yet — pick the user's saved choice, then Personal
        // Assistant, then the first active agent.
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(`chat-agent-${workspaceId}`);
        } catch {
          // localStorage may be unavailable
        }
        const match = saved
          ? active.find((a) => a.id === saved)
          : undefined;
        const personalAssistant = active.find(
          (a) => a.name.toLowerCase() === "personal assistant",
        );
        const pick = match ?? personalAssistant ?? active[0];
        onSelect(pick.id, pick.name);
      })
      .catch(() => setAgents([]));
  }, [workspaceId, selectedAgentId, onSelect]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selected = agents.find((a) => a.id === selectedAgentId);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border-muted bg-surface-raised px-3 py-1.5 text-sm transition-colors hover:bg-surface-overlay"
      >
        <Bot className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-primary">{selected?.name || "Select agent"}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-border-muted bg-surface-raised shadow-xl">
          <div className="py-1">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => {
                  onSelect(agent.id, agent.name);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                  agent.id === selectedAgentId
                    ? "bg-surface-overlay text-primary"
                    : "text-tertiary hover:bg-surface-overlay/50 hover:text-secondary"
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    agent.status === "running"
                      ? "bg-emerald-400"
                      : agent.status === "error"
                        ? "bg-red-400"
                        : "bg-zinc-500"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{agent.name}</div>
                  <div className="truncate text-xs text-muted">{agent.role}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
