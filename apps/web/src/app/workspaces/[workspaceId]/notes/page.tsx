"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { useApi } from "@/lib/use-api";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { MarkdownEditor } from "@/components/markdown-editor";
import { timeAgo, formatDate } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import {
  Search,
  Plus,
  CalendarDays,
  FileText,
  Link2,
  ArrowUpRight,
  ArrowLeft,
  ListTodo,
  Clock,
  ChevronDown,
  Archive,
  Users,
  Loader2,
  Check,
} from "lucide-react";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";

// ─── Note templates ─────────────────────────────────────────────────

const TEMPLATE_OPTIONS = [
  { key: "brainstorm", label: "Brainstorm" },
  { key: "client_notes", label: "Client Notes" },
  { key: "sop_draft", label: "SOP Draft" },
  { key: "content_idea", label: "Content Idea" },
  { key: "quotation_draft", label: "Quotation Draft" },
];

// ─── Wiki link regex ────────────────────────────────────────────────

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

function parseOutgoingLinks(md: string): string[] {
  const links: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(WIKI_LINK_RE.source, "g");
  while ((m = re.exec(md)) !== null) {
    links.push(m[1].trim());
  }
  return [...new Set(links)];
}

// ─── Main Notes Page ────────────────────────────────────────────────

export default function NotesPage() {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();

  // State
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "idle">("idle");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [showConvertTask, setShowConvertTask] = useState(false);

  const [syncedNoteId, setSyncedNoteId] = useState<string | null>(null);

  // Refs for autosave
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTitleRef = useRef("");
  const lastSavedContentRef = useRef("");

  // Fetch notes list
  const {
    data: notes,
    loading: notesLoading,
    refetch: refetchNotes,
  } = useApi(
    () => api.notes.list(workspaceId, { q: search || undefined }),
    [workspaceId, search],
  );

  // Fetch selected note detail
  const {
    data: noteDetail,
    loading: noteDetailLoading,
    refetch: refetchDetail,
  } = useApi(
    () =>
      selectedNoteId
        ? api.notes.get(workspaceId, selectedNoteId)
        : Promise.resolve(null),
    [workspaceId, selectedNoteId],
  );

  // Fetch clients for link-to-client
  const { data: clients } = useApi(
    () => api.clients.list({ workspaceId }),
    [workspaceId],
  );

  // Fetch agents for task creation
  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);

  // Auto-select first note on initial load only
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (!didAutoSelect.current && notes && notes.length > 0) {
      didAutoSelect.current = true;
      setSelectedNoteId(notes[0].id);
    }
  }, [notes]);

  // Sync editor state when note detail loads (only on note switch)
  useEffect(() => {
    if (noteDetail && syncedNoteId !== noteDetail.id) {
      setSyncedNoteId(noteDetail.id);
      setEditTitle(noteDetail.title);
      setEditContent(noteDetail.contentMarkdown);
      lastSavedTitleRef.current = noteDetail.title;
      lastSavedContentRef.current = noteDetail.contentMarkdown;
      setSaveState("saved");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteDetail?.id]);

  // Autosave with debounce
  const triggerAutosave = useCallback(
    (title: string, content: string) => {
      if (!selectedNoteId) return;
      if (
        title === lastSavedTitleRef.current &&
        content === lastSavedContentRef.current
      ) {
        return;
      }

      setSaveState("saving");

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(async () => {
        try {
          await api.notes.update(workspaceId, selectedNoteId, {
            title: title || undefined,
            contentMarkdown: content,
          });
          lastSavedTitleRef.current = title;
          lastSavedContentRef.current = content;
          setSaveState("saved");
          refetchNotes();
        } catch {
          setSaveState("idle");
        }
      }, 800);
    },
    [workspaceId, selectedNoteId, refetchNotes],
  );

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function handleTitleChange(title: string) {
    setEditTitle(title);
    triggerAutosave(title, editContent);
  }

  function handleContentChange(content: string) {
    setEditContent(content);
    triggerAutosave(editTitle, content);
  }

  // Create new note
  async function handleCreateNote() {
    try {
      const note = await api.notes.create(workspaceId, {
        title: "Untitled",
      });
      await refetchNotes();
      setSelectedNoteId(note.id);
    } catch {
      toast("Failed to create note", "error");
    }
  }

  // Create note from template
  async function handleCreateFromTemplate(templateKey: string) {
    setShowTemplateMenu(false);
    try {
      const note = await api.notes.createFromTemplate(workspaceId, templateKey);
      await refetchNotes();
      setSelectedNoteId(note.id);
    } catch {
      toast("Failed to create note from template", "error");
    }
  }

  // Daily note
  async function handleDailyNote() {
    try {
      const note = await api.notes.daily(workspaceId);
      await refetchNotes();
      setSelectedNoteId(note.id);
    } catch {
      toast("Failed to open daily note", "error");
    }
  }

  // Archive note
  async function handleArchive() {
    if (!selectedNoteId) return;
    try {
      await api.notes.update(workspaceId, selectedNoteId, { isArchived: true });
      setSelectedNoteId(null);
      refetchNotes();
      toast("Note archived");
    } catch {
      toast("Failed to archive note", "error");
    }
  }

  // Link to client
  async function handleLinkClient(clientId: string | null) {
    if (!selectedNoteId) return;
    try {
      await api.notes.update(workspaceId, selectedNoteId, { clientId });
      refetchDetail();
      toast(clientId ? "Linked to client" : "Client removed");
    } catch {
      toast("Failed to update client link", "error");
    }
  }

  // Wiki link click handler
  function handleWikiLinkClick(linkTitle: string) {
    if (!notes) return;
    const target = notes.find(
      (n) => n.title.toLowerCase() === linkTitle.toLowerCase(),
    );
    if (target) {
      setSelectedNoteId(target.id);
    } else {
      // Quick-create a new note with that title
      api.notes
        .create(workspaceId, { title: linkTitle })
        .then(async (note) => {
          await refetchNotes();
          setSelectedNoteId(note.id);
        })
        .catch(() => toast("Failed to create linked note", "error"));
    }
  }

  // Convert to task
  async function handleConvertToTask(agentId: string) {
    setShowConvertTask(false);
    try {
      await api.tasks.create(workspaceId, {
        title: editTitle,
        description: editContent,
        agentId,
      });
      toast("Task created from note");
    } catch {
      toast("Failed to create task", "error");
    }
  }

  // Parsed outgoing links for preview rendering
  const outgoingLinks = useMemo(
    () => parseOutgoingLinks(editContent),
    [editContent],
  );

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex h-[calc(100vh-108px)] md:h-[calc(100vh-52px)]">
        {/* ─── Left Sidebar: Notes Explorer ─── */}
        <div className={`flex w-full md:w-64 shrink-0 flex-col border-r border-border-muted bg-surface ${selectedNoteId ? "hidden md:flex" : "flex"}`}>
          {/* Search */}
          <div className="border-b border-border-muted p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes…"
                className="w-full rounded-md border border-border-muted bg-surface-raised py-2 pl-8 pr-3 text-xs text-primary placeholder-muted outline-none focus:border-zinc-600"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 border-b border-border-muted p-2">
            <button
              onClick={handleCreateNote}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
            <button
              onClick={handleDailyNote}
              className="flex items-center gap-1.5 rounded-md border border-border-muted px-2 py-1.5 text-xs text-secondary transition-colors hover:bg-surface-overlay"
              title="Today's Note"
            >
              <CalendarDays className="h-3.5 w-3.5" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowTemplateMenu((v) => !v)}
                className="flex items-center gap-1 rounded-md border border-border-muted px-2 py-1.5 text-xs text-secondary transition-colors hover:bg-surface-overlay"
                title="From Template"
              >
                <FileText className="h-3.5 w-3.5" />
                <ChevronDown className="h-3 w-3" />
              </button>
              {showTemplateMenu && (
                <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-lg border border-border-muted bg-surface-raised shadow-xl">
                  <div className="py-1">
                    {TEMPLATE_OPTIONS.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => handleCreateFromTemplate(t.key)}
                        className="flex w-full items-center px-3 py-2 text-xs text-secondary hover:bg-surface-overlay"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Notes list */}
          <div className="flex-1 overflow-y-auto">
            {notesLoading && !notes ? (
              <div className="flex items-center justify-center py-12 text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : !notes?.length ? (
              <div className="px-4 py-12 text-center">
                <FileText className="mx-auto h-8 w-8 text-muted/40" />
                <p className="mt-3 text-sm font-medium text-secondary">
                  No notes yet
                </p>
                <p className="mt-1 text-xs text-muted">
                  Capture ideas, brainstorm in Markdown, and turn thoughts into
                  action.
                </p>
                <button
                  onClick={handleCreateNote}
                  className="mt-4 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  New Note
                </button>
              </div>
            ) : (
              <div className="py-1">
                {notes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => setSelectedNoteId(note.id)}
                    className={`w-full px-3 py-2.5 text-left transition-colors ${
                      selectedNoteId === note.id
                        ? "bg-surface-overlay"
                        : "hover:bg-surface-overlay/50"
                    }`}
                  >
                    <p
                      className={`text-sm font-medium truncate ${
                        selectedNoteId === note.id
                          ? "text-primary"
                          : "text-secondary"
                      }`}
                    >
                      {note.title || "Untitled"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted truncate">
                      {note.contentMarkdown
                        ? note.contentMarkdown.slice(0, 60).replace(/[#*\n]/g, " ").trim()
                        : "Empty note"}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted">
                      {timeAgo(note.updatedAt)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Center: Editor + Context ─── */}
        <div className={`flex-1 flex-col bg-surface min-w-0 ${selectedNoteId ? "flex" : "hidden md:flex"}`}>
          {selectedNoteId && noteDetail ? (
            <>
              {/* Title + save indicator + back button (mobile) */}
              <div className="flex items-center gap-2 border-b border-border-muted px-3 py-3 md:px-6">
                <button
                  onClick={() => setSelectedNoteId(null)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-overlay hover:text-secondary md:hidden"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="Note title…"
                  className="flex-1 bg-transparent text-lg font-semibold text-primary placeholder-muted outline-none"
                />
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  {saveState === "saving" && (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving…
                    </>
                  )}
                  {saveState === "saved" && (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      Saved
                    </>
                  )}
                </span>
                <div className="hidden md:block"><UserProfileDropdown /></div>
              </div>

              {/* Scrollable area: editor + context panel on small screens */}
              <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* Editor column — lg+ fills via flex, <lg scrolls with min-h floor */}
                <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-3 py-4 md:px-6 lg:overflow-hidden">
                  <div className="flex min-h-[480px] flex-1 flex-col lg:min-h-0">
                    <MarkdownEditor
                      value={editContent}
                      onChange={handleContentChange}
                      placeholder="Start writing… Use [[Note Name]] to link notes."
                      fill
                    />
                  </div>

                  {/* Linked context — inline on small screens */}
                  <div className="mt-6 shrink-0 lg:hidden">
                    <NoteContext
                      noteDetail={noteDetail}
                      outgoingLinks={outgoingLinks}
                      onWikiLinkClick={handleWikiLinkClick}
                      onSelectNote={setSelectedNoteId}
                      onArchive={handleArchive}
                      onConvertToTask={handleConvertToTask}
                      onLinkClient={handleLinkClient}
                      showConvertTask={showConvertTask}
                      onToggleConvertTask={() => setShowConvertTask((v) => !v)}
                      agents={agents}
                      clients={clients}
                    />
                  </div>
                </div>

                {/* Right sidebar — large screens only */}
                <div className="hidden w-64 shrink-0 flex-col border-l border-border-muted lg:flex overflow-y-auto">
                  <NoteContext
                    noteDetail={noteDetail}
                    outgoingLinks={outgoingLinks}
                    onWikiLinkClick={handleWikiLinkClick}
                    onSelectNote={setSelectedNoteId}
                    onArchive={handleArchive}
                    onConvertToTask={handleConvertToTask}
                    onLinkClient={handleLinkClient}
                    showConvertTask={showConvertTask}
                    onToggleConvertTask={() => setShowConvertTask((v) => !v)}
                    agents={agents}
                    clients={clients}
                  />
                </div>
              </div>
            </>
          ) : noteDetailLoading && selectedNoteId ? (
            <div className="flex flex-1 items-center justify-center text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            // Empty state — no note selected
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <FileText className="h-12 w-12 text-muted/30" />
              <p className="mt-4 text-lg font-medium text-secondary">
                {notes?.length ? "Select a note" : "No notes yet"}
              </p>
              <p className="mt-1 text-sm text-muted">
                {notes?.length
                  ? "Pick a note from the sidebar to start editing."
                  : "Capture ideas, brainstorm in Markdown, and turn thoughts into action."}
              </p>
              {!notes?.length && (
                <button
                  onClick={handleCreateNote}
                  className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                >
                  New Note
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Note Context Panel (shared between sidebar and inline) ─────────

function NoteContext({
  noteDetail,
  outgoingLinks,
  onWikiLinkClick,
  onSelectNote,
  onArchive,
  onConvertToTask,
  onLinkClient,
  showConvertTask,
  onToggleConvertTask,
  agents,
  clients,
}: {
  noteDetail: { id: string; createdAt: string; updatedAt: string; clientId?: string | null; client?: { name: string } | null; backlinks?: { id: string; title: string }[] };
  outgoingLinks: string[];
  onWikiLinkClick: (title: string) => void;
  onSelectNote: (id: string) => void;
  onArchive: () => void;
  onConvertToTask: (agentId: string) => void;
  onLinkClient: (clientId: string | null) => void;
  showConvertTask: boolean;
  onToggleConvertTask: () => void;
  agents?: { id: string; name: string }[] | null;
  clients?: { id: string; name: string }[] | null;
}) {
  const timezone = useTimezone();

  return (
    <div className="space-y-5 p-4">
      {/* Outgoing Links */}
      <section>
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <ArrowUpRight className="h-3 w-3" />
          Outgoing Links
        </h3>
        {outgoingLinks.length > 0 ? (
          <div className="mt-2 space-y-1">
            {outgoingLinks.map((link) => (
              <button
                key={link}
                onClick={() => onWikiLinkClick(link)}
                className="block w-full truncate rounded px-2 py-1 text-left text-xs text-sky-400 transition-colors hover:bg-surface-overlay"
              >
                {link}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted">
            No outgoing links. Use [[Note Name]] to link.
          </p>
        )}
      </section>

      {/* Backlinks */}
      <section>
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <Link2 className="h-3 w-3" />
          Backlinks
        </h3>
        {noteDetail.backlinks && noteDetail.backlinks.length > 0 ? (
          <div className="mt-2 space-y-1">
            {noteDetail.backlinks.map((bl) => (
              <button
                key={bl.id}
                onClick={() => onSelectNote(bl.id)}
                className="block w-full truncate rounded px-2 py-1 text-left text-xs text-sky-400 transition-colors hover:bg-surface-overlay"
              >
                {bl.title}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted">
            No backlinks yet.
          </p>
        )}
      </section>

      {/* Metadata */}
      <section>
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <Clock className="h-3 w-3" />
          Metadata
        </h3>
        <div className="mt-2 space-y-1 text-[11px] text-muted">
          <p>Created: {formatDate(noteDetail.createdAt, timezone)}</p>
          <p>Updated: {timeAgo(noteDetail.updatedAt)}</p>
          {noteDetail.client && (
            <p className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {noteDetail.client.name}
            </p>
          )}
        </div>
      </section>

      {/* Actions */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Actions
        </h3>
        <div className="mt-2 space-y-1.5">
          {/* Convert to Task */}
          <div className="relative">
            <button
              onClick={onToggleConvertTask}
              className="flex w-full items-center gap-2 rounded-md border border-border-muted px-3 py-2 text-xs text-secondary transition-colors hover:bg-surface-overlay"
            >
              <ListTodo className="h-3.5 w-3.5" />
              Convert to Task
            </button>
            {showConvertTask && agents && (
              <div className="absolute left-0 top-full z-30 mt-1 w-full rounded-lg border border-border-muted bg-surface-raised shadow-xl">
                <div className="p-2">
                  <p className="mb-1.5 text-[10px] text-muted">Select agent:</p>
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => onConvertToTask(agent.id)}
                      className="flex w-full items-center px-2 py-1.5 text-xs text-secondary hover:bg-surface-overlay rounded"
                    >
                      {agent.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Archive */}
          <button
            onClick={onArchive}
            className="flex w-full items-center gap-2 rounded-md border border-border-muted px-3 py-2 text-xs text-secondary transition-colors hover:bg-surface-overlay"
          >
            <Archive className="h-3.5 w-3.5" />
            Archive Note
          </button>

          {/* Link to Client */}
          {clients && clients.length > 0 && (
            <div>
              <select
                value={noteDetail.clientId || ""}
                onChange={(e) => onLinkClient(e.target.value || null)}
                className="w-full rounded-md border border-border-muted bg-surface-raised px-3 py-2 text-xs text-secondary outline-none focus:border-zinc-600"
              >
                <option value="">Link to Client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
