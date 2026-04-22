"use client";

import { useState, useRef, useCallback, useMemo, useEffect, type KeyboardEvent } from "react";
import type { ChatAttachment } from "@opcify/core";
import {
  ArrowUp, Square, Paperclip, X,
  Terminal, Eye, EyeOff, CircleStop, RotateCcw,
  Plus, Sparkles, Trash2, HelpCircle, Wrench,
  Activity, Info, MessageSquare, Settings,
  Zap, Brain, Gauge, Volume2, User,
  Cpu, List, RefreshCw, LayoutGrid,
} from "lucide-react";

interface ChatInputProps {
  onSend: (message: string, attachments?: ChatAttachment[]) => void;
  onAbort: () => void;
  onReset?: () => void;
  streaming: boolean;
  disabled?: boolean;
}

// ─── Slash commands ─────────────────────────────────────────────────

interface SlashCommand {
  name: string;
  args?: string;
  description: string;
  icon: React.ElementType;
  category: string;
  instant?: boolean;
  action: "send" | "stop" | "reset" | "new" | "clear";
}

const SLASH_COMMANDS: SlashCommand[] = [
  // Session
  { name: "/session", args: "[action] [value]", description: "Manage session-level settings.", icon: Terminal, category: "session", action: "send" },
  { name: "/stop", description: "Stop the current run.", icon: CircleStop, category: "session", instant: true, action: "stop" },
  { name: "/reset", description: "Reset the current session.", icon: RotateCcw, category: "session", instant: true, action: "reset" },
  { name: "/new", args: "[instructions]", description: "Start a new session.", icon: Plus, category: "session", instant: true, action: "new" },
  { name: "/compact", args: "[instructions]", description: "Compact the session context.", icon: Sparkles, category: "session", action: "send" },
  { name: "/clear", description: "Clear chat history.", icon: Trash2, category: "session", instant: true, action: "clear" },
  // Status
  { name: "/help", description: "Show available commands.", icon: HelpCircle, category: "status", action: "send" },
  { name: "/status", description: "Show current status.", icon: Activity, category: "status", action: "send" },
  { name: "/tools", args: "[compact|verbose]", description: "List available runtime tools.", icon: Wrench, category: "status", action: "send" },
  { name: "/context", description: "Explain how context is built and used.", icon: Info, category: "status", action: "send" },
  { name: "/whoami", description: "Show your sender id.", icon: User, category: "status", action: "send" },
  { name: "/usage", args: "[off|tokens|full|cost]", description: "Usage footer or cost summary.", icon: Gauge, category: "status", action: "send" },
  { name: "/export", args: "[path]", description: "Export session to HTML file.", icon: ArrowUp, category: "status", action: "send" },
  // Tools
  { name: "/skill", args: "<name>", description: "Run a skill by name.", icon: Zap, category: "tools", action: "send" },
  { name: "/btw", args: "<question>", description: "Side question without changing session context.", icon: MessageSquare, category: "tools", action: "send" },
  { name: "/restart", description: "Restart OpenClaw.", icon: RefreshCw, category: "tools", action: "send" },
  // Management
  { name: "/focus", args: "[target]", description: "Bind thread to a session target.", icon: Eye, category: "management", action: "send" },
  { name: "/unfocus", description: "Remove thread binding.", icon: EyeOff, category: "management", action: "send" },
  { name: "/agents", description: "List thread-bound agents for this session.", icon: Cpu, category: "management", action: "send" },
  { name: "/subagents", args: "[action]", description: "List, kill, log, spawn, or steer subagent runs.", icon: LayoutGrid, category: "management", action: "send" },
  { name: "/kill", args: "[target]", description: "Kill a running subagent (or all).", icon: CircleStop, category: "management", action: "send" },
  { name: "/steer", args: "[target]", description: "Send guidance to a running subagent.", icon: MessageSquare, category: "management", action: "send" },
  { name: "/config", args: "[action]", description: "Show or set config values.", icon: Settings, category: "management", action: "send" },
  { name: "/plugins", args: "[action]", description: "List, show, enable, or disable plugins.", icon: List, category: "management", action: "send" },
  // Options
  { name: "/model", args: "[name]", description: "Show or set the model.", icon: Brain, category: "options", action: "send" },
  { name: "/think", args: "[level]", description: "Set thinking level.", icon: Brain, category: "options", action: "send" },
  { name: "/reasoning", description: "Toggle reasoning visibility.", icon: Brain, category: "options", action: "send" },
  { name: "/fast", description: "Toggle fast mode.", icon: Zap, category: "options", action: "send" },
  { name: "/verbose", description: "Toggle verbose mode.", icon: Info, category: "options", action: "send" },
  // Media
  { name: "/tts", args: "[on|off|toggle]", description: "Control text-to-speech.", icon: Volume2, category: "media", action: "send" },
];

const CATEGORY_LABELS: Record<string, string> = {
  session: "Session",
  status: "Status",
  tools: "Tools",
  management: "Management",
  options: "Options",
  media: "Media",
};

type PendingFile = {
  file: File;
  preview: string; // data URL for images
  attachment: ChatAttachment;
};

