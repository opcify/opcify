import type { OpenClawExecuteCommand, OpenClawDispatchResult } from "@opcify/core";
import type { OpenClawClient } from "./service.js";
import { GatewayRpcClient } from "./service.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { loadWorkspaceFromDisk } from "../../workspace/WorkspaceConfig.js";
import { getOpcifyCallbackUrl, getOpcifyCallbackToken } from "../../workspace/opcify-url.js";
import { workspaceService } from "../../workspace/WorkspaceService.js";
import { recomputeAgentStatusForTask } from "../agents/agent-status.js";

const log = createLogger("task_dispatch");

export class DispatchError extends Error {
  constructor(message: string, public readonly code: "NOT_FOUND" | "ALREADY_RUNNING" | "DISPATCH_FAILED") {
    super(message);
    this.name = "DispatchError";
  }
}

/**
 * Loads a task from the DB, builds an OpenClaw execute command, dispatches it,
 * and updates the task status accordingly.
 */
export async function dispatchTaskToOpenClaw(
  taskId: string,
  client: OpenClawClient,
): Promise<OpenClawDispatchResult> {
  log.info("Dispatching task to OpenClaw", { taskId });

  // 1. Load task with agent + skills
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      agent: {
        include: { skills: { include: { skill: true } } },
      },
      executionSteps: { orderBy: { stepOrder: "asc" } },
    },
  });

  if (!task) {
    log.warn("Task not found for dispatch", { taskId });
    throw new DispatchError(`Task ${taskId} not found`, "NOT_FOUND");
  }

  // 2. Guard against duplicate dispatch
  if (task.status === "running") {
    log.warn("Task already running, blocking duplicate dispatch", { taskId });
    throw new DispatchError(`Task ${taskId} is already running`, "ALREADY_RUNNING");
  }

  // 3. Build command payload. stepOrder=0 is reserved for the dispatch
  // handover marker we seed AFTER a successful dispatch (see step 7
  // below) — filter it out of the workflow plan so retries don't feed
  // the marker back to the agent as an executable step.
  const userWorkflowSteps = task.executionSteps.filter((s) => s.stepOrder > 0);
  const workflowPlan = userWorkflowSteps.length > 0
    ? userWorkflowSteps.map((step) => ({
        stepOrder: step.stepOrder,
        agentId: step.agentId ?? undefined,
        agentName: step.agentName ?? undefined,
        roleLabel: step.roleLabel ?? undefined,
        instruction: step.instruction ?? (task.description || task.title),
      }))
    : undefined;

  const callbackBaseUrl = getOpcifyCallbackUrl();
  const meta = task.workspaceId
    ? await loadWorkspaceFromDisk(task.workspaceId)
    : null;
  const callbackToken = getOpcifyCallbackToken(meta);

  // Resolve workspace owner's timezone for the OpenClaw container
  let userTimezone = "UTC";
  if (task.workspaceId) {
    const ws = await prisma.workspace.findUnique({
      where: { id: task.workspaceId },
      select: { owner: { select: { timezone: true } } },
    });
    userTimezone = ws?.owner?.timezone ?? "UTC";
  }

  const command: OpenClawExecuteCommand = {
    taskId: task.id,
    executionMode: task.executionMode as OpenClawExecuteCommand["executionMode"],
    goal: task.title,
    description: task.description || undefined,
    priority: task.priority as OpenClawExecuteCommand["priority"],
    sourceTaskId: task.sourceTaskId ?? undefined,
    workflowPlan,
    context: {
      taskGroupId: task.taskGroupId ?? undefined,
      orchestratorAgentId: task.orchestratorAgentId ?? undefined,
    },
    callbackUrl: `${callbackBaseUrl}/tasks/${task.id}/execution-steps/sync`,
    callbackToken,
    timezone: userTimezone,
    agent: task.agent
      ? {
          id: task.agent.id,
          name: task.agent.name,
          role: task.agent.role,
          model: task.agent.model,
          skills: task.agent.skills?.map(
            (s: { skill: { key: string } }) => s.skill.key,
          ),
        }
      : undefined,
  };

  // 4. Resolve the OpenClaw client — prefer per-workspace gateway CLI, fall back to global
  let resolvedClient = client;
  if (task.workspaceId) {
    let ws = workspaceService.getWorkspace(task.workspaceId);

    // If workspace isn't in memory yet (containers provisioned in background),
    // ensure containers are started and try again.
    if (!ws) {
      log.info("Workspace not in memory — ensuring containers", { taskId, workspaceId: task.workspaceId });
      try {
        await workspaceService.ensureContainers(task.workspaceId);
        ws = workspaceService.getWorkspace(task.workspaceId);
      } catch (ensureErr) {
        log.warn("Could not ensure workspace containers", {
          workspaceId: task.workspaceId,
          error: ensureErr instanceof Error ? ensureErr.message : String(ensureErr),
        });
      }
    }

    if (ws) {
      resolvedClient = new GatewayRpcClient(task.workspaceId, ws.token);
      log.info("Using workspace gateway RPC", { taskId, workspaceId: task.workspaceId });
    } else {
      // Last resort: load token from disk and dispatch anyway
      const meta = await loadWorkspaceFromDisk(task.workspaceId);
      if (meta?.token) {
        resolvedClient = new GatewayRpcClient(task.workspaceId, meta.token);
        log.info("Using workspace gateway RPC (from disk meta)", { taskId, workspaceId: task.workspaceId });
      }
    }
  }

  // 5. Dispatch to OpenClaw
  log.info("Sending execute command", { taskId, executionMode: command.executionMode, steps: workflowPlan?.length ?? 0 });
  const result = await resolvedClient.execute(command);

  if (!result.success) {
    log.error("OpenClaw dispatch failed", { taskId, error: result.error });
    throw new DispatchError(
      `Failed to dispatch task ${taskId}: ${result.error}`,
      "DISPATCH_FAILED",
    );
  }

  // 6. Update task status to running.
  // Stamp startedAt only if it's currently null (idempotent across running→waiting→running).
  // retryTask explicitly nulls startedAt so a retry picks up a fresh start time here.
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "running",
      progress: 0,
      reviewStatus: null,
      ...(task.startedAt == null ? { startedAt: new Date() } : {}),
    },
  });

  // 7. Seed a stepOrder=0 "Dispatched to <agent>" execution step so the
  // Kanban execution panel always has at least one timeline entry, even
  // before the running agent starts calling the opcify skill back. The
  // step is recorded as `completed` because the dispatch itself is a
  // point-in-time event — the agent's own steps (from the opcify skill
  // sync callback) start at stepOrder=1 and don't conflict.
  try {
    const now = new Date();
    await prisma.taskExecutionStep.upsert({
      where: { taskId_stepOrder: { taskId, stepOrder: 0 } },
      create: {
        taskId,
        stepOrder: 0,
        agentId: task.agentId,
        agentName: task.agent?.name ?? null,
        roleLabel: task.agent?.role ?? null,
        title: `Dispatched to ${task.agent?.name ?? "agent"}`,
        status: "completed",
        startedAt: now,
        finishedAt: now,
      },
      update: {
        agentId: task.agentId,
        agentName: task.agent?.name ?? null,
        roleLabel: task.agent?.role ?? null,
        title: `Dispatched to ${task.agent?.name ?? "agent"}`,
        status: "completed",
        startedAt: now,
        finishedAt: now,
      },
    });
  } catch (err) {
    log.warn("Failed to seed dispatch step", {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 8. Recompute agent.status so the Agents page shows "running" for
  // both the executor and the orchestrator. Without this, the agent
  // column stays "idle" forever even while OpenClaw runs the work.
  await recomputeAgentStatusForTask(taskId);

  log.info("Task dispatched successfully", { taskId });
  return result;
}
