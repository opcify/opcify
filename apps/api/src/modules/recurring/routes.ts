import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import {
  requireWorkspaceAuth,
  assertRecurringRuleInWorkspace,
  WorkspaceScopeError,
} from "../../middleware/workspace.js";
import { computeNextRun } from "./scheduler.js";

const workspaceOnlyParams = z.object({
  workspaceId: z.string().min(1),
});

const workspaceRuleParams = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const createBody = z
  .object({
    title: z.string().min(1, "Title is required"),
    frequency: z.enum(["hourly", "daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(12).default(1),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    hour: z.number().int().min(0).max(23).optional(),
    minute: z.number().int().min(0).max(59).optional(),
    startDate: z.string().optional(),
    clientId: z.string().optional(),
    agentId: z.string().optional(),
    templateId: z.string().optional(),
    presetData: z
      .object({
        description: z.string().optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
      })
      .optional(),
  })
  .refine(
    (d) => {
      if (d.frequency === "weekly" && d.dayOfWeek == null) return false;
      if (d.frequency === "monthly" && d.dayOfMonth == null) return false;
      return true;
    },
    {
      message:
        "weekly requires dayOfWeek (0-6), monthly requires dayOfMonth (1-31)",
    },
  );

const updateBody = z.object({
  title: z.string().min(1).optional(),
  frequency: z.enum(["hourly", "daily", "weekly", "monthly"]).optional(),
  interval: z.number().int().min(1).max(12).optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  hour: z.number().int().min(0).max(23).nullable().optional(),
  minute: z.number().int().min(0).max(59).nullable().optional(),
  startDate: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  presetData: z
    .object({
      description: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
    })
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
});

async function guardRuleInWorkspace(
  id: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    await assertRecurringRuleInWorkspace(id, workspaceId);
    return true;
  } catch (err) {
    if (err instanceof WorkspaceScopeError) {
      reply.status(404).send({ error: "Recurring rule not found" });
      return false;
    }
    throw err;
  }
}

export async function recurringRoutes(app: FastifyInstance) {
  const preHandler = requireWorkspaceAuth;

  // ── List recurring rules ──────────────────────────────────────────
  app.get(
    "/workspaces/:workspaceId/recurring",
    { preHandler },
    async (req) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);

      return prisma.recurringRule.findMany({
        where: { workspaceId },
        orderBy: { nextRunAt: "asc" },
        include: {
          client: { select: { id: true, name: true } },
        },
      });
    },
  );

  // ── Get single recurring rule ─────────────────────────────────────
  app.get(
    "/workspaces/:workspaceId/recurring/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceRuleParams.parse(req.params);

      if (!(await guardRuleInWorkspace(id, workspaceId, reply))) return;

      return prisma.recurringRule.findUnique({
        where: { id },
        include: {
          client: { select: { id: true, name: true } },
        },
      });
    },
  );

  // ── Create recurring rule ─────────────────────────────────────────
  app.post(
    "/workspaces/:workspaceId/recurring",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      const body = createBody.parse(req.body);

      // Validate clientId belongs to workspace
      if (body.clientId) {
        const client = await prisma.client.findFirst({
          where: { id: body.clientId, workspaceId },
        });
        if (!client) {
          return reply
            .status(400)
            .send({ error: "Client not found in this workspace" });
        }
      }

      // Validate agentId belongs to workspace
      if (body.agentId) {
        const agent = await prisma.agent.findFirst({
          where: { id: body.agentId, workspaceId },
        });
        if (!agent) {
          return reply
            .status(400)
            .send({ error: "Agent not found in this workspace" });
        }
      }

      // Resolve workspace owner's timezone for schedule computation
      const wsForTz = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { owner: { select: { timezone: true } } },
      });
      const ownerTimezone = wsForTz?.owner?.timezone ?? "UTC";

      // If startDate is provided, use it as the first nextRunAt
      const nextRunAt = body.startDate
        ? new Date(body.startDate)
        : computeNextRun(
            {
              frequency: body.frequency,
              interval: body.interval,
              dayOfWeek: body.dayOfWeek ?? null,
              dayOfMonth: body.dayOfMonth ?? null,
              hour: body.hour ?? null,
              minute: body.minute ?? null,
            },
            ownerTimezone,
          );

      const rule = await prisma.recurringRule.create({
        data: {
          title: body.title,
          frequency: body.frequency,
          interval: body.interval,
          dayOfWeek: body.dayOfWeek ?? null,
          dayOfMonth: body.dayOfMonth ?? null,
          hour: body.hour ?? null,
          minute: body.minute ?? null,
          startDate: body.startDate ? new Date(body.startDate) : null,
          clientId: body.clientId || null,
          agentId: body.agentId || null,
          templateId: body.templateId || null,
          presetData: body.presetData ? JSON.stringify(body.presetData) : null,
          nextRunAt,
          workspaceId,
        },
      });

      return reply.status(201).send(rule);
    },
  );

  // ── Update recurring rule ─────────────────────────────────────────
  app.patch(
    "/workspaces/:workspaceId/recurring/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceRuleParams.parse(req.params);
      const body = updateBody.parse(req.body);

      if (!(await guardRuleInWorkspace(id, workspaceId, reply))) return;

      const existing = await prisma.recurringRule.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "Recurring rule not found" });
      }

      // Validate clientId if changing
      if (body.clientId) {
        const client = await prisma.client.findFirst({
          where: { id: body.clientId, workspaceId },
        });
        if (!client) {
          return reply
            .status(400)
            .send({ error: "Client not found in this workspace" });
        }
      }

      // Validate agentId if changing
      if (body.agentId) {
        const agent = await prisma.agent.findFirst({
          where: { id: body.agentId, workspaceId },
        });
        if (!agent) {
          return reply
            .status(400)
            .send({ error: "Agent not found in this workspace" });
        }
      }

      // Recompute nextRunAt if schedule changes
      const frequency = body.frequency ?? existing.frequency;
      const interval = body.interval ?? existing.interval;
      const dayOfWeek =
        body.dayOfWeek !== undefined ? body.dayOfWeek : existing.dayOfWeek;
      const dayOfMonth =
        body.dayOfMonth !== undefined ? body.dayOfMonth : existing.dayOfMonth;
      const ex = existing as Record<string, unknown>;
      const hour =
        body.hour !== undefined ? body.hour : (ex.hour as number | null) ?? null;
      const minute =
        body.minute !== undefined ? body.minute : (ex.minute as number | null) ?? null;

      const scheduleParams = {
        frequency,
        interval,
        dayOfWeek: dayOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        hour: hour ?? null,
        minute: minute ?? null,
      };

      // Resolve workspace owner's timezone
      const wsForTz = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { owner: { select: { timezone: true } } },
      });
      const ownerTimezone = wsForTz?.owner?.timezone ?? "UTC";

      let nextRunAt = existing.nextRunAt;
      if (
        body.frequency ||
        body.interval ||
        body.dayOfWeek !== undefined ||
        body.dayOfMonth !== undefined ||
        body.hour !== undefined ||
        body.minute !== undefined
      ) {
        if (body.startDate) {
          nextRunAt = new Date(body.startDate);
        } else {
          nextRunAt = computeNextRun(scheduleParams, ownerTimezone);
        }
      }

      // Re-activate and reset nextRunAt when resuming a paused rule
      if (body.isActive === true && !existing.isActive) {
        nextRunAt = computeNextRun(scheduleParams, ownerTimezone);
      }

      const rule = await prisma.recurringRule.update({
        where: { id },
        data: {
          ...body,
          presetData:
            body.presetData === null
              ? null
              : body.presetData
                ? JSON.stringify(body.presetData)
                : undefined,
          nextRunAt,
        },
      });

      return rule;
    },
  );

  // ── Delete recurring rule ─────────────────────────────────────────
  app.delete(
    "/workspaces/:workspaceId/recurring/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceRuleParams.parse(req.params);

      if (!(await guardRuleInWorkspace(id, workspaceId, reply))) return;

      try {
        await prisma.recurringRule.delete({ where: { id } });
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: "Recurring rule not found" });
      }
    },
  );

  // ── Manual trigger (for testing / admin) ──────────────────────────
  app.post(
    "/workspaces/:workspaceId/recurring/trigger",
    { preHandler },
    async (_req, reply) => {
      const { processRecurringRules } = await import("./scheduler.js");
      const count = await processRecurringRules();
      return reply.send({ processed: count });
    },
  );
}
