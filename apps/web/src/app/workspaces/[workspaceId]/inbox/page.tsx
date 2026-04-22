"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";
import { useApi } from "@/lib/use-api";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import { requestGmailAccess } from "@/lib/gmail-auth";
import { MarkdownEditor } from "@/components/markdown-editor";
import type { InboxItem, InboxActionInput } from "@opcify/core";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";
import {
  Search,
  Inbox,
  Mail,
  Clock,
  Link2Off,
  CheckCircle2,
  Archive,
  Send,
  ListTodo,
  Loader2,
  Trash2,
  Bot,
  X,
  Reply,
  Forward,
  PenSquare,
  MoreHorizontal,
} from "lucide-react";
import {
  ComposeProvider,
  useCompose,
} from "@/components/inbox/compose/compose-context";
import { ComposeWindow } from "@/components/inbox/compose/compose-window";

// ─── Subject cleanup ───────────────────────────────────────────────

function cleanSubject(
  subject: string | null | undefined,
  aiSummary?: string | null,
): string {
  if (!subject) return aiSummary?.slice(0, 60) || "No subject";
  // Strip all leading Re:/RE:/Fwd:/FW: prefixes (repeated)
  let cleaned = subject.replace(
    /^(\s*(Re|RE|Fwd|FW|Fw|re|fwd|fw)\s*:\s*)+/i,
    "",
  );
  cleaned = cleaned.trim();
  // If remaining subject is too short/generic, use AI summary
  if (cleaned.length < 4 && aiSummary) {
    return aiSummary.slice(0, 60);
  }
  return cleaned || aiSummary?.slice(0, 60) || "No subject";
}

// ─── Thread grouping ───────────────────────────────────────────────

interface EmailThread {
  threadId: string;
  items: InboxItem[];
  latestItem: InboxItem;
  cleanSubject: string;
  messageCount: number;
  hasUnread: boolean;
  participants: string[];
  highestUrgency: string | null;
}

const urgencyRank: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Strip Re:/Fwd: prefixes and lowercase for grouping key */
function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject
    .replace(/^(\s*(Re|RE|Fwd|FW|Fw|re|fwd|fw)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Extract a bare email address from a header field that may be in
 * "Display Name <email@domain>" form, or just "email@domain", or contain
 * extra whitespace. Returns null if no email-shaped token is found.
 */
function parseEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const candidate = angle ? angle[1] : raw;
  const trimmed = candidate.trim().toLowerCase();
  // Loose email regex — good enough to discriminate addresses inside a header.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return trimmed;
  return null;
}

/** Parse a comma-separated header field into a list of bare email addresses. */
function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseEmailAddress(s))
    .filter((s): s is string => !!s);
}

/**
 * Compute the candidate "thread keys" for an item. Two items belong to the
 * same thread if they share ANY key. Each item produces:
 *   - `tid:<emailThreadId>` when the Gmail watcher tagged it with a real
 *     conversation id.
 *   - `subj:<normalized_subject>::<other_party_email>` for every participant
 *     that isn't us. This is what bridges Gmail-watcher rows to compose rows
 *     (different `emailThreadId` values, but same subject + recipient).
 *
 * If an item has no usable keys (no thread id, no subject + other party), we
 * return its row id as a singleton key so it stays in its own group.
 */
function getThreadKeys(item: InboxItem, myEmail: string | null): string[] {
  const keys: string[] = [];
  if (item.emailThreadId) keys.push(`tid:${item.emailThreadId}`);

  const me = myEmail?.toLowerCase() || null;
  const fromAddr = parseEmailAddress(item.emailFrom);
  const toAddrs = parseEmailList(item.emailTo);

  const otherParties = new Set<string>();
  if (fromAddr && fromAddr !== me) otherParties.add(fromAddr);
  for (const addr of toAddrs) {
    if (addr !== me) otherParties.add(addr);
  }

  const normSubject = normalizeSubject(item.emailSubject);
  if (normSubject) {
    for (const p of otherParties) {
      keys.push(`subj:${normSubject}::${p}`);
    }
    // Sent-only outgoing rows (e.g. legacy compose with null emailFrom)
    // still need to merge with each other when there are no incoming
    // counterparts yet. The subj+otherParty keys above already cover this.
  }

  if (keys.length === 0) keys.push(`id:${item.id}`);
  return keys;
}

