"use client";

import { useState } from "react";
import type { ChatMessage as ChatMessageType, ChatContentBlock } from "@opcify/core";
import { ChevronDown, ChevronRight, Wrench, Bot, Copy, Check } from "lucide-react";
import { ChatMarkdown } from "./chat-markdown";

interface ChatMessageProps {
  message: ChatMessageType;
  agentName?: string;
  /**
   * When false, tool_use/tool_result blocks are omitted and tool-only
   * assistant messages are skipped entirely. Defaults to true so embedded
   * consumers (compose panel, archives) keep their current behavior.
   */
  showToolCalls?: boolean;
}

function extractText(message: ChatMessageType): string {
  return message.content
    .map((b) => {
      if (b.type === "text" || b.type === "thinking") return b.text;
      if (b.type === "tool_use") return `[Tool: ${b.name}] ${b.input}`;
      if (b.type === "tool_result") return `[Result: ${b.name}] ${b.content}`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex h-6 w-6 items-center justify-center rounded-md text-muted opacity-0 transition-all hover:bg-surface-overlay hover:text-secondary group-hover:opacity-100"
      title="Copy message"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function ChatMessage({
  message,
  agentName,
  showToolCalls = true,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const rawText = extractText(message);

  // Skip empty messages (e.g. tool-only blocks that failed parsing)
  if (message.content.length === 0) return null;

  // Check if this message is tool-activity-only (no text/thinking/image blocks)
  const hasVisibleContent = message.content.some(
    (b) => b.type === "text" || b.type === "thinking" || b.type === "image",
  );
  const toolBlocks = message.content.filter(
    (b) => b.type === "tool_use" || b.type === "tool_result",
  );
  const isToolOnly = !hasVisibleContent && toolBlocks.length > 0;

  // When tool calls are hidden, a tool-only message collapses to nothing.
  if (isToolOnly && !showToolCalls) return null;

  // Drop tool blocks from the render list when the setting is off.
  const visibleBlocks = showToolCalls
    ? message.content
    : message.content.filter(
        (b) => b.type !== "tool_use" && b.type !== "tool_result",
      );

  // Tool results arrive as role=user messages (Anthropic convention: the tool
  // output is fed back to the assistant as if the user provided it), but
  // visually they belong on the assistant side next to the tool call that
  // produced them. Route tool-only user messages through the assistant-side
  // compact render path so the call + result sit together.
  if (isUser && !isToolOnly) {
    return (
      <div className="group flex justify-end gap-2">
        <CopyButton text={rawText} />
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-emerald-600/15 px-4 py-2.5">
          <div className="text-sm text-primary">
            {visibleBlocks.map((block, i) => (
              <ContentBlock key={i} block={block} isUser />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Tool-only messages (whether emitted as user-role tool_result or
  // assistant-role tool_use) render on the assistant side with the bot
  // avatar and a compact chrome.
  if (isToolOnly) {
    return (
      <div className="group flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600/20">
          <Bot className="h-3.5 w-3.5 text-violet-400" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-medium text-muted">{agentName || "Assistant"}</span>
          </div>
          <div className="text-sm">
            {visibleBlocks.map((block, i) => (
              <ContentBlock key={i} block={block} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600/20">
        <Bot className="h-3.5 w-3.5 text-violet-400" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs font-medium text-muted">{agentName || "Assistant"}</span>
          <CopyButton text={rawText} />
        </div>
        <div className="text-sm text-primary">
          {visibleBlocks.map((block, i) => (
            <ContentBlock key={i} block={block} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ContentBlock({ block, isUser }: { block: ChatContentBlock; isUser?: boolean }) {
  switch (block.type) {
    case "text":
      return isUser ? (
        <div className="whitespace-pre-wrap break-words leading-relaxed">{block.text}</div>
      ) : (
        <ChatMarkdown content={block.text} />
      );
    case "image":
      return (
        <img
          src={`data:${block.mediaType};base64,${block.data}`}
          alt="attachment"
          className="my-1 max-h-64 max-w-xs rounded-lg border border-border-muted"
        />
      );
    case "thinking":
      return <ThinkingBlock text={block.text} />;
    case "tool_use":
      return <ToolCallBlock name={block.name} input={block.input} />;
    case "tool_result":
      return <ToolResultBlock name={block.name} content={block.content} />;
    default:
      return null;
  }
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-overlay hover:text-secondary"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Thinking...
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-border-muted bg-surface-raised p-3 text-xs text-muted whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ name, input }: { name: string; input: string }) {
  const [open, setOpen] = useState(false);
  let formattedInput = input;
  try {
    const parsed = JSON.parse(input);
    formattedInput = JSON.stringify(parsed, null, 2);
  } catch {
    // keep as-is
  }
  return (
    <div className="my-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-400 transition-colors hover:bg-amber-500/10"
      >
        <Wrench className="h-3 w-3" />
        <span className="font-medium">{name}</span>
        {open ? <ChevronDown className="h-3 w-3 ml-1 text-amber-500/60" /> : <ChevronRight className="h-3 w-3 ml-1 text-amber-500/60" />}
      </button>
      {open && formattedInput && (
        <div className="mt-1 rounded-lg border border-border-muted bg-surface-raised p-3 text-xs text-muted font-mono whitespace-pre-wrap overflow-x-auto max-h-60">
          {formattedInput}
        </div>
      )}
    </div>
  );
}

function ToolResultBlock({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false);
  let formattedContent = content;
  try {
    const parsed = JSON.parse(content);
    formattedContent = JSON.stringify(parsed, null, 2);
  } catch {
    // keep as-is
  }
  // Truncate preview for long results
  const preview = content.length > 80 ? content.slice(0, 80) + "…" : "";
  return (
    <div className="my-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-blue-500/20 bg-blue-500/5 px-2.5 py-1.5 text-xs text-blue-400 transition-colors hover:bg-blue-500/10"
      >
        <Wrench className="h-3 w-3" />
        <span className="font-medium">Result: {name}</span>
        {preview && !open && <span className="ml-1 max-w-[200px] truncate text-blue-400/50">{preview}</span>}
        {open ? <ChevronDown className="h-3 w-3 ml-1 text-blue-500/60" /> : <ChevronRight className="h-3 w-3 ml-1 text-blue-500/60" />}
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-border-muted bg-surface-raised p-3 text-xs text-muted font-mono whitespace-pre-wrap overflow-x-auto max-h-60">
          {formattedContent}
        </div>
      )}
    </div>
  );
}
