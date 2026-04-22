import type { DispatchManager } from "./manager.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { enqueueTask } from "./queue.js";

const log = createLogger("dispatch-recovery");

/**
 * Recovery sweep: re-enqueue any tasks stuck in "queued" status
 * whose BullMQ job is missing or has permanently failed.
 *
 * This handles:
 * - Redis data loss (crash without AOF)
 * - Clean API restart where BullMQ jobs were lost
 * - Jobs that exhausted retries (stuck in "failed" state)
 * - Tasks created while API was down
 */
export async function runRecoverySweep(
  manager: DispatchManager,
) {
  log.info("Running dispatch recovery sweep...");

  // Find all queued tasks
  const queuedTasks = await prisma.task.findMany({
    where: { status: "queued" },
    select: {
      id: true,
      priority: true,
      workspaceId: true,
    },
  });

  if (queuedTasks.length === 0) {
    log.info("No queued tasks to recover");
    return;
  }

  let recovered = 0;

  for (const task of queuedTasks) {
    const workspaceId = task.workspaceId ?? "default";
    const queue = manager.getQueue(workspaceId);

    // Check if job exists and is still active/waiting/delayed
    const existingJob = await queue.getJob(task.id);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === "waiting" || state === "active" || state === "delayed") {
        continue; // Job is still being processed — skip
      }
      // Job is failed/completed/unknown — remove it so we can re-enqueue
      try {
        await existingJob.remove();
      } catch {
        // Job may already be gone
      }
    }

    await enqueueTask(
      queue,
      task.id,
      workspaceId,
      task.priority,
    );
    recovered++;
  }

  log.info(`Recovery sweep complete: ${recovered}/${queuedTasks.length} tasks re-enqueued`);
}
