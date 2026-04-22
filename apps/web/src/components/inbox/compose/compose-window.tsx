"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Loader2, Mail, Maximize2, Minus, X } from "lucide-react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { useCompose } from "./compose-context";
import { ComposeForm } from "./compose-form";
import { ComposeAssistantPanel } from "./compose-assistant-panel";
import type { AgentSummary, EmailDraftAttachment } from "@opcify/core";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function pickPersonalAssistant(agents: AgentSummary[]): AgentSummary | null {
  if (!agents.length) return null;
  const exact = agents.find(
    (a) => a.name.toLowerCase().replace(/[-_\s]+/g, "") === "personalassistant",
  );
  if (exact) return exact;
  const partial = agents.find((a) =>
    a.name.toLowerCase().includes("personal assistant"),
  );
  if (partial) return partial;
  const assistant = agents.find((a) =>
    a.name.toLowerCase().includes("assistant"),
  );
  return assistant || agents[0];
}

export function ComposeWindow() {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const {
    isOpen,
    isMinimized,
    draft,
    draftId,
    saveStatus,
    loading,
    closeCompose,
    minimize,
    restore,
    setAttachments,
    notifySent,
  } = useCompose();

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!isOpen || !workspaceId) return;
    api.agents
      .list(workspaceId)
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [isOpen, workspaceId]);

  const assistant = pickPersonalAssistant(agents);

  const handleSend = useCallback(async () => {
    if (!workspaceId || !assistant) {
      toast("No personal assistant agent available", "error");
      return;
    }
    if (draft.to.length === 0) {
      toast("Add at least one recipient", "error");
      return;
    }
    if (!draft.subject.trim()) {
      toast("Subject is required", "error");
      return;
    }
    setSending(true);
    try {
      await api.inbox.compose(workspaceId, {
        agentId: assistant.id,
        draftId: draftId || undefined,
        to: draft.to,
        cc: draft.cc.length ? draft.cc : undefined,
        bcc: draft.bcc.length ? draft.bcc : undefined,
        subject: draft.subject,
        body: draft.body,
      });
      toast("Email sent", "success");
      notifySent();
      closeCompose();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to send email",
        "error",
      );
    } finally {
      setSending(false);
    }
  }, [workspaceId, assistant, draft, draftId, toast, notifySent, closeCompose]);

  // Used by the assistant panel when it sees `send: true` in a patch.
  const sendRef = useRef(handleSend);
  useEffect(() => {
    sendRef.current = handleSend;
  }, [handleSend]);
  const onAssistantSendRequested = useCallback(() => {
    void sendRef.current();
  }, []);

  // ── Window-level drag & drop ────────────────────────────────────────
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget === e.target) setDragOver(false);
  };
  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!draftId || !workspaceId) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;

    let nextAttachments: EmailDraftAttachment[] = [...draft.attachments];
    for (const file of files) {
      try {
        const data = await fileToBase64(file);
        const meta = await api.inbox.draftAttachment(workspaceId, draftId, {
          fileName: file.name,
          mediaType: file.type || "application/octet-stream",
          data,
        });
        nextAttachments = [...nextAttachments, meta];
      } catch (err) {
        toast(
          err instanceof Error
            ? `Failed to upload ${file.name}: ${err.message}`
            : `Failed to upload ${file.name}`,
          "error",
        );
      }
    }
    setAttachments(nextAttachments);
  };

  if (!isOpen) return null;

  // ── Minimized chip (bottom-left) ────────────────────────────────────
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border border-zinc-800 bg-surface-raised px-3 py-2 shadow-2xl">
        <Mail className="h-4 w-4 text-emerald-400" />
        <button
          type="button"
          onClick={restore}
          className="max-w-[220px] truncate text-sm text-primary hover:text-emerald-400"
        >
          {draft.subject || "New Message"}
        </button>
        <button
          type="button"
          onClick={restore}
          className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-overlay hover:text-secondary"
          title="Restore"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={closeCompose}
          className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-overlay hover:text-secondary"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // ── Expanded floating window ────────────────────────────────────────
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex h-[640px] w-[960px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-surface-raised shadow-2xl"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-emerald-500 bg-emerald-500/10 text-sm font-medium text-emerald-300">
          Drop files to attach
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-2">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium text-primary">
            {draft.subject || "New Message"}
          </span>
          <span className="text-[11px] text-muted">
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "saved"
                ? "Saved"
                : saveStatus === "error"
                  ? "Save failed"
                  : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={minimize}
            className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-overlay hover:text-secondary"
            title="Minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={closeCompose}
            className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-overlay hover:text-secondary"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body — flex row split 60/40. We use flex (not grid) so each pane
          gets a real stretched height, which lets the body editor flex-1
          all the way down to the form footer. A grid row would default to
          `auto` and collapse to its content, leaving the markdown editor
          stuck at its minimum height. */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-[3] flex-col border-r border-zinc-800">
            <ComposeForm sending={sending} onSend={handleSend} />
          </div>
          <div className="flex min-h-0 min-w-0 flex-[2] flex-col">
            <ComposeAssistantPanel
              workspaceId={workspaceId || ""}
              agentId={assistant?.id || null}
              agentName={assistant?.name}
              onAssistantSendRequested={onAssistantSendRequested}
            />
          </div>
        </div>
      )}
    </div>
  );
}
