import { Queue, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { TaskPriority } from "@opcify/core";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import {
  dispatchTaskToOpenClaw,
  DispatchError,
} from "../openclaw-integration/index.js";
import type { OpenClawClient } from "../openclaw-integration/index.js";
import { eventBroadcaster } from "../events/broadcaster.js";
import { cascadeFailDependents } from "./cascade.js";

const log = createLogger("task-dispatcher");

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Compare two tasks for dispatch ordering.
 * Returns negative if `a` should dispatch before `b`.
 * Order: focus first → higher priority → older createdAt.
 */
function compareDispatchOrder(
  a: { isFocus: boolean; priority: string; createdAt: Date },
  b: { isFocus: boolean; priority: string; createdAt: Date },
): number {
  // Focus tasks always go first
  if (a.isFocus !== b.isFocus) return a.isFocus ? -1 : 1;
  // Then by priority level
  const pa = PRIORITY_RANK[a.priority] ?? 1;
  const pb = PRIORITY_RANK[b.priority] ?? 1;
  if (pa !== pb) return pa - pb;
  // Then oldest first
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export interface DispatchJobData {
  taskId: string;
  workspaceId: string;
}

/**
 * Creates a BullMQ queue and worker for a workspace.
 * Returns the queue and a function to gracefully shut down.
 */
export function createWorkspaceDispatcher(
  workspaceId: string,
  connection: Redis,
  openclawClient: OpenClawClient,
) {
  const queueName = `dispatch-${workspaceId}`;

  const queue = new Queue<DispatchJobData>(queueName, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  });

  const worker = new Worker<DispatchJobData>(
    queueName,
    async (job: Job<DispatchJobData>) => {
      await processDispatchJob(job, openclawClient, workspaceId);
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    if (job) {
      log.warn("Dispatch job failed", {
        taskId: job.data.taskId,
        attempt: job.attemptsMade,
        error: err.message,
      });
    }
  });

  worker.on("completed", async (job) => {
    log.info("Dispatch job completed", { taskId: job.data.taskId });
  });

  worker.on("error", (err) => {
    log.error("Worker error", { queue: queueName, error: err.message });
  });

  return {
    queue,
    worker,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}

/**
 * Enqueue a task for dispatch.
 * Uses a single attempt — capacity/dependency waits are handled by the
 * recovery sweep (every 60s) which re-enqueues queued tasks whose jobs
 * completed without dispatching.
 */
export async function enqueueTask(
  queue: Queue<DispatchJobData>,
  taskId: string,
  workspaceId: string,
  priority: TaskPriority | string,
) {
  const priorityNum: Record<string, number> = { high: 1, medium: 2, low: 3 };

  await queue.add(
    "dispatch",
    { taskId, workspaceId },
    {
      jobId: taskId,
      priority: priorityNum[priority] ?? 2,
      attempts: 3, // only retry on real errors (network, crash), not capacity waits
      backoff: {
        type: "exponential",
        delay: 5_000,
      },
    },
  );

  log.info("Task enqueued", { taskId, workspaceId, priority });
}

/**
 * Remove a task from the queue (e.g., on cascade failure or cancellation).
 */
export async function removeFromQueue(
  queue: Queue<DispatchJobData>,
  taskId: string,
) {
  try {
    const job = await queue.getJob(taskId);
    if (job) {
      await job.remove();
      log.info("Task removed from queue", { taskId });
    }
  } catch {
    // Job may already be processing or completed
  }
}

/**
 * Get the queue position for a task (1-indexed, null if not waiting).
 */
export async function getQueuePosition(
  queue: Queue<DispatchJobData>,
  taskId: string,
): Promise<number | null> {
  const waitingJobs = await queue.getJobs(["waiting", "delayed"], 0, 100);
  const index = waitingJobs.findIndex((j) => j.data.taskId === taskId);
  return index >= 0 ? index + 1 : null;
}

/**
 * Core job processor: checks agent capacity, dependencies, then dispatches.
 *
 * Design: when agent is at capacity or blocked by dependency, the job completes
 * successfully (returns without dispatching). The task stays in "queued" status
 * in the DB, and the 60s recovery sweep will re-enqueue it. This avoids burning
 * BullMQ retry attempts on expected wait conditions.
 */
async function processDispatchJob(
  job: Job<DispatchJobData>,
  openclawClient: OpenClawClient,
  _wsId: string,
) {
  const { taskId, workspaceId } = job.data;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { agent: true },
  });

  if (!task) {
    log.warn("Task not found, skipping dispatch", { taskId });
    return;
  }

  // Skip if task is no longer queued (e.g., manually started or cancelled)
  if (task.status !== "queued") {
    log.info("Task no longer queued, skipping", {
      taskId,
      status: task.status,
    });
    return;
  }

  // Check dependency — complete job without dispatch, recovery will retry later
  if (task.blockedByTaskId) {
    const blocker = await prisma.task.findUnique({
      where: { id: task.blockedByTaskId },
    });

    if (blocker?.status === "failed" || blocker?.status === "stopped") {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "failed", waitingReason: "dependency_failed" },
      });
      eventBroadcaster.emit(workspaceId, {
        type: "task:updated",
        taskId,
        status: "failed",
      });
      await cascadeFailDependents(taskId, workspaceId);
      return;
    }

    if (blocker && blocker.status !== "done") {
      log.info("Task blocked by dependency, will retry via sweep", {
        taskId,
        blockerId: task.blockedByTaskId,
        blockerStatus: blocker.status,
      });
      return; // Complete job — recovery sweep will re-enqueue
    }
  }

  // Check agent capacity — if at capacity, find the highest-priority
  // queued task for this agent and only proceed if this task is it.
  if (task.agent) {
    const runningCount = await prisma.task.count({
      where: { agentId: task.agentId, status: "running" },
    });

    const maxConcurrent = task.agent.maxConcurrent ?? 1;
    if (runningCount >= maxConcurrent) {
      log.info("Agent at capacity, will retry via sweep", {
        taskId,
        agentId: task.agentId,
        runningCount,
        maxConcurrent,
      });
      return; // Complete job — recovery sweep will re-enqueue
    }

    // Agent has capacity — check if this is the highest-priority queued task
    // for this agent. Fetch all unblocked queued tasks and sort properly
    // (Prisma sorts strings alphabetically, which gets priority wrong).
    const candidates = await prisma.task.findMany({
      where: {
        agentId: task.agentId,
        status: "queued",
        blockedByTaskId: null,
      },
      select: { id: true, isFocus: true, priority: true, createdAt: true },
    });

    if (candidates.length > 1) {
      candidates.sort(compareDispatchOrder);
      const best = candidates[0];
      if (best.id !== taskId) {
        log.info("Higher-priority task exists for agent, deferring", {
          taskId,
          priority: task.priority,
          created: task.createdAt.toISOString(),
          bestTaskId: best.id,
          bestPriority: best.priority,
          bestCreated: best.createdAt.toISOString(),
        });
        return; // Complete — recovery sweep will re-enqueue both
      }
    }
  }

  // Dispatch to OpenClaw
  try {
    await dispatchTaskToOpenClaw(taskId, openclawClient);

    eventBroadcaster.emit(workspaceId, {
      type: "task:updated",
      taskId,
      status: "running",
      progress: 0,
    });

    await emitQueueChanged(task.agentId, workspaceId);
  } catch (err) {
    if (err instanceof DispatchError && err.code === "ALREADY_RUNNING") {
      return;
    }
    throw err; // Real error — BullMQ will retry (up to 3 attempts)
  }
}

/**
 * Emit a queue:changed event for an agent's current capacity.
 */
export async function emitQueueChanged(
  agentId: string,
  workspaceId: string,
) {
  const [runningCount, queuedCount, agent] = await Promise.all([
    prisma.task.count({ where: { agentId, status: "running" } }),
    prisma.task.count({ where: { agentId, status: "queued" } }),
    prisma.agent.findUnique({
      where: { id: agentId },
      select: { maxConcurrent: true },
    }),
  ]);

  eventBroadcaster.emit(workspaceId, {
    type: "queue:changed",
    agentId,
    queuedCount,
    runningCount,
    maxConcurrent: agent?.maxConcurrent ?? 1,
  });
}
