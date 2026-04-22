import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { eventBroadcaster } from "../events/broadcaster.js";

const log = createLogger("task-cascade");

/**
 * Recursively fail all tasks that depend on a failed task.
 * Updates status to "failed" with waitingReason "dependency_failed".
 */
export async function cascadeFailDependents(
  failedTaskId: string,
  workspaceId: string,
): Promise<number> {
  const dependents = await prisma.task.findMany({
    where: {
      blockedByTaskId: failedTaskId,
      status: { in: ["queued", "waiting"] },
    },
  });

  if (dependents.length === 0) return 0;

  let failedCount = 0;

  for (const dep of dependents) {
    await prisma.task.update({
      where: { id: dep.id },
      data: {
        status: "failed",
        waitingReason: "dependency_failed",
        finishedAt: new Date(),
      },
    });

    log.info("Cascade failed dependent task", {
      taskId: dep.id,
      failedParent: failedTaskId,
    });

    eventBroadcaster.emit(workspaceId, {
      type: "task:updated",
      taskId: dep.id,
      status: "failed",
    });

    failedCount++;

    // Recurse for transitive dependents
    failedCount += await cascadeFailDependents(dep.id, workspaceId);
  }

  return failedCount;
}
