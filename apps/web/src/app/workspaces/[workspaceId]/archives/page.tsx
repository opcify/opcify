"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { useChat } from "@/lib/use-chat";
import { ChatView } from "@/components/chat/chat-view";
import { api } from "@/lib/api";
import type { ArchiveItem } from "@/lib/api";
import type { AgentSummary } from "@opcify/core";
import {
  Folder,
  FileText,
  Upload,
  Download,
  Trash2,
  FolderPlus,
  ChevronRight,
  Home,
  MoreHorizontal,
  Pencil,
  Loader2,
  Share2,
  MessageSquare,
  X,
  Cloud,
  HardDrive,
  RefreshCw,
  Eye,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type PreviewType = "text" | "image" | "pdf" | "office" | null;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "xml", "yaml", "yml",
  "html", "htm", "css", "js", "ts", "tsx", "jsx", "py", "rb",
  "sh", "bash", "zsh", "fish", "sql", "env", "toml", "ini", "cfg",
  "conf", "log", "gitignore", "dockerfile", "makefile", "rs", "go",
  "java", "c", "cpp", "h", "hpp", "swift", "kt", "lua", "r",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const OFFICE_EXTENSIONS = new Set(["docx", "xlsx", "pptx", "doc", "xls", "ppt"]);

function getPreviewType(name: string): PreviewType {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (OFFICE_EXTENSIONS.has(ext)) return "office";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  // Files without extension or unknown — try text preview
  if (!ext || !name.includes(".")) return "text";
  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ArchivesPage() {
  const { workspaceId } = useWorkspace();
  const [currentPath, setCurrentPath] = useState("");
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ item: ArchiveItem; x: number; y: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(true); // open by default
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Resizable chat panel width (persisted to localStorage) ─────
  const CHAT_WIDTH_KEY = `archives-chat-width-${workspaceId}`;
  const DEFAULT_CHAT_WIDTH = 384; // 24rem
  const MIN_CHAT_WIDTH = 280;
  const MAX_CHAT_WIDTH_RATIO = 0.6; // never more than 60% of viewport

  const [chatWidth, setChatWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_CHAT_WIDTH;
    try {
      const saved = localStorage.getItem(CHAT_WIDTH_KEY);
      if (saved) return Math.max(MIN_CHAT_WIDTH, parseInt(saved, 10));
    } catch { /* localStorage may be unavailable */ }
    return DEFAULT_CHAT_WIDTH;
  });
  const resizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = chatWidth;

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      // Dragging left = making chat wider (resize handle is on the left edge of chat)
      const delta = resizeStartX.current - ev.clientX;
      const maxW = window.innerWidth * MAX_CHAT_WIDTH_RATIO;
      const newW = Math.min(maxW, Math.max(MIN_CHAT_WIDTH, resizeStartW.current + delta));
      setChatWidth(newW);
    };

    const onUp = () => {
      resizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist
      setChatWidth((w) => {
        try { localStorage.setItem(CHAT_WIDTH_KEY, String(Math.round(w))); } catch { /* noop */ }
        return w;
      });
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [chatWidth, CHAT_WIDTH_KEY]);

  // ── Archives Director agent lookup ─────────────────────────────
  const [archivesAgentId, setArchivesAgentId] = useState<string | null>(null);
  useEffect(() => {
    api.agents.list(workspaceId).then((agents: AgentSummary[]) => {
      const ad = agents.find(
        (a) =>
          a.name.toLowerCase().includes("archives") &&
          a.status !== "disabled",
      );
      if (ad) setArchivesAgentId(ad.id);
    }).catch(() => {});
  }, [workspaceId]);

  // ── Chat with Archives Director ────────────────────────────────
  const chat = useChat(workspaceId, archivesAgentId);

  // Auto-send bootstrap message on first-ever visit (persisted per workspace)
  const bootstrapKey = `archives-bootstrap-${workspaceId}`;
  const bootstrapSent = useRef(false);
  useEffect(() => {
    if (
      archivesAgentId &&
      !chat.loading &&
      !chat.streaming &&
      chat.messages.length === 0 &&
      !bootstrapSent.current &&
      !localStorage.getItem(bootstrapKey)
    ) {
      bootstrapSent.current = true;
      localStorage.setItem(bootstrapKey, "1");
      chat.send(
        "Setup the cloud storage if a cloud storage skill is installed and has env configured in openclaw.json. Then list the top-level files and folders from cloud storage (do not recurse into subfolders). If cloud storage is already set up, just list the top-level contents.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrapSent.current gates re-entry; destructured chat fields are intentionally omitted to avoid infinite loops
  }, [archivesAgentId, chat.loading, chat.streaming, chat.messages.length, chat.send, bootstrapKey]);

  // Show a welcome message while bootstrap is running
  const chatMessages = useMemo(() => {
    if (bootstrapSent.current && chat.messages.length <= 1 && chat.streaming) {
      const welcome = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Hi boss! I'm setting up your cloud storage and fetching your files. This only happens once — please hang tight!" }],
        timestamp: Date.now(),
      };
      return chat.messages.length === 0 ? [welcome] : [chat.messages[0], welcome];
    }
    return chat.messages;
  }, [chat.messages, chat.streaming]);

  // Fetch items
  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.archives.list(workspaceId, currentPath);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load archives");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, currentPath]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Refresh file list after bootstrap message completes
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (chat.streaming) {
      wasStreaming.current = true;
    } else if (wasStreaming.current && bootstrapSent.current) {
      wasStreaming.current = false;
      fetchItems();
    }
  }, [chat.streaming, fetchItems]);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  // Breadcrumb segments
  const pathSegments = currentPath
    .split("/")
    .filter(Boolean)
    .map((seg, i, arr) => ({
      label: seg,
      path: arr.slice(0, i + 1).join("/"),
    }));

  // Navigation
  const navigateTo = (path: string) => {
    setCurrentPath(path);
    setContextMenu(null);
  };

  // Upload handler
  const handleUpload = async (fileList: FileList) => {
    if (fileList.length === 0) return;
    setUploading(true);
    try {
      const files = await Promise.all(
        Array.from(fileList).map(async (f) => ({
          fileName: f.name,
          data: await fileToBase64(f),
        })),
      );
      await api.archives.upload(workspaceId, currentPath, files);
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  // Create folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const path = currentPath ? `${currentPath}/${newFolderName.trim()}` : newFolderName.trim();
      await api.archives.createFolder(workspaceId, path);
      setNewFolderName("");
      setCreatingFolder(false);
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  };

  // Delete
  const handleDelete = async (item: ArchiveItem) => {
    if (!confirm(`Delete "${item.name}"${item.type === "folder" ? " and all its contents" : ""}?`)) return;
    try {
      await api.archives.delete(workspaceId, item.path);
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // Rename
  const handleRename = async (item: ArchiveItem) => {
    const newName = prompt(`Rename "${item.name}" to:`, item.name);
    if (!newName || newName === item.name) return;
    try {
      // Build the new path: same parent folder, new name
      const parts = item.path.split("/");
      parts[parts.length - 1] = newName;
      const newPath = parts.join("/");
      await api.archives.move(workspaceId, item.path, newPath);
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  };

  // Sync to cloud
  const [syncing, setSyncing] = useState<string | null>(null); // path being synced
  const handleSync = async (item: ArchiveItem) => {
    setSyncing(item.path);
    try {
      const result = await api.archives.sync(workspaceId, item.path);
      await fetchItems();
      alert(`Synced ${result.synced} file${result.synced !== 1 ? "s" : ""} to cloud storage.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  };

  // Share — generate a signed URL
  const [sharing, setSharing] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const handleShare = async (item: ArchiveItem) => {
    setSharing(item.path);
    setShareUrl(null);
    try {
      const result = await api.archives.share(workspaceId, item.path);
      setShareUrl(result.url);
      // Auto-copy to clipboard
      try {
        await navigator.clipboard.writeText(result.url);
      } catch { /* clipboard may not be available */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Share failed");
    } finally {
      setSharing(null);
    }
  };

  // Preview
  const [previewItem, setPreviewItem] = useState<ArchiveItem | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handlePreview = async (item: ArchiveItem) => {
    const type = getPreviewType(item.name);
    if (!type) return;
    setPreviewItem(item);
    setPreviewContent(null);

    if (type === "text") {
      setPreviewLoading(true);
      try {
        const url = api.archives.previewUrl(workspaceId, item.path);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${(await import("@/lib/auth")).getToken()}` },
        });
        if (res.ok) {
          const text = await res.text();
          setPreviewContent(text);
        } else {
          setPreviewContent(`Failed to load file (HTTP ${res.status})`);
        }
      } catch (err) {
        setPreviewContent(`Error: ${err instanceof Error ? err.message : "unknown"}`);
      } finally {
        setPreviewLoading(false);
      }
    }
    if (type === "office") {
      // Office files need a public URL for the Microsoft viewer
      setPreviewLoading(true);
      try {
        const result = await api.archives.share(workspaceId, item.path);
        setPreviewContent(result.url);
      } catch (err) {
        setPreviewContent(`Error: ${err instanceof Error ? err.message : "Cloud storage required for Office preview"}`);
      } finally {
        setPreviewLoading(false);
      }
    }
    // For image and pdf, we use the preview URL directly in <img> / <iframe>
  };

  // Download
  const handleDownload = (item: ArchiveItem) => {
    const url = api.archives.downloadUrl(workspaceId, item.path);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name;
    a.click();
  };

  return (
    <div className="flex h-screen overflow-hidden px-4 py-4 md:px-6">
      {/* Main file browser */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-primary">Files</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                chatOpen
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                  : "border-border-muted text-secondary hover:text-primary hover:border-zinc-500"
              }`}
            >
              <MessageSquare size={14} />
              <span className="hidden sm:inline">AI Assistant</span>
            </button>
            <button
              onClick={() => setCreatingFolder(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border-muted rounded-md text-secondary hover:text-primary hover:border-zinc-500 transition-colors"
            >
              <FolderPlus size={14} />
              <span className="hidden sm:inline">New Folder</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              <span className="hidden sm:inline">{uploading ? "Uploading..." : "Upload"}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleUpload(e.target.files)}
            />
          </div>
        </div>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-secondary mb-4 flex-wrap">
          <button
            onClick={() => navigateTo("")}
            className="flex items-center gap-1 hover:text-primary transition-colors"
          >
            <Home size={14} />
            <span>Files</span>
          </button>
          {pathSegments.map((seg) => (
            <span key={seg.path} className="flex items-center gap-1">
              <ChevronRight size={12} className="text-muted" />
              <button
                onClick={() => navigateTo(seg.path)}
                className="hover:text-primary transition-colors"
              >
                {seg.label}
              </button>
            </span>
          ))}
        </nav>

        {/* Create folder inline */}
        {creatingFolder && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-surface-raised rounded-lg border border-border-muted">
            <Folder size={16} className="text-blue-400" />
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") setCreatingFolder(false);
              }}
              placeholder="Folder name..."
              className="flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-muted"
            />
            <button
              onClick={handleCreateFolder}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500"
            >
              Create
            </button>
            <button
              onClick={() => setCreatingFolder(false)}
              className="px-2 py-1 text-xs text-secondary hover:text-primary"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">
              dismiss
            </button>
          </div>
        )}

        {/* Drop zone + file table */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-lg border transition-colors ${
            dragOver ? "border-blue-500 bg-blue-500/5" : "border-border-muted"
          }`}
        >
          {loading ? (
            <div className="flex items-center justify-center py-20 text-secondary">
              <Loader2 size={20} className="animate-spin mr-2" />
              Loading...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-secondary">
              <FileText size={40} className="mb-3 text-muted" />
              <p className="text-sm">No files yet</p>
              <p className="text-xs text-muted mt-1">
                Upload files or let your AI agents produce deliverables
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-500"
              >
                Upload Files
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border-muted">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Size</th>
                  <th className="px-4 py-2.5 font-medium hidden md:table-cell">Modified</th>
                  <th className="px-4 py-2.5 font-medium hidden lg:table-cell w-20">Source</th>
                  <th className="px-4 py-2.5 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.path}
                    className="border-b border-border-muted last:border-0 hover:bg-surface-raised/50 transition-colors group"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ item, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <td className="px-4 py-2.5">
                      {item.type === "folder" ? (
                        <button
                          onClick={() => navigateTo(item.path)}
                          className="flex items-center gap-2 text-primary hover:text-blue-400 transition-colors"
                        >
                          <Folder size={16} className="text-blue-400 shrink-0" />
                          <span className="truncate">{item.name}</span>
                        </button>
                      ) : getPreviewType(item.name) ? (
                        <button
                          onClick={() => handlePreview(item)}
                          className="flex items-center gap-2 text-primary hover:text-blue-400 transition-colors"
                        >
                          <FileText size={16} className="text-zinc-400 shrink-0" />
                          <span className="truncate">{item.name}</span>
                        </button>
                      ) : (
                        <span className="flex items-center gap-2 text-primary">
                          <FileText size={16} className="text-zinc-400 shrink-0" />
                          <span className="truncate">{item.name}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-secondary hidden sm:table-cell">
                      {formatSize(item.size)}
                    </td>
                    <td className="px-4 py-2.5 text-secondary hidden md:table-cell">
                      {formatDate(item.mtime)}
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      {item.source === "cloud" && (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-400" title="Cloud only">
                          <Cloud size={12} /> cloud
                        </span>
                      )}
                      {item.source === "local" && (
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-500" title="Local only">
                          <HardDrive size={12} /> local
                        </span>
                      )}
                      {item.source === "synced" && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400" title="Synced (local + cloud)">
                          <Cloud size={12} /> synced
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setContextMenu({ item, x: e.clientX, y: e.clientY });
                        }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-700/50 transition-all"
                      >
                        <MoreHorizontal size={14} className="text-secondary" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Drag overlay text */}
          {dragOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 rounded-lg pointer-events-none">
              <p className="text-blue-400 text-sm font-medium">Drop files here to upload</p>
            </div>
          )}
        </div>

        {/* Context menu */}
        {contextMenu && (
          <div
            className="fixed z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.item.type === "file" && getPreviewType(contextMenu.item.name) && (
              <button
                onClick={() => {
                  handlePreview(contextMenu.item);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-primary hover:bg-zinc-700/50"
              >
                <Eye size={14} /> Preview
              </button>
            )}
            {contextMenu.item.type === "file" && (
              <button
                onClick={() => {
                  handleDownload(contextMenu.item);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-primary hover:bg-zinc-700/50"
              >
                <Download size={14} /> Download
              </button>
            )}
            {contextMenu.item.type === "file" && (
              <button
                onClick={() => {
                  handleShare(contextMenu.item);
                  setContextMenu(null);
                }}
                disabled={sharing === contextMenu.item.path}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-primary hover:bg-zinc-700/50 disabled:opacity-50"
              >
                {sharing === contextMenu.item.path ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Share2 size={14} />
                )}
                Share
              </button>
            )}
            {contextMenu.item.source !== "cloud" && (
              <button
                onClick={() => {
                  handleSync(contextMenu.item);
                  setContextMenu(null);
                }}
                disabled={syncing === contextMenu.item.path}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-primary hover:bg-zinc-700/50 disabled:opacity-50"
              >
                {syncing === contextMenu.item.path ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Sync to Cloud
              </button>
            )}
            <button
              onClick={() => {
                handleRename(contextMenu.item);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-primary hover:bg-zinc-700/50"
            >
              <Pencil size={14} /> Rename
            </button>
            <button
              onClick={() => {
                handleDelete(contextMenu.item);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-zinc-700/50"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Share URL modal */}
      {shareUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setShareUrl(null)}>
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl p-5 w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                <Share2 size={16} className="text-blue-400" />
                Shareable Link
              </h3>
              <button onClick={() => setShareUrl(null)} className="text-muted hover:text-primary">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-secondary mb-3">This link expires in 7 days. Anyone with the link can download the file.</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono text-xs select-all focus:outline-none focus:border-blue-500"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl);
                  } catch { /* noop */ }
                }}
                className="shrink-0 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-500 transition-colors"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-emerald-400 mt-2">Link copied to clipboard</p>
          </div>
        </div>
      )}

      {/* File preview modal */}
      {previewItem && (() => {
        const type = getPreviewType(previewItem.name);
        const previewUrl = api.archives.previewUrl(workspaceId, previewItem.path);
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setPreviewItem(null)}>
            <div
              className="bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl flex flex-col w-full max-w-4xl mx-4"
              style={{ maxHeight: "90vh" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
                <h3 className="text-sm font-semibold text-primary flex items-center gap-2 truncate">
                  <Eye size={16} className="text-blue-400 shrink-0" />
                  <span className="truncate">{previewItem.name}</span>
                </h3>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { handleDownload(previewItem); }}
                    className="px-2.5 py-1 text-xs bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 transition-colors"
                  >
                    Download
                  </button>
                  <button onClick={() => setPreviewItem(null)} className="text-muted hover:text-primary">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-auto min-h-0">
                {type === "text" && (
                  previewLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 size={20} className="animate-spin text-muted" />
                    </div>
                  ) : (
                    <pre className="p-4 text-sm text-zinc-300 font-mono whitespace-pre-wrap break-words leading-relaxed">
                      {previewContent}
                    </pre>
                  )
                )}
                {type === "image" && (
                  <div className="flex items-center justify-center p-4 bg-zinc-900/50">
                    <img
                      src={previewUrl}
                      alt={previewItem.name}
                      className="max-w-full max-h-[75vh] object-contain rounded"
                    />
                  </div>
                )}
                {type === "pdf" && (
                  <iframe
                    src={previewUrl}
                    className="w-full border-0"
                    style={{ height: "80vh" }}
                    title={previewItem.name}
                  />
                )}
                {type === "office" && (
                  previewLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 size={20} className="animate-spin text-muted mr-2" />
                      <span className="text-sm text-muted">Preparing Office preview...</span>
                    </div>
                  ) : previewContent?.startsWith("Error:") ? (
                    <div className="flex items-center justify-center py-20 text-sm text-red-400">
                      {previewContent}
                    </div>
                  ) : previewContent ? (
                    <iframe
                      src={`https://docs.google.com/gview?url=${encodeURIComponent(previewContent)}&embedded=true`}
                      className="w-full border-0"
                      style={{ height: "80vh" }}
                      title={previewItem.name}
                    />
                  ) : null
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Side chat panel — Archives Director (resizable, open by default, full height) */}
      {chatOpen && (
        <>
          {/* Resize handle */}
          <div
            onMouseDown={handleResizeStart}
            className="hidden lg:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-blue-500/20 active:bg-blue-500/30 transition-colors group"
            title="Drag to resize"
          >
            <div className="w-0.5 h-8 rounded-full bg-zinc-700 group-hover:bg-blue-500 transition-colors" />
          </div>
          <div
            className="shrink-0 border-l border-border-muted hidden lg:flex flex-col h-full overflow-hidden"
            style={{ width: chatWidth }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted">
            <h3 className="text-sm font-medium text-primary flex items-center gap-1.5">
              <MessageSquare size={14} />
              Archives Director
            </h3>
            <button onClick={() => setChatOpen(false)} className="text-muted hover:text-primary">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {archivesAgentId ? (
              <ChatView
                workspaceId={workspaceId}
                messages={chatMessages}
                streaming={chat.streaming}
                streamText={chat.streamText}
                streamThinking={chat.streamThinking}
                connected={chat.connected}
                loading={chat.loading}
                error={chat.error}
                onSend={chat.send}
                onAbort={chat.abort}
                onReset={chat.resetSession}
                agentName="Archives Director"
                compact
              />
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">
                <div>
                  <MessageSquare size={24} className="mx-auto mb-2 opacity-40" />
                  <p>Archives Director agent not found.</p>
                  <p className="mt-1 text-xs">Provision a workspace with the Archives Director agent to enable chat.</p>
                </div>
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
