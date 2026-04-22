"use client";

import { useEffect, useState, useRef } from "react";
import type { ChatSessionInfo } from "@opcify/core";
import { api } from "@/lib/api";
import { MessagesSquare, ChevronDown } from "lucide-react";

interface ChatSessionSwitcherProps {
  workspaceId: string;
  agentId: string;
  selectedSessionKey: string;
  onSelect: (sessionKey: string) => void;
}

export function ChatSessionSwitcher({
  workspaceId,
  agentId,
  selectedSessionKey,
  onSelect,
}: ChatSessionSwitcherProps) {
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setSessions([]);
    api.chat
      .sessions(agentId, workspaceId)
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions);
        // If the previously-selected session has been evicted from the gateway,
        // fall back to main so the button label doesn't point at a dead session.
        if (
          selectedSessionKey !== "main" &&
          !res.sessions.some((s) => s.sessionKey === selectedSessionKey)
        ) {
          onSelect("main");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessions([
            { sessionKey: "main", totalTokens: 0, inputTokens: 0, outputTokens: 0 },
          ]);
        }
      });
    return () => {
      cancelled = true;
    };
    // We intentionally only refetch when the agent or workspace changes —
    // switching the selected session in the dropdown must not re-list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, agentId]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const disabled = sessions.length <= 1;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={disabled ? "No other sessions" : "Switch session"}
        className="flex items-center gap-2 rounded-lg border border-border-muted bg-surface-raised px-3 py-1.5 text-sm transition-colors hover:bg-surface-overlay disabled:cursor-default disabled:opacity-50 disabled:hover:bg-surface-raised"
      >
        <MessagesSquare className="h-3.5 w-3.5 text-emerald-400" />
        <span className="font-mono text-primary">{selectedSessionKey}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && !disabled && (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-border-muted bg-surface-raised shadow-xl">
          <div className="py-1">
            {sessions.map((s) => (
              <button
                key={s.sessionKey}
                onClick={() => {
                  onSelect(s.sessionKey);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                  s.sessionKey === selectedSessionKey
                    ? "bg-surface-overlay text-primary"
                    : "text-tertiary hover:bg-surface-overlay/50 hover:text-secondary"
                }`}
              >
                <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono">{s.sessionKey}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
