import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { OpenClawClient } from "../openclaw-integration/service.js";
import { createWorkspaceDispatcher, type DispatchJobData } from "./queue.js";
import { createLogger } from "../../logger.js";

const log = createLogger("dispatch-manager");

type Dispatcher = ReturnType<typeof createWorkspaceDispatcher>;

/**
 * Manages per-workspace BullMQ dispatch queues with lazy initialization.
 * Queues are created on-demand when a task is first enqueued for a workspace.
 */
export class DispatchManager {
  private dispatchers = new Map<string, Dispatcher>();

  constructor(
    private redis: Redis,
    private openclawClient: OpenClawClient,
  ) {}

  /**
   * Get (or lazily create) the dispatch queue for a workspace.
   */
  getQueue(workspaceId: string): Queue<DispatchJobData> {
    let dispatcher = this.dispatchers.get(workspaceId);
    if (!dispatcher) {
      log.info("Creating dispatch queue for workspace", { workspaceId });
      dispatcher = createWorkspaceDispatcher(
        workspaceId,
        this.redis,
        this.openclawClient,
      );
      this.dispatchers.set(workspaceId, dispatcher);
    }
    return dispatcher.queue;
  }

  /**
   * Return all active queues (for recovery sweep).
   */
  getAllQueues(): Map<string, Queue<DispatchJobData>> {
    const map = new Map<string, Queue<DispatchJobData>>();
    for (const [id, d] of this.dispatchers) {
      map.set(id, d.queue);
    }
    return map;
  }

  /**
   * Gracefully shut down all dispatchers.
   */
  async shutdown(): Promise<void> {
    const ids = [...this.dispatchers.keys()];
    log.info("Shutting down dispatch manager", { queues: ids.length });
    await Promise.all(
      ids.map(async (id) => {
        const d = this.dispatchers.get(id);
        if (d) await d.close();
      }),
    );
    this.dispatchers.clear();
  }
}
