"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { TaskSSEEvent } from "@opcify/core";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4210";

interface UseTaskEventsOptions {
  /** Whether the SSE connection is enabled (default: true) */
  enabled?: boolean;
}

interface UseTaskEventsResult {
  /** The most recent event received */
  lastEvent: TaskSSEEvent | null;
  /** Whether the SSE connection is currently open */
  connected: boolean;
  /** Subscribe to specific event types */
  onEvent: (callback: (event: TaskSSEEvent) => void) => () => void;
}

/**
 * Hook that connects to the SSE /events/tasks endpoint for a workspace.
 * Returns the latest event and connection status.
 *
 * The EventSource auto-reconnects on connection loss.
 */
export function useTaskEvents(
  workspaceId: string | undefined,
  options: UseTaskEventsOptions = {},
): UseTaskEventsResult {
  const { enabled = true } = options;
  const [lastEvent, setLastEvent] = useState<TaskSSEEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const callbacksRef = useRef<Set<(event: TaskSSEEvent) => void>>(new Set());

  useEffect(() => {
    if (!workspaceId || !enabled) return;

    const url = `${BASE}/events/tasks?workspaceId=${encodeURIComponent(workspaceId)}`;
    const es = new EventSource(url);

    es.onopen = () => {
      setConnected(true);
    };

    es.onmessage = (e) => {
      try {
        const event: TaskSSEEvent = JSON.parse(e.data);
        // Skip the initial "connected" event from the server
        if ((event as { type: string }).type === "connected") return;

        setLastEvent(event);

        // Notify all subscribers
        for (const cb of callbacksRef.current) {
          try {
            cb(event);
          } catch {
            // Swallow callback errors
          }
        }
      } catch {
        // Ignore unparseable events (e.g., heartbeat comments are not dispatched here)
      }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects — no manual retry needed
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [workspaceId, enabled]);

  // Refetch on tab visibility change (catch up on missed events)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && lastEvent) {
        // The parent component can call refetch() in response to this
        // by subscribing to events
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [lastEvent]);

  const onEvent = useCallback(
    (callback: (event: TaskSSEEvent) => void) => {
      callbacksRef.current.add(callback);
      return () => {
        callbacksRef.current.delete(callback);
      };
    },
    [],
  );

  return { lastEvent, connected, onEvent };
}
