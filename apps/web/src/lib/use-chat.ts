"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage, ChatStreamEvent, ChatAttachment } from "@opcify/core";
import { api, apiUrl } from "./api";
import { getToken } from "./auth";

interface UseChatResult {
  messages: ChatMessage[];
  streaming: boolean;
  streamText: string;
  streamThinking: string;
  connected: boolean;
  loading: boolean;
  error: string | null;
  send: (message: string, attachments?: ChatAttachment[]) => Promise<void>;
  abort: () => Promise<void>;
  resetSession: () => Promise<void>;
}

/**
 * Hook that manages a chat session with an agent via REST + SSE.
 *
 * - Loads message history on mount / agent change
 * - Maintains an SSE connection for streaming responses
 * - Provides send, abort, and resetSession actions
 */
export function useChat(
  workspaceId: string,
  agentId: string | null,
  sessionKey?: string,
): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamThinking, setStreamThinking] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSessionKey = useRef<string | undefined>(sessionKey);
  const streamTextRef = useRef("");
  const streamThinkingRef = useRef("");

  // Track sessionKey from last send (may differ from prop if using defaults)
  const resolvedSessionKey = useRef<string | undefined>(sessionKey);

  // ── Load history on mount / agent change ─────────────────────────
  useEffect(() => {
    if (!agentId) return;
    activeSessionKey.current = sessionKey;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setMessages([]);
      setStreamText("");
      setStreamThinking("");
      setStreaming(false);

      try {
        const res = await api.chat.history(agentId, workspaceId, sessionKey);
        if (!cancelled) {
          setMessages(res.messages);
          resolvedSessionKey.current = res.sessionKey;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [workspaceId, agentId, sessionKey]);

  // ── SSE connection for streaming ─────────────────────────────────
  useEffect(() => {
    if (!agentId) return;
    let closed = false;

    const qs = new URLSearchParams();
    if (sessionKey) qs.set("sessionKey", sessionKey);
    // EventSource cannot send Authorization headers — pass the JWT as a
    // `_token` query param that the backend middleware accepts as a fallback.
    const token = getToken();
    if (token) qs.set("_token", token);

    const url = apiUrl(
      `/workspaces/${workspaceId}/chat/${agentId}/stream?${qs.toString()}`,
    );
    const es = new EventSource(url);

    es.onopen = () => {
      if (!closed) setConnected(true);
    };

    es.onmessage = (e) => {
      if (closed) return;
      try {
        const event = JSON.parse(e.data) as ChatStreamEvent | { type: "connected" };
        if (event.type === "connected") return;

        const chatEvent = event as ChatStreamEvent;

        switch (chatEvent.type) {
          case "chat:delta":
            setStreaming(true);
            if (chatEvent.blockType === "thinking") {
              streamThinkingRef.current = chatEvent.text;
              setStreamThinking(chatEvent.text);
            } else {
              streamTextRef.current = chatEvent.text;
              setStreamText(chatEvent.text);
            }
            break;

          case "chat:final":
            setStreaming(false);
            streamTextRef.current = "";
            streamThinkingRef.current = "";
            setStreamText("");
            setStreamThinking("");
            setMessages((prev) => [...prev, chatEvent.message]);
            break;

          case "chat:error":
            setStreaming(false);
            streamTextRef.current = "";
            streamThinkingRef.current = "";
            setStreamText("");
            setStreamThinking("");
            setError(chatEvent.error);
            break;

          case "chat:aborted":
            setStreaming(false);
            if (streamTextRef.current.trim()) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: [{ type: "text", text: streamTextRef.current + " [aborted]" }],
                  timestamp: Date.now(),
                },
              ]);
            }
            streamTextRef.current = "";
            streamThinkingRef.current = "";
            setStreamText("");
            setStreamThinking("");
            break;
        }
      } catch {
        // Ignore unparseable events
      }
    };

    es.onerror = () => {
      if (!closed) setConnected(false);
    };

    return () => {
      closed = true;
      es.close();
      setConnected(false);
    };
  }, [workspaceId, agentId, sessionKey]);

  // ── Actions ──────────────────────────────────────────────────────

  const send = useCallback(
    async (message: string, attachments?: ChatAttachment[]) => {
      if (!agentId || (!message.trim() && !attachments?.length)) return;
      setError(null);

      // Optimistic: add user message immediately
      const content: ChatMessage["content"] = [];
      if (message.trim()) {
        content.push({ type: "text", text: message });
      }
      if (attachments?.length) {
        for (const att of attachments) {
          if (att.type === "image") {
            content.push({ type: "image", mediaType: att.mediaType, data: att.data });
          } else {
            content.push({ type: "text", text: `[Attached: ${att.fileName || "file"}]` });
          }
        }
      }
      const userMessage: ChatMessage = {
        role: "user",
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      streamTextRef.current = "";
      setStreamText("");
      setStreaming(true);

      try {
        const result = await api.chat.send(agentId, workspaceId, {
          message,
          sessionKey: resolvedSessionKey.current,
          attachments,
        });
        resolvedSessionKey.current = result.sessionKey;
      } catch (err) {
        setStreaming(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [agentId, workspaceId],
  );

  const abort = useCallback(async () => {
    if (!agentId) return;
    try {
      await api.chat.abort(agentId, workspaceId, resolvedSessionKey.current);
    } catch {
      // Best effort
    }
  }, [agentId, workspaceId]);

  const resetSession = useCallback(async () => {
    if (!agentId) return;
    try {
      await api.chat.reset(agentId, workspaceId, resolvedSessionKey.current);
      setMessages([]);
      setStreamText("");
      setStreamThinking("");
      setStreaming(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [agentId, workspaceId]);

  return {
    messages,
    streaming,
    streamText,
    streamThinking,
    connected,
    loading,
    error,
    send,
    abort,
    resetSession,
  };
}
