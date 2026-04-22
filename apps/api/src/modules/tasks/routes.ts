import type { FastifyInstance } from "fastify";
import type { OpenClawAdapter } from "@opcify/core";
import { z } from "zod";
import {
  taskIdParam,
  taskFiltersQuery,
  createTaskBody,
  updateTaskBody,
  updateTaskStatusBody,
  syncExecutionStepsBody,
} from "./schemas.js";
import { createLogger } from "../../logger.js";
import { prisma } from "../../db.js";
import { loadWorkspaceFromDisk } from "../../workspace/WorkspaceConfig.js";
import { processAttachments } from "./attachments.js";
import { eventBroadcaster } from "../events/broadcaster.js";
import {
  requireWorkspaceAuth,
  assertTaskInWorkspace,
  WorkspaceScopeError,
} from "../../middleware/workspace.js";
import {
  enqueueTask,
  cascadeFailDependents,
  emitQueueChanged,
  DispatchManager,
} from "../task-dispatcher/index.js";

const log = createLogger("task_execution");

const workspaceScopeParams = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const workspaceOnlyParams = z.object({
  workspaceId: z.string().min(1),
});

/**
 * Workspace-scoped task routes. Every route is gated by
 * `requireAuth` + `requireWorkspaceMember`, and every handler verifies
 * that the target task lives in the requested workspace.
 */
