import type { TaskSSEEvent } from "@opcify/core";
import { createLogger } from "../../logger.js";

const log = createLogger("sse-broadcaster");

class EventBroadcaster {
  private listeners = new Map<
    string,
    Set<(event: TaskSSEEvent) => void>
  >();

  subscribe(workspaceId: string, listener: (event: TaskSSEEvent) => void) {
    let set = this.listeners.get(workspaceId);
    if (!set) {
      set = new Set();
      this.listeners.set(workspaceId, set);
    }
    set.add(listener);
    log.info("SSE client subscribed", {
      workspaceId,
      clients: set.size,
    });
  }

  unsubscribe(
    workspaceId: string,
    listener: (event: TaskSSEEvent) => void,
  ) {
    const set = this.listeners.get(workspaceId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(workspaceId);
      }
      log.info("SSE client unsubscribed", {
        workspaceId,
        clients: set.size,
      });
    }
  }

  emit(workspaceId: string, event: TaskSSEEvent) {
    const set = this.listeners.get(workspaceId);
    if (!set || set.size === 0) return;

    log.info("SSE event emitted", {
      workspaceId,
      type: event.type,
      clients: set.size,
    });

    for (const listener of set) {
      try {
        listener(event);
      } catch (err) {
        log.error("SSE listener error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  getClientCount(workspaceId: string): number {
    return this.listeners.get(workspaceId)?.size ?? 0;
  }
}

export const eventBroadcaster = new EventBroadcaster();
