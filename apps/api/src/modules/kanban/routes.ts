import type { FastifyInstance } from "fastify";
import type { OpenClawAdapter } from "@opcify/core";
import { z } from "zod";
import type { OpenClawClient } from "../openclaw-integration/index.js";
import {
  dispatchTaskToOpenClaw,
  DispatchError,
} from "../openclaw-integration/index.js";
import { eventBroadcaster } from "../events/broadcaster.js";
import {
  enqueueTask,
  emitQueueChanged,
  DispatchManager,
  cascadeFailDependents,
} from "../task-dispatcher/index.js";
import { createLogger } from "../../logger.js";
import {
  requireWorkspaceAuth,
  assertTaskInWorkspace,
  WorkspaceScopeError,
} from "../../middleware/workspace.js";
import { chatService } from "../chat/service.js";
import { agentSlug } from "../agents/workspace-sync.js";
import { prisma } from "../../db.js";

const log = createLogger("kanban");

const scopedParams = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const acceptBody = z
  .object({
    reviewNotes: z.string().optional(),
  })
  .optional();

const retryBody = z
  .object({
    reviewNotes: z.string().optional(),
    overrideInstruction: z.string().max(2000).optional(),
  })
  .optional();

const followUpBody = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  agentId: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  plannedDate: z.string().optional(),
});

const resumeBody = z
  .object({
    action: z.enum(["continue", "append", "cancel"]),
    message: z.string().max(4000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "append" && !data.message?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "message is required when action is 'append'",
      });
    }
  });