export function ChatInput({ onSend, onAbort, onReset, streaming, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [selectedCmd, setSelectedCmd] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const canSend = (value.trim() || files.length > 0) && !streaming && !disabled;

  // Slash command filtering
  const showSlashMenu = value.startsWith("/") && !value.includes(" ");
  const filteredCommands = useMemo(() => {
    if (!showSlashMenu) return [];
    const q = value.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
  }, [showSlashMenu, value]);

  // Scroll selected command into view
  useEffect(() => {
    if (!menuRef.current || !showSlashMenu) return;
    const item = menuRef.current.querySelector(`[data-cmd-idx="${selectedCmd}"]`);
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [selectedCmd, showSlashMenu]);

  const executeCommand = useCallback((cmd: SlashCommand) => {
    switch (cmd.action) {
      case "stop":
        onAbort();
        break;
      case "reset":
      case "new":
        onReset?.();
        break;
      case "clear":
        onReset?.();
        break;
      case "send":
        if (cmd.args) {
          // Put command in input for user to add args
          setValue(cmd.name + " ");
          textareaRef.current?.focus();
          return;
        }
        onSend(cmd.name);
        break;
    }
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [onAbort, onReset, onSend]);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const attachments = files.length > 0 ? files.map((f) => f.attachment) : undefined;
    onSend(value.trim(), attachments);
    setValue("");
    setFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, files, canSend, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCmd((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCmd((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        executeCommand(filteredCommands[selectedCmd]);
        return;
      }
      if (e.key === "Escape") {
        setValue("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    setSelectedCmd(0);
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;

    const newFiles: PendingFile[] = [];
    for (const file of Array.from(selected)) {
      if (files.length + newFiles.length >= 5) break;
      const data = await fileToBase64(file);
      const isImage = file.type.startsWith("image/");
      newFiles.push({
        file,
        preview: isImage ? `data:${file.type};base64,${data}` : "",
        attachment: {
          type: isImage ? "image" : "file",
          mediaType: file.type || "application/octet-stream",
          fileName: file.name,
          data,
        },
      });
    }
    setFiles((prev) => [...prev, ...newFiles]);

    // Reset input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="relative">
      {/* Slash command menu */}
      {showSlashMenu && filteredCommands.length > 0 && (
        <div ref={menuRef} className="absolute bottom-full left-0 right-0 z-30 mb-1 max-h-80 overflow-y-auto rounded-xl border border-border-muted bg-surface-raised shadow-xl">
          {(() => {
            let globalIdx = 0;
            const categories = [...new Set(filteredCommands.map((c) => c.category))];
            return categories.map((cat) => {
              const cmds = filteredCommands.filter((c) => c.category === cat);
              return (
                <div key={cat}>
                  <div className="sticky top-0 bg-surface-raised px-3 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                      {CATEGORY_LABELS[cat] || cat}
                    </span>
                  </div>
                  {cmds.map((cmd) => {
                    const idx = globalIdx++;
                    return (
                      <button
                        key={cmd.name + cmd.category}
                        data-cmd-idx={idx}
                        onMouseDown={(e) => { e.preventDefault(); executeCommand(cmd); }}
                        onMouseEnter={() => setSelectedCmd(idx)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                          idx === selectedCmd ? "bg-surface-overlay" : "hover:bg-surface-overlay/50"
                        }`}
                      >
                        <cmd.icon className="h-4 w-4 shrink-0 text-muted" />
                        <div className="flex flex-1 items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-emerald-400">{cmd.name}</span>
                          {cmd.args && <span className="hidden sm:inline text-xs text-muted">{cmd.args}</span>}
                        </div>
                        <span className="hidden sm:inline shrink-0 text-xs text-muted text-right max-w-[200px] truncate">{cmd.description}</span>
                        {cmd.instant && (
                          <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                            instant
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      )}

    <div className="rounded-xl border border-border-muted bg-surface-raised shadow-sm">
      {/* File previews */}
      {files.length > 0 && (
        <div className="flex gap-2 px-3 pt-3 overflow-x-auto">
          {files.map((f, i) => (
            <div key={i} className="group relative shrink-0">
              {f.file.type.startsWith("image/") ? (
                <img
                  src={f.preview}
                  alt={f.file.name}
                  className="h-16 w-16 rounded-lg object-cover border border-border-muted"
                />
              ) : (
                <div className="flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-border-muted bg-surface-overlay px-2">
                  <span className="text-[10px] font-medium text-emerald-400 uppercase">
                    {f.file.name.split(".").pop()}
                  </span>
                  <span className="w-full truncate text-center text-[10px] text-muted">
                    {f.file.name}
                  </span>
                </div>
              )}
              <button
                onClick={() => removeFile(i)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Message..."
          disabled={disabled}
          rows={1}
          className="block w-full resize-none bg-transparent px-4 py-3 pr-20 text-sm text-primary placeholder-muted outline-none disabled:opacity-50"
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || streaming || files.length >= 5}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-overlay hover:text-secondary disabled:opacity-30"
            title="Attach file"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          {streaming ? (
            <button
              onClick={onAbort}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-600/80 text-white transition-colors hover:bg-red-500"
              title="Stop generating"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white transition-colors hover:bg-emerald-500 disabled:opacity-30"
              title="Send message"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.xml,.yaml,.yml,.html,.css,.js,.ts,.py,.go,.rs,.java,.rb,.sh"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:...;base64," prefix
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