function groupIntoThreads(
  items: InboxItem[],
  myEmail: string | null,
): EmailThread[] {
  // Union-find over item indices: items that share any key get merged into
  // the same thread, regardless of iteration order. This is the only way
  // to robustly merge a Gmail-watcher row (which has a real emailThreadId)
  // with the compose-row sibling (which doesn't) when both share a subject
  // and recipient.
  const n = items.length;
  const parent = new Array<number>(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path compression
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const keyToFirstIdx = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const itemKeys = getThreadKeys(items[i], myEmail);
    for (const key of itemKeys) {
      const existing = keyToFirstIdx.get(key);
      if (existing !== undefined) {
        union(i, existing);
      } else {
        keyToFirstIdx.set(key, i);
      }
    }
  }

  // Bucket items by their union-find root.
  const groupsByRoot = new Map<number, InboxItem[]>();
  const groupKeyByRoot = new Map<number, string>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let bucket = groupsByRoot.get(root);
    if (!bucket) {
      bucket = [];
      groupsByRoot.set(root, bucket);
      // Pick a stable display id for the merged thread: prefer a real
      // Gmail thread id, otherwise the first item's row id.
      groupKeyByRoot.set(root, items[i].emailThreadId || items[i].id);
    }
    bucket.push(items[i]);
  }

  // Adapt to the existing downstream shape so the rest of this function
  // (sort/highlight/etc) is unchanged.
  const threadMap = new Map<string, InboxItem[]>();
  for (const [root, bucket] of groupsByRoot) {
    threadMap.set(groupKeyByRoot.get(root)!, bucket);
  }

  const threads: EmailThread[] = [];

  for (const [threadId, threadItems] of threadMap) {
    // Sort chronologically (oldest first)
    threadItems.sort(
      (a, b) =>
        new Date(a.emailDate || a.createdAt).getTime() -
        new Date(b.emailDate || b.createdAt).getTime(),
    );

    // Dedup placeholder + watcher copies of the same outgoing message.
    // The compose endpoint inserts a placeholder row immediately so the user
    // sees their sent mail without delay; the Sent-folder watcher then pushes
    // the same message later with a real Gmail Message-ID. The backend
    // upgrades the placeholder going forward, but rows already in the DB stay
    // duplicated until we drop them in the view layer here. Two rows are
    // duplicates iff they have the same trimmed body, the same normalized
    // subject, and were created within 5 minutes of each other.
    const deduped: InboxItem[] = [];
    for (const item of threadItems) {
      const itemSubject = normalizeSubject(item.emailSubject);
      const itemBody = (item.content || "").trim();
      const itemTime = new Date(item.emailDate || item.createdAt).getTime();
      const dupIndex = deduped.findIndex((other) => {
        if ((other.kind || "email") !== (item.kind || "email")) return false;
        if (normalizeSubject(other.emailSubject) !== itemSubject) return false;
        if ((other.content || "").trim() !== itemBody) return false;
        const otherTime = new Date(
          other.emailDate || other.createdAt,
        ).getTime();
        return Math.abs(otherTime - itemTime) <= 5 * 60 * 1000;
      });
      if (dupIndex === -1) {
        deduped.push(item);
        continue;
      }
      // Keep the row that has a real Gmail Message-ID; otherwise prefer the
      // older row (it's the one anchored in the chronological view).
      const incumbent = deduped[dupIndex];
      const itemHasId = !!item.emailMessageId;
      const incumbentHasId = !!incumbent.emailMessageId;
      if (itemHasId && !incumbentHasId) {
        deduped[dupIndex] = item;
      }
      // else: drop the new item; it's a duplicate of one we already kept.
    }
    threadItems.length = 0;
    threadItems.push(...deduped);

    const latestItem = threadItems[threadItems.length - 1];
    const hasUnread = threadItems.some(
      (i) => !i.emailIsRead && i.status !== "processed",
    );

    // Collect unique participants (both sides — sender AND recipient).
    // The card display picks the "other party" later using myEmail. We need
    // to include emailTo here so sent-only threads (e.g. a fresh outgoing
    // message that hasn't been replied to yet) still surface the recipient
    // instead of falling back to "Unknown".
    const participantSet = new Set<string>();
    for (const i of threadItems) {
      if (i.emailFrom) participantSet.add(i.emailFrom);
      if (i.emailTo) {
        for (const addr of i.emailTo.split(",")) {
          const trimmed = addr.trim();
          if (trimmed) participantSet.add(trimmed);
        }
      }
    }

    // Find highest urgency
    let highestUrgency: string | null = null;
    let highestRank = 99;
    for (const i of threadItems) {
      const rank = urgencyRank[i.aiUrgency ?? ""] ?? 99;
      if (rank < highestRank) {
        highestRank = rank;
        highestUrgency = i.aiUrgency;
      }
    }

    // Clean subject from the first item (original subject)
    const rawSubject =
      threadItems[0].emailSubject || latestItem.emailSubject;
    const summary = latestItem.aiSummary || threadItems[0].aiSummary;

    threads.push({
      threadId,
      items: threadItems,
      latestItem,
      cleanSubject: cleanSubject(rawSubject, summary),
      messageCount: threadItems.length,
      hasUnread,
      participants: Array.from(participantSet),
      highestUrgency,
    });
  }

  // Sort threads: by urgency first, then by latest message date (newest first)
  threads.sort((a, b) => {
    const ua = urgencyRank[a.highestUrgency ?? ""] ?? 99;
    const ub = urgencyRank[b.highestUrgency ?? ""] ?? 99;
    if (ua !== ub) return ua - ub;
    return (
      new Date(
        b.latestItem.emailDate || b.latestItem.createdAt,
      ).getTime() -
      new Date(
        a.latestItem.emailDate || a.latestItem.createdAt,
      ).getTime()
    );
  });

  return threads;
}

// ─── Urgency helpers ────────────────────────────────────────────────

const urgencyConfig: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  critical: {
    label: "Critical",
    color: "text-red-400",
    dot: "bg-red-400",
  },
  high: {
    label: "High",
    color: "text-orange-400",
    dot: "bg-orange-400",
  },
  medium: {
    label: "Medium",
    color: "text-yellow-400",
    dot: "bg-yellow-400",
  },
  low: {
    label: "Low",
    color: "text-zinc-400",
    dot: "bg-zinc-500",
  },
};