export async function taskRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
  dispatchManager?: DispatchManager,
) {
  const preHandler = requireWorkspaceAuth;

  app.get("/workspaces/:workspaceId/tasks", { preHandler }, async (req) => {
    const { workspaceId } = workspaceOnlyParams.parse(req.params);
    const queryFilters = taskFiltersQuery.parse(req.query);
    // Force the workspace filter to match the path — callers can't
    // cross-query other workspaces via ?workspaceId=.
    return adapter.listTasks({ ...queryFilters, workspaceId });
  });

  app.post(
    "/workspaces/:workspaceId/tasks",
    { preHandler, bodyLimit: 20 * 1024 * 1024 },
    async (req, reply) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      const data = createTaskBody.parse(req.body);

      // Verify the agent belongs to this workspace before anything else.
      const agent = await prisma.agent.findUnique({
        where: { id: data.agentId },
        select: { workspaceId: true },
      });
      if (!agent || agent.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      if (data.attachments?.length) {
        data.description = await processAttachments(
          data.attachments,
          workspaceId,
          data.description,
        );
      }

      const { attachments: _attachments, ...taskData } = data;
      const task = await adapter.createTask({ ...taskData, workspaceId });

      if (task.workspaceId) {
        eventBroadcaster.emit(task.workspaceId, {
          type: "task:created",
          taskId: task.id,
          title: task.title,
          agentId: task.agentId,
          priority: task.priority as "high" | "medium" | "low",
          status: task.status as "queued",
        });
      }

      if (dispatchManager) {
        const wsId = task.workspaceId ?? "default";
        enqueueTask(
          dispatchManager.getQueue(wsId),
          task.id,
          wsId,
          task.priority,
        ).catch((err) => {
          log.warn("Failed to enqueue task for dispatch", {
            taskId: task.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      return reply.status(201).send(task);
    },
  );

  app.get(
    "/workspaces/:workspaceId/tasks/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceScopeParams.parse(req.params);
      try {
        await assertTaskInWorkspace(id, workspaceId);
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        throw err;
      }
      const task = await adapter.getTask(id);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return task;
    },
  );

  app.patch(
    "/workspaces/:workspaceId/tasks/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceScopeParams.parse(req.params);
      const data = updateTaskBody.parse(req.body);
      try {
        await assertTaskInWorkspace(id, workspaceId);

        if (data.status) {
          const current = await adapter.getTask(id);
          if (current?.status === "stopped") {
            return reply.status(409).send({ error: "Task has been stopped" });
          }
        }

        // If reassigning the agent, ensure the new agent also lives in this workspace.
        if (data.agentId) {
          const agent = await prisma.agent.findUnique({
            where: { id: data.agentId },
            select: { workspaceId: true },
          });
          if (!agent || agent.workspaceId !== workspaceId) {
            return reply.status(404).send({ error: "Agent not found" });
          }
        }

        const task = await adapter.updateTask(id, data);

        if (task.workspaceId) {
          eventBroadcaster.emit(task.workspaceId, {
            type: "task:updated",
            taskId: task.id,
            status: task.status as
              | "queued"
              | "running"
              | "waiting"
              | "done"
              | "failed"
              | "stopped",
            priority: task.priority as "high" | "medium" | "low",
          });
        }

        if (data.agentId && task.status === "queued" && dispatchManager) {
          const wsId = task.workspaceId ?? "default";
          enqueueTask(
            dispatchManager.getQueue(wsId),
            task.id,
            wsId,
            task.priority,
          ).catch((err) => {
            log.warn("Failed to re-enqueue task after reassignment", {
              taskId: task.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        return task;
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        return reply.status(404).send({ error: "Task not found" });
      }
    },
  );

  app.patch(
    "/workspaces/:workspaceId/tasks/:id/status",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceScopeParams.parse(req.params);
      const { status } = updateTaskStatusBody.parse(req.body);
      try {
        await assertTaskInWorkspace(id, workspaceId);

        const current = await adapter.getTask(id);
        if (current?.status === "stopped") {
          return reply.status(409).send({ error: "Task has been stopped" });
        }
        const task = await adapter.updateTaskStatus(id, status);

        if (task.workspaceId) {
          eventBroadcaster.emit(task.workspaceId, {
            type: "task:updated",
            taskId: task.id,
            status: task.status as
              | "queued"
              | "running"
              | "waiting"
              | "done"
              | "failed"
              | "stopped",
          });
        }

        return task;
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        return reply.status(404).send({ error: "Task not found" });
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/tasks/:id/logs",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceScopeParams.parse(req.params);
      try {
        await assertTaskInWorkspace(id, workspaceId);
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        throw err;
      }
      return adapter.getTaskLogs(id);
    },
  );

  app.post(
    "/workspaces/:workspaceId/tasks/:id/archive",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceScopeParams.parse(req.params);
      try {
        await assertTaskInWorkspace(id, workspaceId);
        const task = await prisma.task.update({
          where: { id },
          data: { archivedAt: new Date() },
        });
        if (task.workspaceId) {
          eventBroadcaster.emit(task.workspaceId, {
            type: "task:updated",
            taskId: id,
            status: task.status as "queued" | "running" | "waiting" | "done" | "failed",
          });
        }
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        return reply.status(404).send({ error: "Task not found" });
      }
    },
  );

  app.post(
    "/workspaces/:workspaceId/tasks/:id/unarchive",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceScopeParams.parse(req.params);
      try {
        await assertTaskInWorkspace(id, workspaceId);
        const task = await prisma.task.update({
          where: { id },
          data: { archivedAt: null },
        });
        if (task.workspaceId) {
          eventBroadcaster.emit(task.workspaceId, {
            type: "task:updated",
            taskId: id,
            status: task.status as "queued" | "running" | "waiting" | "done" | "failed",
          });
        }
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        return reply.status(404).send({ error: "Task not found" });
      }
    },
  );

  app.post(
    "/workspaces/:workspaceId/tasks/:id/stop",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceScopeParams.parse(req.params);
      try {
        await assertTaskInWorkspace(id, workspaceId);

        const task = await adapter.getTask(id);
        if (!task) return reply.status(404).send({ error: "Task not found" });

        if (task.status !== "running" && task.status !== "queued") {
          return reply
            .status(400)
            .send({ error: `Cannot stop a task with status "${task.status}"` });
        }

        await adapter.updateTaskStatus(id, "stopped");
        await prisma.task.update({
          where: { id },
          data: { resultSummary: "Stopped by CEO" },
        });
        const updated = await adapter.getTask(id);
        if (!updated) return reply.status(404).send({ error: "Task not found" });

        if (updated.workspaceId) {
          eventBroadcaster.emit(updated.workspaceId, {
            type: "task:updated",
            taskId: id,
            status: "stopped",
          });

          await cascadeFailDependents(id, updated.workspaceId);

          if (updated.agentId) {
            await emitQueueChanged(updated.agentId, updated.workspaceId);
          }
        }

        return updated;
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        return reply.status(500).send({ error: "Failed to stop task" });
      }
    },
  );
}

/**
 * Global task-callback routes used by the OpenClaw gateway.
 *
 * These intentionally stay OUTSIDE the workspace-scoped prefix because
 * the gateway callback URL doesn't include a workspace segment and is
 * authenticated via a per-workspace API key in the Authorization header
 * (see the preHandler below), not via user JWT.
 */
export async function taskCallbackRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
  dispatchManager?: DispatchManager,
) {
  app.post("/tasks/:id/execution-steps/sync", {
    preHandler: async (req, reply) => {
      const auth = req.headers.authorization;
      const bearerToken = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;

      const { id } = taskIdParam.parse(req.params);
      const task = await adapter.getTask(id);
      if (task?.workspaceId) {
        const meta = await loadWorkspaceFromDisk(task.workspaceId);
        if (meta?.opcifyApiKey) {
          if (bearerToken !== meta.opcifyApiKey) {
            return reply.status(401).send({ error: "Unauthorized" });
          }
          return;
        }
      }

      const globalToken = process.env.OPCIFY_CALLBACK_TOKEN;
      if (!globalToken) return;
      if (bearerToken !== globalToken) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    },
    handler: async (req, reply) => {
      const { id } = taskIdParam.parse(req.params);
      const data = syncExecutionStepsBody.parse(req.body);

      const current = await adapter.getTask(id);
      if (current?.status === "stopped") {
        return reply.status(409).send({ error: "Task has been stopped" });
      }

      log.info("Execution step sync received", {
        taskId: id,
        stepCount: data.steps.length,
        finalTaskStatus: data.finalTaskStatus,
      });

      // Auto-resume: if the agent is calling back while the task is still
      // waiting and this is NOT the final callback, the agent has received a
      // CEO message and is actively working again — flip task status back to
      // running so the kanban reflects reality. Cleared waitingReason too.
      if (
        current?.status === "waiting" &&
        !data.finalTaskStatus &&
        data.steps.length > 0
      ) {
        await prisma.task.update({
          where: { id },
          data: { status: "running", waitingReason: null },
        });
      }

      try {
        const steps = await adapter.syncExecutionSteps(id, {
          ...data,
          taskId: id,
        });

        const task = await adapter.getTask(id);
        const workspaceId = task?.workspaceId;

        if (workspaceId) {
          for (const step of data.steps) {
            eventBroadcaster.emit(workspaceId, {
              type: "step:updated",
              taskId: id,
              stepOrder: step.stepOrder,
              status: step.status,
              outputSummary: step.outputSummary,
              agentId: step.agentId ?? null,
              agentName: step.agentName ?? null,
            });
          }

          if (task) {
            const runningStep = data.steps.find((s) => s.status === "running");
            eventBroadcaster.emit(workspaceId, {
              type: "task:updated",
              taskId: id,
              status: task.status as
                | "queued"
                | "running"
                | "waiting"
                | "done"
                | "failed",
              progress: task.progress,
              reviewStatus: task.reviewStatus as
                | "pending"
                | "accepted"
                | "rejected"
                | "followed_up"
                | null,
              currentAgentName: runningStep?.agentName ?? null,
            });
          }

          if (
            data.finalTaskStatus === "done" ||
            data.finalTaskStatus === "failed" ||
            data.finalTaskStatus === "stopped"
          ) {
            if (data.finalTaskStatus === "done") {
              log.info("Task completed via step sync", { taskId: id });

              if (dispatchManager) {
                const dependents = await adapter.listTasks({
                  status: "queued",
                });
                const blocked = (dependents as { blockedByTaskId?: string; id: string; priority: string; maxRetries?: number; workspaceId?: string }[]).filter(
                  (t) => t.blockedByTaskId === id,
                );
                for (const dep of blocked) {
                  const depWs = dep.workspaceId ?? workspaceId;
                  enqueueTask(
                    dispatchManager.getQueue(depWs),
                    dep.id,
                    depWs,
                    dep.priority,
                  ).catch(() => {});
                }
              }
            } else {
              log.warn("Task failed/stopped via step sync", { taskId: id, status: data.finalTaskStatus });
              await cascadeFailDependents(id, workspaceId);
            }

            if (task?.agentId) {
              await emitQueueChanged(task.agentId, workspaceId);
            }
          }
        }

        return steps;
      } catch {
        return reply.status(404).send({ error: "Task not found" });
      }
    },
  });
}
