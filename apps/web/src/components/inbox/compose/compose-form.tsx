"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { Loader2, Paperclip, Send, Trash2, X } from "lucide-react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { useCompose } from "./compose-context";
import type { EmailDraftAttachment } from "@opcify/core";

interface ComposeFormProps {
  /** External send handler shared with the assistant panel. */
  sending: boolean;
  onSend: () => Promise<void>;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip "data:*/*;base64," prefix
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ComposeForm({ sending, onSend }: ComposeFormProps) {
  const {
    workspaceId,
    draft,
    draftId,
    updateDraft,
    setAttachments,
    discardDraft,
  } = useCompose();
  const { toast } = useToast();

  const [showCcBcc, setShowCcBcc] = useState(
    draft.cc.length > 0 || draft.bcc.length > 0,
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // If the assistant adds cc/bcc via patch, expand the section automatically.
  useEffect(() => {
    if (draft.cc.length > 0 || draft.bcc.length > 0) setShowCcBcc(true);
  }, [draft.cc.length, draft.bcc.length]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!draftId || !workspaceId) return;
      setUploading(true);
      try {
        const data = await fileToBase64(file);
        const meta = await api.inbox.draftAttachment(workspaceId, draftId, {
          fileName: file.name,
          mediaType: file.type || "application/octet-stream",
          data,
        });
        setAttachments([...draft.attachments, meta]);
      } catch (err) {
        toast(
          err instanceof Error ? err.message : "Failed to upload attachment",
          "error",
        );
      } finally {
        setUploading(false);
      }
    },
    [workspaceId, draftId, draft.attachments, setAttachments, toast],
  );

  const handleFilePicker = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (idx: number) => {
    const next = draft.attachments.filter((_, i) => i !== idx);
    setAttachments(next);
  };

  // Inline image paste handler — appends a base64 markdown image to the body.
  const handleBodyPaste = async (e: ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        try {
          const data = await fileToBase64(file);
          const inline = `\n\n![pasted image](data:${file.type};base64,${data})\n\n`;
          updateDraft({ body: draft.body + inline });
        } catch {
          toast("Failed to read pasted image", "error");
        }
      }
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header / recipients */}
      <div className="space-y-1 border-b border-zinc-800 px-4 py-2 text-sm">
        <RecipientField
          label="To"
          value={draft.to}
          onChange={(v) => updateDraft({ to: v })}
          rightSlot={
            !showCcBcc ? (
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="text-xs text-muted hover:text-secondary"
              >
                Cc Bcc
              </button>
            ) : null
          }
        />
        {showCcBcc && (
          <>
            <RecipientField
              label="Cc"
              value={draft.cc}
              onChange={(v) => updateDraft({ cc: v })}
            />
            <RecipientField
              label="Bcc"
              value={draft.bcc}
              onChange={(v) => updateDraft({ bcc: v })}
            />
          </>
        )}
        <div className="flex items-center gap-2 py-1">
          <span className="w-12 shrink-0 text-xs text-muted">Subject</span>
          <input
            type="text"
            value={draft.subject}
            onChange={(e) => updateDraft({ subject: e.target.value })}
            placeholder="Subject"
            className="flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-muted"
          />
        </div>
      </div>

      {/* Body editor — fills the space between header and footer. The
          wrapper is a flex column so MarkdownEditor (in fill mode) can use
          flex-1 to stretch instead of relying on percentage heights. */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3"
        onPaste={handleBodyPaste}
      >
        <MarkdownEditor
          value={draft.body}
          onChange={(v) => updateDraft({ body: v })}
          placeholder="Write your email…"
          fill
        />
      </div>

      {/* Attachments */}
      {draft.attachments.length > 0 && (
        <div className="border-t border-zinc-800 px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {draft.attachments.map((att, idx) => (
              <AttachmentChip
                key={`${att.path}-${idx}`}
                attachment={att}
                onRemove={() => removeAttachment(idx)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-800 bg-surface-raised px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSend()}
            disabled={sending || draft.to.length === 0 || !draft.subject.trim()}
            className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !draftId}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-overlay hover:text-secondary disabled:opacity-50"
            title="Attach files"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFilePicker}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm("Discard this draft?")) {
              void discardDraft();
            }
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-red-900/20 hover:text-red-400"
          title="Discard draft"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Recipient chip input ─────────────────────────────────────────────

interface RecipientFieldProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  rightSlot?: React.ReactNode;
}

function RecipientField({
  label,
  value,
  onChange,
  rightSlot,
}: RecipientFieldProps) {
  const [draft, setDraftValue] = useState("");

  const commit = (raw: string) => {
    const parts = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      if (!next.includes(p)) next.push(p);
    }
    onChange(next);
    setDraftValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
      if (draft.trim()) {
        e.preventDefault();
        commit(draft);
      }
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-12 shrink-0 text-xs text-muted">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {value.map((addr, idx) => (
          <span
            key={`${addr}-${idx}`}
            className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-secondary"
          >
            {addr}
            <button
              type="button"
              onClick={() => removeAt(idx)}
              className="text-muted hover:text-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => draft.trim() && commit(draft)}
          placeholder={value.length === 0 ? "name@example.com" : ""}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-muted"
        />
      </div>
      {rightSlot}
    </div>
  );
}

// ─── Attachment chip ──────────────────────────────────────────────────

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: EmailDraftAttachment;
  onRemove: () => void;
}) {
  const sizeKb = Math.max(1, Math.round(attachment.size / 1024));
  return (
    <span className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-secondary">
      <Paperclip className="h-3 w-3 text-muted" />
      <span className="max-w-[180px] truncate">{attachment.fileName}</span>
      <span className="text-muted">{sizeKb} KB</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted hover:text-red-400"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
