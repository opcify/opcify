"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage as ChatMessageType, ChatAttachment, Agent } from "@opcify/core";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { ChatStreamingIndicator } from "./chat-streaming-indicator";
import { ChatQuickActions } from "./chat-quick-actions";
import { TaskCreateModal, type TaskCreateData } from "../tasks/task-create-modal";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Loader2, BarChart3, ClipboardCheck, Plus } from "lucide-react";

interface ChatViewProps {
  workspaceId: string;
  messages: ChatMessageType[];
  streaming: boolean;
  streamText: string;
  streamThinking?: string;
  connected: boolean;
  loading: boolean;
  error: string | null;
  onSend: (message: string, attachments?: ChatAttachment[]) => void;
  onAbort: () => void;
  onReset: () => void;
  agentName?: string;
  /** Hide the Daily Briefing / Review Tasks / Create Task bar. */
  compact?: boolean;
  /**
   * Optional override for the no-messages empty state. When provided, this
   * node is rendered instead of the default Daily Briefing / Review Pending
   * Work / Assign New Work cards. Used by the email composer to show
   * drafting-specific tips that match the assistant's role in that context.
   */
  emptyState?: ReactNode;
  /**
   * When false, tool_use/tool_result blocks are hidden from the rendered
   * messages. Defaults to true so embedded consumers keep their current
   * behavior. The main chat page wires this to a settings toggle.
   */
  showToolCalls?: boolean;
}

export function ChatView({
  workspaceId,
  messages,
  streaming,
  streamText,
  streamThinking,
  loading,
  error,
  onSend,
  onAbort,
  onReset,
  agentName,
  compact,
  emptyState,
  showToolCalls = true,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTaskCreate, setShowTaskCreate] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamText]);

  // Fetch agents for task creation modal
  useEffect(() => {
    api.agents.list(workspaceId).then(setAgents).catch(() => {});
  }, [workspaceId]);

  const handleCreateTask = async (data: TaskCreateData) => {
    setSubmitting(true);
    try {
      const agentObj = agents.find((a) => a.id === data.agentId);
      await api.tasks.create(workspaceId, {
        title: data.title,
        description: data.description || undefined,
        agentId: data.agentId,
        priority: data.priority,
        clientId: data.clientId,
      });
      setShowTaskCreate(false);
      toast("Task created");
      onSend(
        `I just created a task: "${data.title}" assigned to ${agentObj?.name || "agent"}. Priority: ${data.priority}.`,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create task", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <div className="flex h-full flex-col">
      {/* Quick actions bar (hidden in compact/embedded mode) */}
      {!compact && (
        <ChatQuickActions
          onSend={onSend}
          onCreateTask={() => setShowTaskCreate(true)}
          streaming={streaming}
          disabled={loading}
        />
      )}

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : isEmpty ? (
            emptyState ?? (
              <ChatEmptyState onSend={onSend} agentName={agentName} />
            )
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  message={msg}
                  agentName={agentName}
                  showToolCalls={showToolCalls}
                />
              ))}
              {streaming && (
                <ChatStreamingIndicator text={streamText} thinking={streamThinking} agentName={agentName} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-t border-red-800/30 bg-red-900/20 px-4 py-2 text-center text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <ChatInput
          onSend={onSend}
          onAbort={onAbort}
          onReset={onReset}
          streaming={streaming}
          disabled={loading}
        />
      </div>

      {/* Task create modal */}
      {showTaskCreate && (
        <TaskCreateModal
          agents={agents}
          onClose={() => setShowTaskCreate(false)}
          onSubmit={handleCreateTask}
          submitting={submitting}
        />
      )}
    </div>
  );
}

// ─── Enhanced empty state ──────────────────────────────────────────

function ChatEmptyState({
  onSend,
  agentName,
}: {
  onSend: (message: string) => void;
  agentName?: string;
}) {
  const cards = [
    {
      icon: BarChart3,
      title: "Daily Briefing",
      subtitle: "Get a summary of today's tasks, progress, and items needing attention",
      prompt:
        "Give me a daily briefing. Summarize: How many tasks are planned today? Which are in progress? Any waiting for my review? Any failures I should know about? Keep it concise.",
    },
    {
      icon: ClipboardCheck,
      title: "Review Pending Work",
      subtitle: "See what agents have completed and make accept/retry decisions",
      prompt:
        "List all tasks currently waiting for my review. For each, show the title, agent who worked on it, and a one-line summary of what was done. Ask me if I want to accept, retry, or follow up on any of them.",
    },
    {
      icon: Plus,
      title: "Assign New Work",
      subtitle: "Describe what you need done and let the agent handle it",
      prompt:
        "I want to assign a new piece of work. Help me define it: ask me what needs to be done, then suggest which agent should handle it, the right priority, and create the task.",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <h3 className="text-lg font-medium text-primary">
        {agentName ? `Chat with ${agentName}` : "How can I help?"}
      </h3>
      <p className="mt-1 text-sm text-muted">
        Choose an action or type a message below
      </p>
      <div className="mt-8 grid w-full max-w-lg gap-3">
        {cards.map((card) => (
          <button
            key={card.title}
            onClick={() => onSend(card.prompt)}
            className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-surface-raised p-4 text-left transition-colors hover:border-zinc-700 hover:bg-surface-overlay"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10">
              <card.icon className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-sm font-medium text-primary">{card.title}</div>
              <div className="mt-0.5 text-xs text-muted">{card.subtitle}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