export async function kanbanRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
  openclawClient?: OpenClawClient,
  dispatchManager?: DispatchManager,
) {
  const preHandler = requireWorkspaceAuth;

  app.get(
    "/workspaces/:workspaceId/kanban/summary",
    { preHandler },
    async (req) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(req.params);
      dispatchManager?.getQueue(workspaceId);
      return adapter.getKanbanSummary(workspaceId);
    },
  );

  app.get(
    "/workspaces/:workspaceId/kanban",
    { preHandler },
    async (req) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(req.params);
      const { date, timezone } = z
        .object({
          date: z.string().optional(),
          timezone: z.string().optional(),
        })
        .parse(req.query);
      dispatchManager?.getQueue(workspaceId);
      const selectedDate = date || new Date().toISOString().slice(0, 10);
      return adapter.getKanbanByDate(selectedDate, workspaceId, timezone);
    },
  );

  // Lean metrics endpoint — no sections, no counts, only timingMetrics.
  // Used by headless consumers (Telegram /stats command, scheduled reports, CLI).
  app.get(
    "/workspaces/:workspaceId/kanban/stats",
    { preHandler },
    async (req) => {
      const { workspaceId } = z
        .object({ workspaceId: z.string().min(1) })
        .parse(req.params);
      const { date, timezone } = z
        .object({
          date: z.string().optional(),
          timezone: z.string().optional(),
        })
        .parse(req.query);
      const selectedDate = date || new Date().toISOString().slice(0, 10);
      return adapter.getKanbanTimingMetrics(workspaceId, selectedDate, timezone);
    },
  );

  // ─── Workspace-scoped task action routes ─────────────────────────

  // Manual start — dispatches task to OpenClaw via the workspace gateway
  app.post(
    "/workspaces/:workspaceId/tasks/:id/start",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = scopedParams.parse(req.params);
      if (!openclawClient) {
        return reply.status(503).send({ error: "OpenClaw client not configured" });
      }
      try {
        await assertTaskInWorkspace(id, workspaceId);
        await dispatchTaskToOpenClaw(id, openclawClient);
        const task = await adapter.getTask(id);
        if (!task) return reply.status(404).send({ error: "Task not found" });

        if (task.workspaceId) {
          eventBroadcaster.emit(task.workspaceId, {
            type: "task:updated",
            taskId: task.id,
            status: "running",
            progress: 0,
          });
          await emitQueueChanged(task.agentId, task.workspaceId);
        }

        return task;
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        if (err instanceof DispatchError) {
          const status =
            err.code === "NOT_FOUND"
              ? 404
              : err.code === "ALREADY_RUNNING"
                ? 409
                : 502;
          return reply.status(status).send({ error: err.message });
        }
        return reply.status(404).send({ error: "Task not found" });
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/tasks/:id/review",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = scopedParams.parse(req.params);
      try {
        await assertTaskInWorkspace(id, workspaceId);
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        throw err;
      }
      const review = await adapter.getTaskReview(id);
      if (!review) return reply.status(404).send({ error: "Task not found" });
      return review;
    },
  );

  app.post(
    "/workspaces/:workspaceId/tasks/:id/accept",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = scopedParams.parse(req.params);
      const body = acceptBody.parse(req.body ?? {});
      try {
        await assertTaskInWorkspace(id, workspaceId);
        const task = await adapter.acceptTask(id, body?.reviewNotes);

        if (task.workspaceId) {
          eventBroadcaster.emit(task.workspaceId, {
            type: "task:updated",
            taskId: task.id,
            status: task.status as "done",
            reviewStatus: "accepted",
          });
        }

        return { ...task, parentAutoAccepted: !!task.sourceTaskId };
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        return reply.status(404).send({ error: "Task not found" });
      }
    },
  );

  app.post(
    "/workspaces/:workspaceId/tasks/:id/retry",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = scopedParams.parse(req.params);
      const body = retryBody.parse(req.body ?? {});
      try {
        await assertTaskInWorkspace(id, workspaceId);
        const task = await adapter.retryTask(
          id,
          body?.reviewNotes,
          body?.overrideInstruction,
        );

        if (task.workspaceId) {
          eventBroadcaster.emit(task.workspaceId, {
            type: "task:updated",
            taskId: task.id,
            status: "queued",
            progress: 0,
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
            log.warn("Failed to enqueue retried task", {
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

  app.post(
    "/workspaces/:workspaceId/tasks/:id/resume",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = scopedParams.parse(req.params);
      const body = resumeBody.parse(req.body ?? {});
      try {
        await assertTaskInWorkspace(id, workspaceId);

        const task = await adapter.getTask(id);
        if (!task) return reply.status(404).send({ error: "Task not found" });
        if (task.status !== "waiting") {
          return reply.status(400).send({
            error: `Cannot resume a task with status "${task.status}"`,
          });
        }

        if (body.action === "cancel") {
          await prisma.task.update({
            where: { id },
            data: {
              status: "stopped",
              blockingQuestion: null,
              waitingReason: null,
              resultSummary: "Cancelled by CEO while waiting for input",
            },
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
        }

        // continue | append — deliver a message into the task's chat session.
        // The agent's process reads the new message, processes it, and its
        // next step-sync callback auto-transitions the task waiting→running
        // (see the sync handler in tasks/routes.ts). No re-enqueue, no queued
        // step — the agent picks up directly.
        const agent = await prisma.agent.findUnique({
          where: { id: task.agentId },
          select: { name: true },
        });
        if (!agent) {
          return reply.status(404).send({ error: "Task agent not found" });
        }

        const message =
          body.action === "append" && body.message
            ? body.message.trim()
            : "[CEO]: Please continue with the task as planned. Resume from where you left off — no new guidance, so make reasonable defaults if you need to.";

        try {
          await chatService.send(workspaceId, agentSlug(agent.name), {
            sessionKey: `task-${id}`,
            message,
          });
        } catch (err) {
          log.warn("Failed to deliver resume message to task session", {
            taskId: id,
            error: err instanceof Error ? err.message : String(err),
          });
          return reply.status(502).send({
            error:
              "Failed to deliver message to the agent session. Try again in a moment.",
          });
        }

        // Clear the question — the CEO has responded. Keep status=waiting until
        // the agent's next callback flips it to running.
        await prisma.task.update({
          where: { id },
          data: { blockingQuestion: null },
        });
        const updated = await adapter.getTask(id);
        if (!updated) return reply.status(404).send({ error: "Task not found" });

        if (updated.workspaceId) {
          eventBroadcaster.emit(updated.workspaceId, {
            type: "task:updated",
            taskId: updated.id,
            status: "waiting",
          });
        }

        return updated;
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        log.warn("Resume failed", {
          taskId: id,
          error: err instanceof Error ? err.message : String(err),
        });
        return reply.status(500).send({ error: "Failed to resume task" });
      }
    },
  );

  app.post(
    "/workspaces/:workspaceId/tasks/:id/follow-up",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = scopedParams.parse(req.params);
      const data = followUpBody.parse(req.body);
      try {
        await assertTaskInWorkspace(id, workspaceId);
        const result = await adapter.followUpTask(id, data);
        const newTask = result.followUpTask;

        if (newTask.workspaceId) {
          eventBroadcaster.emit(newTask.workspaceId, {
            type: "task:created",
            taskId: newTask.id,
            title: newTask.title,
            agentId: newTask.agentId,
            priority: newTask.priority as "high" | "medium" | "low",
            status: newTask.status as "queued",
          });
        }

        if (dispatchManager) {
          const wsId = newTask.workspaceId ?? "default";
          enqueueTask(
            dispatchManager.getQueue(wsId),
            newTask.id,
            wsId,
            newTask.priority,
          ).catch((err) => {
            log.warn("Failed to enqueue follow-up task", {
              taskId: newTask.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Source task not found" });
        }
        return reply.status(404).send({ error: "Source task not found" });
      }
    },
  );

  app.patch(
    "/workspaces/:workspaceId/tasks/:id/planned-date",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = scopedParams.parse(req.params);
      const { date } = (req.body as { date?: string | null }) ?? {};
      try {
        await assertTaskInWorkspace(id, workspaceId);
        return await adapter.updatePlannedDate(id, date ?? null);
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        return reply.status(404).send({ error: "Task not found" });
      }
    },
  );

  app.patch(
    "/workspaces/:workspaceId/tasks/:id/focus",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = scopedParams.parse(req.params);
      const { isFocus } = z.object({ isFocus: z.boolean() }).parse(req.body);
      try {
        await assertTaskInWorkspace(id, workspaceId);
        return await adapter.toggleFocus(id, isFocus);
      } catch (err) {
        if (err instanceof WorkspaceScopeError) {
          return reply.status(404).send({ error: "Task not found" });
        }
        const message = err instanceof Error ? err.message : "Task not found";
        const status = message.includes("Maximum") ? 422 : 404;
        return reply.status(status).send({ error: message });
      }
    },
  );
}
