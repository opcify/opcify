"use client";

import { useState, useCallback, useEffect } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { useChat } from "@/lib/use-chat";
import { ChatView } from "@/components/chat/chat-view";
import { ChatAgentSelector } from "@/components/chat/chat-agent-selector";
import { ChatSessionSwitcher } from "@/components/chat/chat-session-switcher";
import { ChatSettingsMenu } from "@/components/chat/chat-settings-menu";
import { RefreshCw } from "lucide-react";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";
import { useSidebar } from "@/lib/sidebar-context";

const SHOW_TOOL_CALLS_KEY = "chat-show-tool-calls";

// Per (workspace, agent) storage key for the last-selected chat session. The
// switcher itself falls back to "main" whenever the remembered session has
// been evicted from the gateway, so a stale entry here is self-healing.
function sessionStorageKey(workspaceId: string, agentId: string): string {
  return `chat-session-${workspaceId}-${agentId}`;
}

function readStoredSession(workspaceId: string, agentId: string | null): string {
  if (!agentId || typeof window === "undefined") return "main";
  try {
    return localStorage.getItem(sessionStorageKey(workspaceId, agentId)) || "main";
  } catch {
    return "main";
  }
}

function writeStoredSession(
  workspaceId: string,
  agentId: string | null,
  sessionKey: string,
): void {
  if (!agentId || typeof window === "undefined") return;
  try {
    localStorage.setItem(sessionStorageKey(workspaceId, agentId), sessionKey);
  } catch {
    // localStorage may be unavailable
  }
}

export default function ChatPage() {
  const { workspaceId } = useWorkspace();
  const { collapsed } = useSidebar();
  // Restore the user's last-picked agent synchronously on first render so the
  // chat reconnects immediately without flashing the "Select an agent" placeholder.
  // The selector still validates the ID against the live agent list and falls
  // back if the saved agent has been deleted/disabled.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(`chat-agent-${workspaceId}`);
    } catch {
      return null;
    }
  });
  const [agentName, setAgentName] = useState<string | undefined>();
  // Seed the session from localStorage on first render so a refresh or
  // back-navigation restores whatever the user was last viewing for this
  // agent. If no agent is picked yet this resolves to "main" and is
  // corrected once handleSelectAgent fires with the real id.
  const [sessionKey, setSessionKey] = useState<string>(() =>
    readStoredSession(workspaceId, selectedAgentId),
  );
  // User preference: show tool-call / tool-result messages in the chat view.
  // Persisted globally (not per-workspace) since it's a personal display pref.
  const [showToolCalls, setShowToolCalls] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = localStorage.getItem(SHOW_TOOL_CALLS_KEY);
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });

  const handleToggleToolCalls = useCallback((next: boolean) => {
    setShowToolCalls(next);
    try {
      localStorage.setItem(SHOW_TOOL_CALLS_KEY, String(next));
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  const {
    messages,
    streaming,
    streamText,
    streamThinking,
    connected,
    loading,
    error,
    send,
    abort,
    resetSession,
  } = useChat(workspaceId, selectedAgentId, sessionKey);

  // Hide parent scrollbar while this page is mounted
  useEffect(() => {
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, []);

  const handleSelectAgent = useCallback(
    (id: string, name?: string) => {
      setSelectedAgentId((prev) => {
        // On a real agent switch, load that agent's last-used session from
        // storage instead of resetting to "main" — otherwise bouncing between
        // agents throws away whichever scoped session (compose_*, task-*)
        // the user was just looking at.
        if (prev !== id) {
          setSessionKey(readStoredSession(workspaceId, id));
        }
        return id;
      });
      setAgentName(name);
      try {
        localStorage.setItem(`chat-agent-${workspaceId}`, id);
      } catch {
        // localStorage may be unavailable
      }
    },
    [workspaceId],
  );

  const handleSelectSession = useCallback(
    (next: string) => {
      setSessionKey(next);
      writeStoredSession(workspaceId, selectedAgentId, next);
    },
    [workspaceId, selectedAgentId],
  );

  return (
    <div className={`fixed inset-0 z-10 flex flex-col transition-all duration-200 ${collapsed ? "md:left-14" : "md:left-52"}`}>
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border-muted bg-surface px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-primary">
            {agentName ? `Chat with ${agentName}` : "Chat"}
          </h2>
          {selectedAgentId && (
            <ChatSessionSwitcher
              workspaceId={workspaceId}
              agentId={selectedAgentId}
              selectedSessionKey={sessionKey}
              onSelect={handleSelectSession}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.reload()}
            disabled={loading || streaming}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-tertiary transition-colors hover:bg-surface-overlay hover:text-secondary disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <ChatSettingsMenu
            showToolCalls={showToolCalls}
            onToggleToolCalls={handleToggleToolCalls}
          />
          <ChatAgentSelector
            workspaceId={workspaceId}
            selectedAgentId={selectedAgentId}
            onSelect={handleSelectAgent}
          />
          <UserProfileDropdown />
        </div>
      </div>

      {/* Chat area — fills remaining space */}
      <div className="flex-1 min-h-0 bg-surface">
        {selectedAgentId ? (
          <ChatView
            workspaceId={workspaceId}
            messages={messages}
            streaming={streaming}
            streamText={streamText}
            streamThinking={streamThinking}
            connected={connected}
            loading={loading}
            error={error}
            onSend={send}
            onAbort={abort}
            onReset={resetSession}
            agentName={agentName}
            showToolCalls={showToolCalls}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Select an agent to start chatting
          </div>
        )}
      </div>
    </div>
  );
}
