"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useWorkspace } from "@/lib/workspace-context";
import type {
  EmailDraftAttachment,
  EmailPatch,
  InboxItem,
} from "@opcify/core";

export interface ComposeDraft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: EmailDraftAttachment[];
}

const EMPTY_DRAFT: ComposeDraft = {
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  body: "",
  attachments: [],
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface ComposeContextValue {
  workspaceId: string | null;
  isOpen: boolean;
  isMinimized: boolean;
  draft: ComposeDraft;
  draftId: string | null;
  saveStatus: SaveStatus;
  loading: boolean;
  openCompose: (existingDraftId?: string) => Promise<void>;
  closeCompose: () => void;
  discardDraft: () => Promise<void>;
  minimize: () => void;
  restore: () => void;
  updateDraft: (patch: Partial<ComposeDraft>) => void;
  applyAssistantPatch: (
    patch: EmailPatch,
    onSendRequested?: () => void,
  ) => void;
  setAttachments: (next: EmailDraftAttachment[]) => void;
  notifySent: () => void;
}

const ComposeContext = createContext<ComposeContextValue | null>(null);

function splitAddresses(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function inboxItemToDraft(item: InboxItem): ComposeDraft {
  let attachments: EmailDraftAttachment[] = [];
  if (item.attachmentsJson) {
    try {
      const parsed = JSON.parse(item.attachmentsJson);
      if (Array.isArray(parsed)) {
        attachments = parsed.filter(
          (x): x is EmailDraftAttachment =>
            !!x && typeof x === "object" && typeof x.path === "string",
        );
      }
    } catch {
      // ignore malformed
    }
  }
  return {
    to: splitAddresses(item.emailTo),
    cc: splitAddresses(item.emailCc),
    bcc: splitAddresses(item.emailBcc),
    subject: item.emailSubject || "",
    body: item.content || "",
    attachments,
  };
}

const AUTOSAVE_DELAY_MS = 800;

interface ComposeProviderProps {
  children: ReactNode;
  /** Called after a successful send so the inbox list can refetch. */
  onSent?: () => void;
  /** Called after autosave settles, so the Drafts tab can refetch. */
  onDraftPersisted?: () => void;
}

export function ComposeProvider({
  children,
  onSent,
  onDraftPersisted,
}: ComposeProviderProps) {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [draft, setDraft] = useState<ComposeDraft>(EMPTY_DRAFT);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [loading, setLoading] = useState(false);

  const draftRef = useRef(draft);
  const draftIdRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePending = useRef(false);
  const skipNextAutosave = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  const flushSave = useCallback(async () => {
    const id = draftIdRef.current;
    if (!id || !workspaceId) return;
    setSaveStatus("saving");
    try {
      await api.inbox.draftUpdate(workspaceId, id, {
        to: draftRef.current.to,
        cc: draftRef.current.cc,
        bcc: draftRef.current.bcc,
        subject: draftRef.current.subject,
        body: draftRef.current.body,
        attachments: draftRef.current.attachments,
      });
      setSaveStatus("saved");
      onDraftPersisted?.();
    } catch (err) {
      setSaveStatus("error");
      toast(
        err instanceof Error ? err.message : "Failed to save draft",
        "error",
      );
    }
  }, [workspaceId, toast, onDraftPersisted]);

  const scheduleSave = useCallback(() => {
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    if (!draftIdRef.current) return;
    savePending.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savePending.current = false;
      void flushSave();
    }, AUTOSAVE_DELAY_MS);
  }, [flushSave]);

  const updateDraft = useCallback(
    (patch: Partial<ComposeDraft>) => {
      setDraft((prev) => ({ ...prev, ...patch }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const setAttachments = useCallback(
    (next: EmailDraftAttachment[]) => {
      setDraft((prev) => ({ ...prev, attachments: next }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const openCompose = useCallback(
    async (existingDraftId?: string) => {
      if (!workspaceId) {
        toast("No workspace selected", "error");
        return;
      }
      setIsOpen(true);
      setIsMinimized(false);
      setLoading(true);
      try {
        if (existingDraftId) {
          const item = await api.inbox.get(workspaceId, existingDraftId);
          skipNextAutosave.current = true;
          setDraft(inboxItemToDraft(item));
          setDraftId(item.id);
          setSaveStatus("saved");
        } else {
          const created = await api.inbox.draftCreate(workspaceId, {});
          skipNextAutosave.current = true;
          setDraft(EMPTY_DRAFT);
          setDraftId(created.id);
          setSaveStatus("saved");
          onDraftPersisted?.();
        }
      } catch (err) {
        toast(
          err instanceof Error ? err.message : "Failed to open compose",
          "error",
        );
        setIsOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, toast, onDraftPersisted],
  );

  const closeCompose = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    // If the user opened Compose and closed it without typing anything, the
    // draft row would otherwise sit in the inbox forever as "Unknown / No
    // subject". Detect a totally-empty draft and silently delete it instead
    // of leaving it behind. Anything with even one filled field is preserved
    // in the Drafts folder as before.
    const d = draftRef.current;
    const isEmpty =
      d.to.length === 0 &&
      d.cc.length === 0 &&
      d.bcc.length === 0 &&
      !d.subject.trim() &&
      !d.body.trim() &&
      d.attachments.length === 0;
    const idToDelete = draftIdRef.current;
    if (isEmpty && idToDelete && workspaceId) {
      savePending.current = false;
      // Fire-and-forget — the user shouldn't wait for the cleanup to close
      // the window. We notify so the inbox list refetches and the row stops
      // appearing immediately.
      void api.inbox
        .draftDelete(workspaceId, idToDelete)
        .then(() => onDraftPersisted?.())
        .catch(() => {
          /* best effort */
        });
    } else if (savePending.current) {
      savePending.current = false;
      void flushSave();
    }

    setIsOpen(false);
    setIsMinimized(false);
    setDraftId(null);
    setDraft(EMPTY_DRAFT);
    setSaveStatus("idle");
  }, [flushSave, onDraftPersisted]);

  const discardDraft = useCallback(async () => {
    const id = draftIdRef.current;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    savePending.current = false;
    if (id && workspaceId) {
      try {
        await api.inbox.draftDelete(workspaceId, id);
        onDraftPersisted?.();
      } catch (err) {
        toast(
          err instanceof Error ? err.message : "Failed to discard draft",
          "error",
        );
      }
    }
    setIsOpen(false);
    setIsMinimized(false);
    setDraftId(null);
    setDraft(EMPTY_DRAFT);
    setSaveStatus("idle");
  }, [workspaceId, toast, onDraftPersisted]);

  const minimize = useCallback(() => setIsMinimized(true), []);
  const restore = useCallback(() => setIsMinimized(false), []);

  const applyAssistantPatch = useCallback(
    (patch: EmailPatch, onSendRequested?: () => void) => {
      setDraft((prev) => ({
        ...prev,
        ...(patch.to !== undefined ? { to: patch.to } : null),
        ...(patch.cc !== undefined ? { cc: patch.cc } : null),
        ...(patch.bcc !== undefined ? { bcc: patch.bcc } : null),
        ...(patch.subject !== undefined ? { subject: patch.subject } : null),
        ...(patch.body !== undefined ? { body: patch.body } : null),
      }));
      scheduleSave();
      if (patch.send) {
        // Defer so the patch state has a chance to apply.
        setTimeout(() => onSendRequested?.(), 50);
      }
    },
    [scheduleSave],
  );

  // Flush any pending autosave on unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (savePending.current) {
          void flushSave();
        }
      }
    };
  }, [flushSave]);

  const onSentRef = useRef(onSent);
  useEffect(() => {
    onSentRef.current = onSent;
  }, [onSent]);

  const notifySent = useCallback(() => {
    onSentRef.current?.();
  }, []);

  const value = useMemo<ComposeContextValue>(
    () => ({
      workspaceId,
      isOpen,
      isMinimized,
      draft,
      draftId,
      saveStatus,
      loading,
      openCompose,
      closeCompose,
      discardDraft,
      minimize,
      restore,
      updateDraft,
      applyAssistantPatch,
      setAttachments,
      notifySent,
    }),
    [
      workspaceId,
      isOpen,
      isMinimized,
      draft,
      draftId,
      saveStatus,
      loading,
      openCompose,
      closeCompose,
      discardDraft,
      minimize,
      restore,
      updateDraft,
      applyAssistantPatch,
      setAttachments,
      notifySent,
    ],
  );

  return (
    <ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>
  );
}

export function useCompose(): ComposeContextValue {
  const ctx = useContext(ComposeContext);
  if (!ctx) {
    throw new Error("useCompose must be used inside ComposeProvider");
  }
  return ctx;
}