const statusTabs: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "inbox", label: "Inbox" },
  { value: "draft", label: "Drafts" },
  { value: "processed", label: "Processed" },
  { value: "archived", label: "Archived" },
];

// ─── Avatar helper ─────────────────────────────────────────────────

function SenderAvatar({
  email,
  size = "md",
}: {
  email: string;
  size?: "sm" | "md";
}) {
  const initial = email.charAt(0).toUpperCase();
  const colors = [
    "bg-blue-600",
    "bg-emerald-600",
    "bg-violet-600",
    "bg-orange-600",
    "bg-pink-600",
    "bg-cyan-600",
    "bg-amber-600",
    "bg-rose-600",
  ];
  // Deterministic color from email
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = colors[Math.abs(hash) % colors.length];
  const sizeClass =
    size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full ${color} ${sizeClass} font-medium text-white`}
    >
      {initial}
    </div>
  );
}

// ─── Quoted-history splitter ───────────────────────────────────────

/**
 * Split an email body into the fresh portion and the trailing quoted reply
 * history, so we can render the quoted part as a Gmail-style "..." toggle.
 *
 * Detection: walk lines from the top and find the first line that either
 *  (a) is an "On <date>… wrote:" header that's immediately followed by a
 *      `>`-prefixed line, or
 *  (b) is itself a `>`-prefixed line (no header).
 * Everything from that index onward is the quoted block.
 *
 * Returns `{ fresh, quoted: null }` when nothing looks quoted.
 */
function splitQuotedHistory(content: string | null | undefined): {
  fresh: string;
  quoted: string | null;
} {
  if (!content) return { fresh: content || "", quoted: null };

  const lines = content.split("\n");
  let splitIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // (a) "On <date>… wrote:" header followed by a `>`-prefixed line.
    if (/^On\s.+wrote:\s*$/.test(trimmed)) {
      let next = i + 1;
      while (next < lines.length && lines[next].trim() === "") next++;
      if (next < lines.length && lines[next].trimStart().startsWith(">")) {
        splitIdx = i;
        break;
      }
    }

    // (b) A `>`-prefixed line on its own.
    if (trimmed.startsWith(">")) {
      splitIdx = i;
      break;
    }
  }

  if (splitIdx === -1) return { fresh: content, quoted: null };

  // Trim trailing blank lines off the fresh portion so we don't render
  // an empty whitespace gap before the toggle.
  let endOfFresh = splitIdx;
  while (endOfFresh > 0 && lines[endOfFresh - 1].trim() === "") {
    endOfFresh--;
  }

  const fresh = lines.slice(0, endOfFresh).join("\n");
  const quoted = lines.slice(splitIdx).join("\n");
  return { fresh, quoted };
}

// ─── Sender name helper ────────────────────────────────────────────

function senderDisplayName(email: string): string {
  // "John Doe <john@example.com>" → "John Doe"
  const match = email.match(/^([^<]+)\s*</);
  if (match) return match[1].trim();
  // "john@example.com" → "john"
  return email.split("@")[0];
}

// ─── Main Inbox Page ────────────────────────────────────────────────

export default function InboxPage() {
  return (
    <InboxPageProviders>
      <InboxPageInner />
    </InboxPageProviders>
  );
}

function InboxPageProviders({ children }: { children: React.ReactNode }) {
  // ComposeProvider needs an onSent callback so the inbox list refetches
  // after a successful send. We bridge it via a tiny wrapper that pulls
  // the refetch handle from the inner page through a window event.
  return (
    <ComposeProvider
      onSent={() => window.dispatchEvent(new Event("opcify:inbox-refresh"))}
      onDraftPersisted={() =>
        window.dispatchEvent(new Event("opcify:inbox-refresh"))
      }
    >
      {children}
      <ComposeWindow />
    </ComposeProvider>
  );
}

function InboxPageInner() {
  const compose = useCompose();
  const { workspaceId } = useWorkspace();
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  // Gmail connection status
  const {
    data: gmailStatus,
    loading: gmailLoading,
    refetch: refetchGmail,
  } = useApi(() => api.gmail.status(workspaceId), [workspaceId]);
  const [gmailConnecting, setGmailConnecting] = useState(false);

  const [selectedThreadId, setSelectedThreadId] = useState<
    string | null
  >(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState("");
  const [showConvertTask, setShowConvertTask] = useState(false);
  const [showDelegateMenu, setShowDelegateMenu] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Bulk-clean any empty draft rows the user accumulated before we added
  // the auto-discard path. Fires once on mount per workspace; the endpoint
  // is idempotent so re-renders are harmless.
  const cleanupRan = useRef(false);
  useEffect(() => {
    if (cleanupRan.current) return;
    if (!workspaceId) return;
    cleanupRan.current = true;
    api.inbox
      .cleanupEmptyDrafts(workspaceId)
      .catch(() => {
        /* best effort — silent */
      });
  }, [workspaceId]);

  // Fetch inbox items
  const {
    data: items,
    loading: itemsLoading,
    refetch: refetchItems,
  } = useApi(
    () =>
      api.inbox.list({
        workspaceId,
        status: statusFilter || undefined,
        urgency: urgencyFilter || undefined,
        q: search || undefined,
      }),
    [workspaceId, statusFilter, urgencyFilter, search],
  );

  // Fetch stats for header
  const { data: stats, refetch: refetchStats } = useApi(
    () => api.inbox.stats(workspaceId),
    [workspaceId],
  );

  // Fetch agents for delegate/convert
  const { data: agents } = useApi(
    () => api.agents.list(workspaceId),
    [workspaceId],
  );

  // Find the assistant agent (role: "assistant") for email actions
  const assistantAgent = agents?.find(
    (a: { role?: string }) => a.role === "assistant",
  );
  const emailAgentId = assistantAgent?.id || agents?.[0]?.id;

  // Fetch clients for linking
  const { data: clients } = useApi(
    () => api.clients.list({ workspaceId }),
    [workspaceId],
  );

  // The user's email address for determining "me" vs "them"
  const myEmail = gmailStatus?.email || null;

  // Group items into threads — pass myEmail so the grouping helper can pick
  // the "other party" for each item and avoid keying by ourselves.
  const threads = useMemo(
    () => (items ? groupIntoThreads(items, myEmail) : []),
    [items, myEmail],
  );

  // Auto-refresh inbox every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetchItems();
      refetchStats();
    }, 5000);
    return () => clearInterval(interval);
  }, [refetchItems, refetchStats]);

  // Selected thread
  const selectedThread =
    threads.find((t) => t.threadId === selectedThreadId) ?? null;

  // Auto-select first thread
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (!didAutoSelect.current && threads.length > 0) {
      didAutoSelect.current = true;
      setSelectedThreadId(threads[0].threadId);
    }
  }, [threads]);

  // Reset selection when filters change
  useEffect(() => {
    didAutoSelect.current = false;
    setSelectedThreadId(null);
  }, [statusFilter, urgencyFilter, search]);

  const refreshAll = useCallback(() => {
    refetchItems();
    refetchStats();
  }, [refetchItems, refetchStats]);

  // Listen for compose-triggered refresh events.
  useEffect(() => {
    const handler = () => refreshAll();
    window.addEventListener("opcify:inbox-refresh", handler);
    return () => window.removeEventListener("opcify:inbox-refresh", handler);
  }, [refreshAll]);

  // ─── Actions ────────────────────────────────────────────────────

  async function handleAction(itemId: string, input: InboxActionInput) {
    setActionLoading(true);
    try {
      const result = await api.inbox.action(workspaceId, itemId, input);
      if (result.ok) {
        toast(
          `Action "${input.action}" completed` +
            (result.resultId ? ` — Task created` : ""),
          "success",
        );
        refreshAll();
        setShowConvertTask(false);
        setShowDelegateMenu(false);
      }
    } catch (e: unknown) {
      toast(
        `Action failed: ${e instanceof Error ? e.message : "Unknown error"}`,
        "error",
      );
    } finally {
      setActionLoading(false);
    }
  }

  // ─── Gmail connect ───────────────────────────────────────────────

  async function handleConnectGmail() {
    setGmailConnecting(true);
    try {
      const code = await requestGmailAccess();
      const result = (await api.gmail.connect({
        code,
        workspaceId,
      })) as {
        connected: boolean;
        email: string;
        verified?: boolean;
        verificationOutput?: string;
      };
      if (result.verified) {
        toast(`Connected & verified: ${result.email}`, "success");
      } else {
        toast(
          `Connected ${result.email} but verification failed: ${result.verificationOutput?.slice(0, 100) || "unknown"}`,
          "error",
        );
      }
      refetchGmail();
    } catch (e: unknown) {
      toast(
        `Gmail connection failed: ${e instanceof Error ? e.message : "Unknown error"}`,
        "error",
      );
    } finally {
      setGmailConnecting(false);
    }
  }

  async function handleDisconnectGmail() {
    try {
      await api.gmail.disconnect(workspaceId);
      toast("Gmail disconnected", "success");
      refetchGmail();
    } catch {
      toast("Disconnect failed", "error");
    }
  }

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-muted px-6 py-3">
        <div className="flex items-center gap-3">
          <Inbox className="h-5 w-5 text-emerald-400" />
          <h1 className="text-lg font-semibold text-primary">Inbox</h1>
          {stats && stats.inbox > 0 && (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
              {stats.inbox}
            </span>
          )}
          {stats && stats.critical > 0 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
              {stats.critical} critical
            </span>
          )}
          {gmailStatus?.email && (
            <span className="flex items-center gap-1.5 rounded-full bg-surface-overlay px-2.5 py-0.5 text-xs text-secondary">
              <Mail className="h-3 w-3" />
              {gmailStatus.email}
              <button
                onClick={handleDisconnectGmail}
                className="ml-1 text-tertiary hover:text-red-400"
                title="Disconnect Gmail"
              >
                <Link2Off className="h-3 w-3" />
              </button>
            </span>
          )}
          {!gmailLoading && gmailStatus && !gmailStatus.connected && (
            <button
              onClick={handleConnectGmail}
              disabled={gmailConnecting}
              className="flex items-center gap-1.5 rounded-full bg-surface-overlay px-2.5 py-1 text-xs text-secondary transition-colors hover:bg-emerald-600 hover:text-white"
            >
              {gmailConnecting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Mail className="h-3 w-3" />
              )}
              Connect Gmail
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => compose.openCompose()}
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            title="Compose new email"
          >
            <PenSquare className="h-4 w-4" />
            Compose
          </button>
          <UserProfileDropdown />
        </div>
      </div>

      {/* Gmail token expired warning */}
      {(gmailStatus as { expired?: boolean })?.expired && (
        <div className="flex items-center justify-between border-b border-red-500/20 bg-red-500/5 px-6 py-2">
          <span className="text-sm text-red-400">
            Gmail connection expired. Please reconnect to resume email
            monitoring.
          </span>
          <button
            onClick={handleConnectGmail}
            disabled={gmailConnecting}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
          >
            {gmailConnecting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Mail className="h-3 w-3" />
            )}
            Reconnect
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — thread list */}
        <div className="flex w-80 flex-col border-r border-border-muted lg:w-96">
          {/* Filters */}
          <div className="space-y-2 border-b border-border-muted p-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-tertiary" />
              <input
                type="text"
                placeholder="Search emails..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-border-muted bg-surface py-2 pl-8 pr-3 text-sm text-primary placeholder:text-tertiary focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {/* Status tabs */}
            <div className="flex gap-1">
              {statusTabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    statusFilter === tab.value
                      ? "bg-surface-overlay text-primary"
                      : "text-tertiary hover:text-secondary"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Urgency filter pills */}
            <div className="flex gap-1">
              {(
                ["critical", "high", "medium", "low"] as const
              ).map((u) => (
                <button
                  key={u}
                  onClick={() =>
                    setUrgencyFilter(urgencyFilter === u ? "" : u)
                  }
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                    urgencyFilter === u
                      ? "bg-surface-overlay text-primary"
                      : "text-tertiary hover:text-secondary"
                  }`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${urgencyConfig[u].dot}`}
                  />
                  {urgencyConfig[u].label}
                </button>
              ))}
            </div>
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto">
            {itemsLoading && !items ? (
              <div className="flex items-center justify-center py-12 text-tertiary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-tertiary">
                <Inbox className="mb-2 h-8 w-8" />
                <p className="text-sm">No items</p>
              </div>
            ) : (
              threads.map((thread) => {
                const isDraft = thread.latestItem.status === "draft";
                return (
                  <ThreadCard
                    key={thread.threadId}
                    thread={thread}
                    myEmail={myEmail}
                    isActive={thread.threadId === selectedThreadId}
                    onClick={() => {
                      if (isDraft) {
                        void compose.openCompose(thread.latestItem.id);
                      } else {
                        setSelectedThreadId(thread.threadId);
                      }
                    }}
                    onArchive={async () => {
                      try {
                        if (isDraft) {
                          // Drafts can't be archived through the action
                          // pipeline (status="draft" isn't a real archive
                          // target). Discard the row instead — same hover
                          // affordance, different endpoint.
                          await api.inbox.draftDelete(
                            workspaceId,
                            thread.latestItem.id,
                          );
                          toast("Draft discarded", "success");
                        } else {
                          await api.inbox.batch(workspaceId, {
                            ids: thread.items.map((i) => i.id),
                            action: "archive",
                          });
                          toast("Conversation archived", "success");
                        }
                        if (thread.threadId === selectedThreadId) {
                          setSelectedThreadId(null);
                        }
                        refreshAll();
                      } catch (e) {
                        toast(
                          e instanceof Error
                            ? e.message
                            : isDraft
                              ? "Failed to discard draft"
                              : "Failed to archive",
                          "error",
                        );
                      }
                    }}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Right panel — thread detail */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedThread ? (
            <ThreadDetail
              key={selectedThread.threadId}
              thread={selectedThread}
              myEmail={myEmail}
              userName={authUser?.name || null}
              agents={agents ?? []}
              emailAgentId={emailAgentId}
              clients={clients ?? []}
              showConvertTask={showConvertTask}
              setShowConvertTask={setShowConvertTask}
              showDelegateMenu={showDelegateMenu}
              setShowDelegateMenu={setShowDelegateMenu}
              actionLoading={actionLoading}
              onAction={(input, itemId) =>
                handleAction(
                  itemId || selectedThread.latestItem.id,
                  input,
                )
              }
              onDelete={async () => {
                try {
                  // Delete all items in the thread
                  for (const item of selectedThread.items) {
                    await api.inbox.delete(workspaceId, item.id);
                  }
                  setSelectedThreadId(null);
                  refreshAll();
                  toast("Thread deleted", "success");
                } catch {
                  toast("Delete failed", "error");
                }
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-tertiary">
              <div className="text-center">
                <Mail className="mx-auto mb-2 h-8 w-8" />
                <p className="text-sm">
                  Select a conversation to view
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Thread Card (Left Panel) ──────────────────────────────────────

function ThreadCard({
  thread,
  myEmail,
  isActive,
  onClick,
  onArchive,
}: {
  thread: EmailThread;
  myEmail: string | null;
  isActive: boolean;
  onClick: () => void;
  onArchive: () => void | Promise<void>;
}) {
  const urg =
    urgencyConfig[thread.highestUrgency ?? ""] ?? urgencyConfig.low;
  const latest = thread.latestItem;

  // Pick the "other party" — the first participant that isn't us. For a
  // sent-only thread (we just composed an email and there's no reply yet)
  // this surfaces the recipient instead of falling back to "Unknown" or
  // showing the user's own avatar.
  const me = myEmail?.toLowerCase() || null;
  const otherParty = thread.participants.find(
    (p) => !me || !p.toLowerCase().includes(me),
  );
  const isSentOnly = thread.items.every(
    (i) => !i.emailFrom || (me && i.emailFrom.toLowerCase().includes(me)),
  );
  const primarySender = otherParty || thread.participants[0] || "Unknown";
  const senderLabel = isSentOnly && otherParty
    ? `To: ${senderDisplayName(otherParty)}`
    : senderDisplayName(primarySender);

  // The hover button shows on every row except already-archived ones (where
  // archiving would be a no-op). For drafts the action becomes "discard
  // draft" — same icon and position, the parent component routes the click
  // to api.inbox.draftDelete instead of the batch archive endpoint.
  const isDraft = latest.status === "draft";
  const isAlreadyArchived =
    latest.status === "processed" && latest.actionTaken === "archived";
  const showArchiveButton = !isAlreadyArchived;
  const archiveLabel = isDraft ? "Discard draft" : "Archive conversation";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group relative w-full cursor-pointer border-b border-border-muted px-4 py-3 text-left transition-colors focus:outline-none focus-visible:bg-surface-overlay/70 ${
        isActive
          ? "bg-surface-overlay"
          : "hover:bg-surface-overlay/50"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <SenderAvatar email={primarySender} size="sm" />

        <div className="min-w-0 flex-1">
          {/* Sender + count + time */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 truncate">
              <span
                className={`truncate text-sm ${
                  thread.hasUnread
                    ? "font-semibold text-primary"
                    : "text-secondary"
                }`}
              >
                {senderLabel}
              </span>
              {thread.messageCount > 1 && (
                <span className="shrink-0 text-xs text-tertiary">
                  ({thread.messageCount})
                </span>
              )}
              {/* Urgency dot */}
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${urg.dot}`}
              />
            </div>
            <span className="shrink-0 text-xs text-tertiary">
              {timeAgo(latest.emailDate || latest.createdAt)}
            </span>
          </div>

          {/* Thread subject */}
          <p
            className={`mt-0.5 truncate text-sm ${
              thread.hasUnread
                ? "font-medium text-secondary"
                : "text-tertiary"
            }`}
          >
            {thread.cleanSubject}
          </p>

          {/* Preview */}
          <p className="mt-0.5 truncate text-xs text-tertiary">
            {latest.aiSummary || latest.content.slice(0, 100)}
          </p>

          {/* Tags */}
          <div className="mt-1.5 flex items-center gap-1.5">
            {latest.aiSuggestedAction && (
              <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-medium text-secondary">
                {latest.aiSuggestedAction.replace(/_/g, " ")}
              </span>
            )}
            {latest.status === "snoozed" && (
              <span className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                <Clock className="h-2.5 w-2.5" />
                Snoozed
              </span>
            )}
            {latest.actionTaken && (
              <span className="flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                <CheckCircle2 className="h-2.5 w-2.5" />
                {latest.actionTaken}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Hover-only archive button — Gmail-style. Stops propagation so it
          doesn't trigger the row's onClick (which would open the thread or
          the compose window for drafts). For drafts the parent's onArchive
          actually calls draftDelete; the icon stays the same so the row UI
          is consistent across status types. */}
      {showArchiveButton && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void onArchive();
          }}
          className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-md bg-surface-raised text-muted shadow-sm transition-colors hover:bg-emerald-600 hover:text-white group-hover:flex focus-visible:flex"
          title={archiveLabel}
          aria-label={archiveLabel}
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Message body with foldable quoted history ────────────────────

