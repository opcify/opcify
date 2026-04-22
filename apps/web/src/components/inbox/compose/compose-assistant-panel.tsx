"use client";

import { useEffect, useMemo, useRef } from "react";
import { PenSquare, Sparkles, Type, Wand2 } from "lucide-react";
import { ChatView } from "@/components/chat/chat-view";
import { useChat } from "@/lib/use-chat";
import { useCompose, type ComposeDraft } from "./compose-context";
import {
  buildAugmentedMessage,
  extractEmailPatch,
  sanitizeMessagesForDisplay,
} from "./compose-utils";
import type { EmailPatch } from "@opcify/core";

interface ComposeAssistantPanelProps {
  workspaceId: string;
  agentId: string | null;
  agentName?: string;
  /** Called when the assistant requests `send: true` in a patch. */
  onAssistantSendRequested: () => void;
}

function serializeDraft(draft: ComposeDraft): string {
  return JSON.stringify({
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    body: draft.body,
    hasAttachments: draft.attachments.length > 0,
    attachmentNames: draft.attachments.map((a) => a.fileName),
  });
}

export function ComposeAssistantPanel({
  workspaceId,
  agentId,
  agentName,
  onAssistantSendRequested,
}: ComposeAssistantPanelProps) {
  const { draft, draftId, applyAssistantPatch } = useCompose();
  // Session key MUST NOT contain ":" — the gateway uses ":" as a separator
  // inside its "agent:{slug}:{scope}" prefix and would mis-parse a colon-bearing
  // scope. Use underscore instead so the chat module's toGatewaySessionKey can
  // forward it as-is and resolveSessionKey can decode it back.
  const sessionKey = draftId ? `compose_${draftId}` : undefined;

  const chat = useChat(workspaceId, agentId, sessionKey);

  // Keep a ref to the latest draft so the augmented send can read fresh state
  // without re-creating the wrapper on every keystroke.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const handleSend = (message: string) => {
    if (!agentId) return;
    const augmented = buildAugmentedMessage(
      message,
      serializeDraft(draftRef.current),
    );
    void chat.send(augmented);
  };

  // Watch for new assistant messages and apply any email-patch blocks.
  const seenIndex = useRef(0);
  useEffect(() => {
    for (let i = seenIndex.current; i < chat.messages.length; i++) {
      const msg = chat.messages[i];
      if (msg.role !== "assistant") continue;
      const text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");
      const patch: EmailPatch | null = extractEmailPatch(text);
      if (patch) {
        applyAssistantPatch(patch, onAssistantSendRequested);
      }
    }
    seenIndex.current = chat.messages.length;
  }, [chat.messages, applyAssistantPatch, onAssistantSendRequested]);

  // Display-friendly messages: hide [COMPOSE-CONTEXT] and ```email-patch fences.
  const visibleMessages = useMemo(
    () => sanitizeMessagesForDisplay(chat.messages),
    [chat.messages],
  );

  // Email-drafting tips shown when the assistant chat is empty. These cards
  // replace ChatView's default "Daily Briefing / Review Pending Work / Assign
  // New Work" cards with prompts that match the compose context — clicking
  // one fires handleSend, which augments with the current draft state and
  // sends it through the chat session.
  const composeEmptyState = (
    <ComposeChatEmptyState
      onSend={handleSend}
      hasDraft={
        draft.to.length > 0 ||
        draft.subject.trim().length > 0 ||
        draft.body.trim().length > 0
      }
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-zinc-800 px-4 py-2">
        <div className="text-xs font-medium text-secondary">
          Personal Assistant
        </div>
        <div className="text-[11px] text-muted">
          Now, your will help me to create a new e-mail to send to others. Tell
          me what to draft, change, or send.
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {!agentId ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
            No personal assistant agent found in this workspace. Create one to
            chat while composing.
          </div>
        ) : (
          <ChatView
            workspaceId={workspaceId}
            messages={visibleMessages}
            streaming={chat.streaming}
            streamText={chat.streamText}
            streamThinking={chat.streamThinking}
            connected={chat.connected}
            loading={chat.loading}
            error={chat.error}
            onSend={handleSend}
            onAbort={chat.abort}
            onReset={chat.resetSession}
            agentName={agentName || "Personal Assistant"}
            compact
            emptyState={composeEmptyState}
          />
        )}
      </div>
    </div>
  );
}

// ─── Email-drafting empty state ───────────────────────────────────────

function ComposeChatEmptyState({
  onSend,
  hasDraft,
}: {
  onSend: (message: string) => void;
  hasDraft: boolean;
}) {
  // Tip cards. The first one varies by whether the user has already started
  // writing — if not, we offer to draft from scratch; if so, we offer to
  // polish what they've already typed.
  const cards = hasDraft
    ? [
        {
          icon: Wand2,
          title: "Polish my draft",
          subtitle:
            "Review what I've written and improve clarity, tone, and flow",
          prompt:
            "Read my current draft and rewrite it to be clearer, friendlier, and more professional. Keep the same meaning and length unless I asked otherwise.",
        },
        {
          icon: Sparkles,
          title: "Make it shorter",
          subtitle: "Trim my draft to the essentials without losing the point",
          prompt:
            "Shorten my current draft. Keep the core message and the call to action, drop everything that isn't essential.",
        },
        {
          icon: Type,
          title: "Suggest a subject line",
          subtitle:
            "Pick a clear, scannable subject based on the body I've written",
          prompt:
            "Based on the body of my current draft, suggest a clear and specific subject line. Update the subject directly.",
        },
      ]
    : [
        {
          icon: PenSquare,
          title: "Draft from scratch",
          subtitle:
            "Tell me who it's to and what it's about — I'll write the first draft",
          prompt:
            "Help me draft a brand new email. Ask me one question at a time: who it's to, what it's about, what tone I want, and the key points I need to make. Then write the draft and update the To, Subject, and Body fields.",
        },
        {
          icon: Sparkles,
          title: "Reply / follow-up template",
          subtitle:
            "Quickly start a polite follow-up or check-in for a thread I'm thinking about",
          prompt:
            "I want to send a polite follow-up email. Ask me who I'm following up with, what we last talked about, and what I'm asking for. Then draft it and fill in the Subject and Body.",
        },
        {
          icon: Type,
          title: "Meeting request",
          subtitle:
            "Set up a meeting with someone — I'll ask for time, attendees, and agenda",
          prompt:
            "Help me write a meeting request email. Ask me who I'm inviting, what the meeting is about, and a couple of time options. Then draft it and update the To, Subject, and Body.",
        },
      ];

  return (
    <div className="flex flex-col items-center justify-center py-10">
      <h3 className="text-base font-medium text-primary">
        How can I help with this email?
      </h3>
      <p className="mt-1 text-xs text-muted">
        Pick a tip below or type a message to ask the assistant
      </p>
      <div className="mt-6 grid w-full max-w-sm gap-2.5">
        {cards.map((card) => (
          <button
            key={card.title}
            onClick={() => onSend(card.prompt)}
            className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-surface-raised p-3 text-left transition-colors hover:border-zinc-700 hover:bg-surface-overlay"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10">
              <card.icon className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-primary">
                {card.title}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">
                {card.subtitle}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
