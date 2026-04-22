import type { FastifyInstance, FastifyReply } from "fastify";
import type { OpenClawAdapter } from "@opcify/core";
import { z } from "zod";
import {
  requireWorkspaceAuth,
  assertAgentInWorkspace,
  assertTaskInWorkspace,
  assertTaskTemplateWritableInWorkspace,
  WorkspaceScopeError,
} from "../../middleware/workspace.js";
import {
  taskTemplateFiltersQuery,
  createTaskFromTemplateBody,
  saveTaskTemplateBody,
  saveTemplateFromTaskBody,
} from "./schemas.js";
import {
  enqueueTask,
  DispatchManager,
} from "../task-dispatcher/index.js";
import { eventBroadcaster } from "../events/broadcaster.js";
import { createLogger } from "../../logger.js";
import { prisma } from "../../db.js";
import { processAttachments } from "../tasks/attachments.js";
import { builtInTaskTemplates } from "./built-in-templates.js";

const log = createLogger("task_templates");

const workspaceOnlyParams = z.object({
  workspaceId: z.string().min(1),
});

const workspaceTemplateParams = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const workspaceTaskParams = z.object({
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
});

async function guardAgentInWorkspace(
  agentId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    await assertAgentInWorkspace(agentId, workspaceId);
    return true;
  } catch (err) {
    if (err instanceof WorkspaceScopeError) {
      reply.status(404).send({ error: "Agent not found" });
      return false;
    }
    throw err;
  }
}

async function guardTaskInWorkspace(
  taskId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    await assertTaskInWorkspace(taskId, workspaceId);
    return true;
  } catch (err) {
    if (err instanceof WorkspaceScopeError) {
      reply.status(404).send({ error: "Task not found" });
      return false;
    }
    throw err;
  }
}

/**
 * Readable = built-in template (hardcoded, workspace-agnostic) OR a user
 * template owned by the caller's workspace. Built-ins live in
 * `builtInTaskTemplates` and never touch the DB — they must be permitted
 * without a DB lookup, otherwise POST on a ttpl-* id's create-task route
 * would always 404.
 */
async function guardTemplateReadable(
  templateId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (builtInTaskTemplates.some((t) => t.id === templateId)) {
    return true;
  }
  const existsInDb = await prisma.taskTemplate.findUnique({
    where: { id: templateId },
    select: { workspaceId: true },
  });
  if (!existsInDb) {
    reply.status(404).send({ error: "Task template not found" });
    return false;
  }
  if (existsInDb.workspaceId !== null && existsInDb.workspaceId !== workspaceId) {
    reply.status(404).send({ error: "Task template not found" });
    return false;
  }
  return true;
}

async function guardTemplateWritable(
  templateId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    await assertTaskTemplateWritableInWorkspace(templateId, workspaceId);
    return true;
  } catch (err) {
    if (err instanceof WorkspaceScopeError) {
      reply.status(404).send({ error: "Task template not found" });
      return false;
    }
    throw err;
  }
}

export async function taskTemplateRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
  dispatchManager?: DispatchManager,
) {
  const preHandler = requireWorkspaceAuth;

  app.get(
    "/workspaces/:workspaceId/task-templates",
    { preHandler },
    async (req) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      const { q, category } = taskTemplateFiltersQuery.parse(req.query);

      let templates = await adapter.listTaskTemplates(workspaceId);
      if (q) {
        const lower = q.toLowerCase();
        templates = templates.filter(
          (t) =>
            t.name.toLowerCase().includes(lower) ||
            t.description.toLowerCase().includes(lower) ||
            t.defaultTags.some((tag) => tag.toLowerCase().includes(lower)),
        );
      }
      if (category) {
        templates = templates.filter((t) => t.category === category);
      }
      return templates;
    },
  );

  app.get(
    "/workspaces/:workspaceId/task-templates/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceTemplateParams.parse(req.params);
      if (!(await guardTemplateReadable(id, workspaceId, reply))) return;
      const template = await adapter.getTaskTemplate(id);
      if (!template)
        return reply.status(404).send({ error: "Template not found" });
      return template;
    },
  );

  app.post(
    "/workspaces/:workspaceId/task-templates/:id/create-task",
    { preHandler, bodyLimit: 20 * 1024 * 1024 },
    async (req, reply) => {
      const { workspaceId, id } = workspaceTemplateParams.parse(req.params);
      const data = createTaskFromTemplateBody.parse(req.body);

      if (!(await guardTemplateReadable(id, workspaceId, reply))) return;

      // The target agent must belong to the caller's workspace — otherwise
      // a hostile caller could spawn tasks in another workspace by passing a
      // foreign agentId.
      if (data.agentId) {
        if (!(await guardAgentInWorkspace(data.agentId, workspaceId, reply))) {
          return;
        }
      }

      if (data.attachments?.length && data.agentId) {
        data.description = await processAttachments(
          data.attachments,
          workspaceId,
          data.description,
        );
      }

      try {
        const { attachments: _attachments, ...taskData } = data;
        const task = await adapter.createTaskFromTemplate({
          templateId: id,
          ...taskData,
        });

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
            log.warn("Failed to enqueue template task for dispatch", {
              taskId: task.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        return reply.status(201).send(task);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to create task";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post(
    "/workspaces/:workspaceId/task-templates",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      const data = saveTaskTemplateBody.parse(req.body);

      if (data.defaultAgentId) {
        if (!(await guardAgentInWorkspace(data.defaultAgentId, workspaceId, reply))) {
          return;
        }
      }

      const template = await adapter.saveTaskTemplate({ ...data, workspaceId });
      return reply.status(201).send(template);
    },
  );

  app.post(
    "/workspaces/:workspaceId/task-templates/from-task/:taskId",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, taskId } = workspaceTaskParams.parse(req.params);
      const body = saveTemplateFromTaskBody.parse(req.body ?? {});

      if (!(await guardTaskInWorkspace(taskId, workspaceId, reply))) return;

      try {
        const template = await adapter.saveTemplateFromTask(taskId, body);
        return reply.status(201).send(template);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to create template";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.delete(
    "/workspaces/:workspaceId/task-templates/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceTemplateParams.parse(req.params);

      if (!(await guardTemplateWritable(id, workspaceId, reply))) return;

      try {
        await adapter.deleteTaskTemplate(id);
        return reply.status(204).send();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to delete template";
        return reply.status(400).send({ error: msg });
      }
    },
  );
}
