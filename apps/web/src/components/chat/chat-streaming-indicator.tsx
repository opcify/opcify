"use client";

import { useState } from "react";
import { Bot, ChevronDown, ChevronRight, Brain } from "lucide-react";
import { ChatMarkdown } from "./chat-markdown";

interface ChatStreamingIndicatorProps {
  text: string;
  thinking?: string;
  agentName?: string;
}

export function ChatStreamingIndicator({ text, thinking, agentName }: ChatStreamingIndicatorProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const isThinking = !!thinking && !text;

  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600/20">
        <Bot className="h-3.5 w-3.5 text-violet-400" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-xs font-medium text-muted mb-1">{agentName || "Assistant"}</div>
        <div className="text-sm text-primary">
          {/* Thinking phase indicator */}
          {thinking && (
            <div className="my-1">
              <button
                onClick={() => setThinkingOpen(!thinkingOpen)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-overlay hover:text-secondary"
              >
                {isThinking && (
                  <Brain className="h-3 w-3 animate-pulse text-violet-400" />
                )}
                {thinkingOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Thinking...
              </button>
              {thinkingOpen && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border-muted bg-surface-raised p-3 text-xs text-muted whitespace-pre-wrap leading-relaxed">
                  {thinking}
                </div>
              )}
            </div>
          )}

          {/* Response text streaming */}
          {text ? (
            <div>
              <ChatMarkdown content={text} />
              <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-sm bg-emerald-400 align-text-bottom" />
            </div>
          ) : isThinking ? null : (
            <div className="flex items-center gap-1 py-1">
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:0ms]" />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:150ms]" />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:300ms]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