function MessageContent({
  content,
  isMe,
}: {
  content: string;
  isMe: boolean;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { fresh, quoted } = useMemo(
    () => splitQuotedHistory(content),
    [content],
  );

  return (
    <div className="text-sm leading-relaxed text-primary">
      {fresh && (
        <div className="whitespace-pre-wrap break-words">{fresh}</div>
      )}
      {quoted && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowQuoted((s) => !s);
            }}
            className={`mt-2 inline-flex h-5 items-center justify-center rounded px-1.5 transition-colors ${
              isMe
                ? "bg-emerald-700/40 text-emerald-300/80 hover:bg-emerald-700/60"
                : "bg-zinc-700/60 text-tertiary hover:bg-zinc-700"
            }`}
            title={showQuoted ? "Hide quoted text" : "Show quoted text"}
            aria-label={showQuoted ? "Hide quoted text" : "Show quoted text"}
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
          {showQuoted && (
            <div
              className={`mt-2 whitespace-pre-wrap break-words border-l-2 pl-3 text-xs ${
                isMe
                  ? "border-emerald-500/30 text-emerald-100/60"
                  : "border-zinc-700 text-tertiary"
              }`}
            >
              {quoted}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────

function MessageBubble({
  item,
  isMe,
  userName,
  threadSubject,
}: {
  item: InboxItem;
  isMe: boolean;
  userName: string | null;
  threadSubject: string;
}) {
  const sender = item.emailFrom || "Unknown";
  const time = timeAgo(item.emailDate || item.createdAt);

  // Show original subject inside the bubble if it differs from the thread title
  const rawSubject = item.emailSubject || "";
  const cleanedItemSubject = cleanSubject(rawSubject);
  const showSubjectInContent =
    rawSubject &&
    cleanedItemSubject.toLowerCase() !== threadSubject.toLowerCase();

  if (isMe) {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[75%]">
          {/* Header */}
          <div className="mb-1 flex items-center justify-end gap-2">
            <span className="text-xs text-tertiary">{time}</span>
            <span className="text-xs font-medium text-emerald-400">
              {userName || "You"}
            </span>
          </div>
          {/* Bubble */}
          <div className="rounded-2xl rounded-tr-sm bg-emerald-600/15 px-4 py-3">
            {showSubjectInContent && (
              <div className="mb-1.5 text-xs text-emerald-400/70">
                Re: {cleanedItemSubject}
              </div>
            )}
            <MessageContent content={item.content} isMe />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <SenderAvatar email={sender} />
      <div className="max-w-[75%]">
        {/* Header */}
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-medium text-secondary">
            {senderDisplayName(sender)}
          </span>
          <span className="text-xs text-tertiary">{time}</span>
        </div>
        {/* Bubble */}
        <div className="rounded-2xl rounded-tl-sm bg-surface-overlay px-4 py-3">
          {showSubjectInContent && (
            <div className="mb-1.5 text-xs text-tertiary">
              Re: {cleanedItemSubject}
            </div>
          )}
          <MessageContent content={item.content} isMe={false} />
        </div>
      </div>
    </div>
  );
}

// ─── Thread Detail (Right Panel) ───────────────────────────────────

function ThreadDetail({
  thread,
  myEmail,
  userName,
  agents,
  emailAgentId,
  clients: _clients,
  showConvertTask,
  setShowConvertTask,
  showDelegateMenu,
  setShowDelegateMenu,
  actionLoading,
  onAction,
  onDelete,
}: {
  thread: EmailThread;
  myEmail: string | null;
  userName: string | null;
  agents: { id: string; name: string }[];
  emailAgentId: string | undefined;
  clients: { id: string; name: string }[];
  showConvertTask: boolean;
  setShowConvertTask: (v: boolean) => void;
  showDelegateMenu: boolean;
  setShowDelegateMenu: (v: boolean) => void;
  actionLoading: boolean;
  onAction: (input: InboxActionInput, itemId?: string) => void;
  onDelete: () => void;
}) {
  const latestItem = thread.latestItem;
  const [taskTitle, setTaskTitle] = useState(
    thread.cleanSubject || latestItem.content.slice(0, 60),
  );
  const [taskAgentId, setTaskAgentId] = useState("");
  const [userDraft, setUserDraft] = useState("");
  const [appliedAiDraft, setAppliedAiDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  // Infer "me" email: use connected Gmail, or fall back to emailTo on received messages
  let resolvedMyEmail: string | null = null;
  if (myEmail) {
    resolvedMyEmail = myEmail.toLowerCase();
  } else {
    for (const item of thread.items) {
      if (item.emailTo) {
        resolvedMyEmail = item.emailTo.toLowerCase();
        break;
      }
    }
  }

  function isFromMe(item: InboxItem): boolean {
    // Outgoing items composed inside Opcify may have no emailFrom set
    // (legacy compose rows created before the backend started populating
    // the sender). Treat any email row that has a recipient but no sender
    // as outgoing — there's no other plausible interpretation: the Gmail
    // watcher always sets emailFrom on real incoming mail.
    if (item.kind === "email" && !item.emailFrom && item.emailTo) return true;
    if (!resolvedMyEmail || !item.emailFrom) return false;
    return item.emailFrom.toLowerCase().includes(resolvedMyEmail);
  }

  // Find the last message from the OTHER person (for replying)
  const replyToItem = (() => {
    for (let i = thread.items.length - 1; i >= 0; i--) {
      if (!isFromMe(thread.items[i])) return thread.items[i];
    }
    return latestItem;
  })();

  const replyToName = replyToItem.emailFrom
    ? senderDisplayName(replyToItem.emailFrom)
    : "sender";

  // Show AI draft if user hasn't typed anything, or show user's own text
  const aiDraft = replyToItem.aiDraftReply || "";
  const isNewAiDraft = aiDraft && aiDraft !== appliedAiDraft;
  const editedDraft = isNewAiDraft ? aiDraft : userDraft;
  const setEditedDraft = (val: string) => {
    if (isNewAiDraft) setAppliedAiDraft(aiDraft);
    setUserDraft(val);
  };

  // Auto-scroll to bottom when thread loads or new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread.threadId, thread.items.length]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Thread header */}
      <div className="border-b border-border-muted px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-primary">
              {thread.cleanSubject}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-secondary">
              {thread.participants.map((p) => (
                <span
                  key={p}
                  className="flex items-center gap-1.5"
                >
                  <SenderAvatar email={p} size="sm" />
                  <span className="text-xs">
                    {senderDisplayName(p)}
                  </span>
                </span>
              ))}
              {thread.messageCount > 1 && (
                <span className="text-xs text-tertiary">
                  {thread.messageCount} messages
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-tertiary">
              {timeAgo(
                latestItem.emailDate || latestItem.createdAt,
              )}
              {latestItem.aiUrgency && (
                <span
                  className={`ml-2 ${urgencyConfig[latestItem.aiUrgency]?.color ?? ""}`}
                >
                  {urgencyConfig[latestItem.aiUrgency]?.label ??
                    latestItem.aiUrgency}{" "}
                  urgency
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-tertiary transition-colors hover:bg-surface-overlay hover:text-red-400"
            title="Delete thread"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Conversation area */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
      >
        {/* AI Summary card (for the thread) */}
        {latestItem.aiSummary && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Bot className="h-3.5 w-3.5" />
              AI Summary
            </div>
            <p className="text-sm text-secondary">
              {latestItem.aiSummary}
            </p>
          </div>
        )}

        {/* Message bubbles */}
        {thread.items.map((item) => (
          <MessageBubble
            key={item.id}
            item={item}
            isMe={isFromMe(item)}
            userName={userName}
            threadSubject={thread.cleanSubject}
          />
        ))}

        {/* Convert to task form */}
        {showConvertTask && (
          <div className="rounded-lg border border-border-muted bg-surface-raised p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-secondary">
                Convert to Task
              </span>
              <button
                onClick={() => setShowConvertTask(false)}
                className="text-tertiary hover:text-secondary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Task title"
                className="w-full rounded-md border border-border-muted bg-surface px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-emerald-500 focus:outline-none"
              />
              <select
                value={taskAgentId}
                onChange={(e) => setTaskAgentId(e.target.value)}
                className="w-full rounded-md border border-border-muted bg-surface px-3 py-2 text-sm text-primary focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Select agent...</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  onAction({
                    action: "convert_task",
                    taskTitle,
                    taskAgentId,
                  })
                }
                disabled={
                  actionLoading || !taskTitle.trim() || !taskAgentId
                }
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                {actionLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ListTodo className="h-3.5 w-3.5" />
                )}
                Create Task
              </button>
            </div>
          </div>
        )}

        {/* Delegate to agent */}
        {showDelegateMenu && (
          <div className="rounded-lg border border-border-muted bg-surface-raised p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-secondary">
                Delegate to Agent
              </span>
              <button
                onClick={() => setShowDelegateMenu(false)}
                className="text-tertiary hover:text-secondary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() =>
                    onAction({
                      action: "delegate",
                      agentId: agent.id,
                    })
                  }
                  disabled={actionLoading}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-primary"
                >
                  <Bot className="h-3.5 w-3.5 text-emerald-400" />
                  {agent.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Reply editor — always visible */}
      <div className="border-t border-border-muted">
          {/* Reply input */}
          <div className="px-6 pt-3">
            <div className="mb-1.5 flex items-center gap-2 text-xs text-tertiary">
              <Reply className="h-3 w-3" />
              <span>Reply to {replyToName}</span>
              {editedDraft && (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                  AI Draft
                </span>
              )}
            </div>
            <div
              className="overflow-auto rounded-lg border border-border-muted bg-surface-raised"
              style={{ maxHeight: 320 }}
            >
              <MarkdownEditor
                value={editedDraft}
                onChange={setEditedDraft}
                placeholder="Write your reply..."
                height={Math.max(
                  100,
                  Math.min(
                    300,
                    editedDraft.split("\n").length * 24 + 24,
                  ),
                )}
                compact
              />
            </div>
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2 px-6 py-3">
            <button
              onClick={() => {
                if (editedDraft.trim()) {
                  onAction(
                    {
                      action: "reply",
                      replyContent: editedDraft,
                      agentId: emailAgentId,
                    },
                    replyToItem.id,
                  );
                  setUserDraft("");
                  setAppliedAiDraft(aiDraft);
                }
              }}
              disabled={
                actionLoading ||
                !editedDraft.trim() ||
                !emailAgentId
              }
              className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {actionLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send Reply
            </button>

            <div className="h-4 w-px bg-border-muted" />

            <button
              onClick={() =>
                onAction({
                  action: "forward",
                  agentId: emailAgentId,
                })
              }
              disabled={actionLoading}
              className="flex items-center gap-1.5 rounded-md border border-border-muted px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-primary"
            >
              <Forward className="h-3.5 w-3.5" />
              Forward
            </button>

            <button
              onClick={() => {
                setShowDelegateMenu(true);
                setShowConvertTask(false);
              }}
              className="flex items-center gap-1.5 rounded-md border border-border-muted px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-primary"
            >
              <Bot className="h-3.5 w-3.5" />
              Delegate
            </button>

            <button
              onClick={() => {
                setShowConvertTask(true);
                setShowDelegateMenu(false);
              }}
              className="flex items-center gap-1.5 rounded-md border border-border-muted px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-primary"
            >
              <ListTodo className="h-3.5 w-3.5" />
              Convert to Task
            </button>

            <button
              onClick={() =>
                onAction({
                  action: "snooze",
                  snoozeUntil: new Date(
                    Date.now() + 24 * 60 * 60 * 1000,
                  ).toISOString(),
                })
              }
              disabled={actionLoading}
              className="flex items-center gap-1.5 rounded-md border border-border-muted px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-primary"
            >
              <Clock className="h-3.5 w-3.5" />
              Snooze
            </button>

            <button
              onClick={() => onAction({ action: "archive" })}
              disabled={actionLoading}
              className="flex items-center gap-1.5 rounded-md border border-border-muted px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-primary"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive
            </button>
          </div>
        </div>
    </div>
  );
}
