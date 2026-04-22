import type { FastifyInstance, FastifyReply } from "fastify";
import type { OpenClawAdapter } from "@opcify/core";
import { z } from "zod";
import {
  requireWorkspaceAuth,
  assertTaskInWorkspace,
  assertTaskGroupInWorkspace,
  WorkspaceScopeError,
} from "../../middleware/workspace.js";
import { createTaskGroupFromDecompositionBody } from "./schemas.js";
import {
  enqueueTask,
  DispatchManager,
} from "../task-dispatcher/index.js";
import { eventBroadcaster } from "../events/broadcaster.js";
import { createLogger } from "../../logger.js";

const log = createLogger("task_groups");

const workspaceOnlyParams = z.object({
  workspaceId: z.string().min(1),
});

const workspaceGroupParams = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const workspaceTaskParams = z.object({
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
});

async function guardTaskInWorkspace(
  id: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    await assertTaskInWorkspace(id, workspaceId);
    return true;
  } catch (err) {
    if (err instanceof WorkspaceScopeError) {
      reply.status(404).send({ error: "Task not found" });
      return false;
    }
    throw err;
  }
}

async function guardTaskGroupInWorkspace(
  id: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    await assertTaskGroupInWorkspace(id, workspaceId);
    return true;
  } catch (err) {
    if (err instanceof WorkspaceScopeError) {
      reply.status(404).send({ error: "Task group not found" });
      return false;
    }
    throw err;
  }
}

export async function taskGroupRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
  dispatchManager?: DispatchManager,
) {
  const preHandler = requireWorkspaceAuth;

  app.post(
    "/workspaces/:workspaceId/task-groups/from-decomposition/:taskId",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, taskId } = workspaceTaskParams.parse(req.params);
      const body = createTaskGroupFromDecompositionBody.parse(req.body);

      if (!(await guardTaskInWorkspace(taskId, workspaceId, reply))) return;

      try {
        const result = await adapter.createTaskGroupFromDecomposition(taskId, body);

        for (const task of result.tasks) {
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
              log.warn("Failed to enqueue decomposition task for dispatch", {
                taskId: task.id,
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }

        return reply.status(201).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create task group";
        return reply.status(400).send({ error: message });
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/task-groups",
    { preHandler },
    async (req) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      return adapter.listTaskGroups(workspaceId);
    },
  );

  app.get(
    "/workspaces/:workspaceId/task-groups/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceGroupParams.parse(req.params);
      if (!(await guardTaskGroupInWorkspace(id, workspaceId, reply))) return;
      const group = await adapter.getTaskGroup(id);
      if (!group) return reply.status(404).send({ error: "Task group not found" });
      return group;
    },
  );
}
