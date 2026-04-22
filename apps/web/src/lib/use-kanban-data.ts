"use client";

import { useEffect, useRef } from "react";
import type { KanbanDateResponse } from "@opcify/core";
import { api } from "./api";
import { useApi } from "./use-api";
import { useTaskEvents } from "./use-task-events";

interface UseKanbanDataResult {
  data: KanbanDateResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Kanban data loader. Owns:
 * - Initial fetch + manual refetch (via useApi)
 * - SSE-driven refetch on task/step events (debounced 100ms to coalesce bursts)
 * - Fallback poll every 30s only when the SSE connection is closed
 *
 * The previous page.tsx ran a 5s poll alongside SSE, duplicating refetches.
 * This hook replaces that pattern: SSE is primary, polling is the safety net.
 */
export function useKanbanData(
  selectedDate: string,
  workspaceId: string,
  timezone: string,
): UseKanbanDataResult {
  const { data, loading, error, refetch } = useApi(
    () => api.kanban.byDate(selectedDate, workspaceId, timezone),
    [selectedDate, workspaceId, timezone],
  );

  const { lastEvent, connected } = useTaskEvents(workspaceId);

  // Debounce SSE-driven refetches so a burst of step:updated events coalesces.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!lastEvent) return;
    if (
      lastEvent.type !== "task:updated" &&
      lastEvent.type !== "task:created" &&
      lastEvent.type !== "step:updated"
    ) {
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refetch();
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [lastEvent, refetch]);

  // Fallback polling: only when SSE is disconnected. 30s cadence.
  useEffect(() => {
    if (connected) return;
    const interval = setInterval(() => {
      refetch();
    }, 30_000);
    return () => clearInterval(interval);
  }, [connected, refetch]);

  return { data, loading, error, refetch };
}
