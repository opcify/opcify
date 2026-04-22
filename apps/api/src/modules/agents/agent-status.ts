import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";

const log = createLogger("agent-status");

const NON_DERIVABLE = new Set(["blocked", "disabled", "error"]);

/**
 * Recompute and persist `Agent.status` from the in-flight work the agent
 * currently has in OpenClaw. An agent is "running" when ANY of:
 *
 *   1. A Task with status="running" is assigned to it (Task.agentId), OR
 *   2. The agent is the orchestrator of a running Task (Task.orchestratorAgentId), OR
 *   3. A TaskExecutionStep with status="running" references it as the executor
 *      (covers sub-agents that an orchestrator spawned via the opcify skill —
 *      those don't get their own Task row, only an execution step entry).
 *
 * Otherwise the agent falls back to "idle". User-managed states
 * (blocked / disabled / error) are preserved and never overwritten —
 * those are mutated by explicit admin actions, not task lifecycle.
 *
 * Failures are logged and swallowed. Agent status is a derived UI hint,
 * not load-bearing data, so a recompute hiccup must never cascade back
 * into a task lifecycle error.
 */
export async function recomputeAgentStatus(
  agentId: string | null | undefined,
): Promise<void> {
  if (!agentId) return;
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { status: true },
    });
    if (!agent) return;
    if (NON_DERIVABLE.has(agent.status)) return;

    const [runningTaskCount, runningStepCount] = await Promise.all([
      prisma.task.count({
        where: {
          status: "running",
          OR: [{ agentId }, { orchestratorAgentId: agentId }],
        },
      }),
      prisma.taskExecutionStep.count({
        where: {
          agentId,
          status: "running",
          task: { status: "running" },
        },
      }),
    ]);

    const next = runningTaskCount + runningStepCount > 0 ? "running" : "idle";
    if (next !== agent.status) {
      await prisma.agent.update({
        where: { id: agentId },
        data: { status: next },
      });
    }
  } catch (err) {
    log.warn("Failed to recompute agent status", {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Recompute the status of every agent involved in a task: its assigned
 * executor (`Task.agentId`) and its orchestrator (`Task.orchestratorAgentId`).
 * Use this from any code path that mutates `Task.status`.
 */
export async function recomputeAgentStatusForTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { agentId: true, orchestratorAgentId: true },
  });
  if (!task) return;
  await recomputeAgentStatus(task.agentId);
  if (task.orchestratorAgentId && task.orchestratorAgentId !== task.agentId) {
    await recomputeAgentStatus(task.orchestratorAgentId);
  }
}

/** Recompute for an arbitrary set of agent IDs, deduped and concurrent. */
export async function recomputeAgentStatusBatch(
  agentIds: Array<string | null | undefined>,
): Promise<void> {
  const unique = [...new Set(agentIds.filter((id): id is string => !!id))];
  await Promise.all(unique.map((id) => recomputeAgentStatus(id)));
}
