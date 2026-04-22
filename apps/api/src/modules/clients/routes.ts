import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireWorkspaceAuth } from "../../middleware/workspace.js";

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const workspaceOnlyParams = z.object({
  workspaceId: z.string().min(1),
});

const createBody = z.object({
  name: z.string().min(1, "Name is required"),
  company: z.string().optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
});

const updateBody = z.object({
  name: z.string().min(1).optional(),
  company: z.string().nullable().optional(),
  email: z
    .string()
    .email("Invalid email format")
    .nullable()
    .optional()
    .or(z.literal("")),
  phone: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
});

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
  sort: z.string().optional(),
});

export async function clientRoutes(app: FastifyInstance) {
  const preHandler = requireWorkspaceAuth;

  // List clients
  app.get("/workspaces/:workspaceId/clients", { preHandler }, async (req) => {
    const { workspaceId } = workspaceOnlyParams.parse(req.params);
    const { q, status, sort } = listQuery.parse(req.query);

    const where: Record<string, unknown> = { workspaceId };

    if (status) {
      where.status = status;
    }

    if (q) {
      where.OR = [
        { name: { contains: q } },
        { company: { contains: q } },
        { email: { contains: q } },
      ];
    }

    let orderBy: Record<string, string> = { updatedAt: "desc" };
    if (sort === "name_asc") orderBy = { name: "asc" };
    else if (sort === "name_desc") orderBy = { name: "desc" };
    else if (sort === "createdAt_desc") orderBy = { createdAt: "desc" };

    return prisma.client.findMany({
      where,
      orderBy,
      include: {
        _count: { select: { tasks: true } },
      },
    });
  });

  // Get client detail
  app.get(
    "/workspaces/:workspaceId/clients/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = paramsSchema.parse(req.params);

      const client = await prisma.client.findFirst({
        where: { id, workspaceId },
        include: {
          _count: { select: { tasks: true } },
          tasks: {
            orderBy: { updatedAt: "desc" },
            take: 5,
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!client) {
        return reply.status(404).send({ error: "Client not found" });
      }

      return {
        ...client,
        recentTasks: client.tasks,
        tasks: undefined,
      };
    },
  );

  // Create client
  app.post(
    "/workspaces/:workspaceId/clients",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      const body = createBody.parse(req.body);

      // Clean empty strings to null
      const data = {
        ...body,
        email: body.email || null,
        company: body.company || null,
        phone: body.phone || null,
        website: body.website || null,
        address: body.address || null,
        notes: body.notes || null,
        workspaceId,
      };

      const client = await prisma.client.create({ data });
      return reply.status(201).send(client);
    },
  );

  // Update client
  app.patch(
    "/workspaces/:workspaceId/clients/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = paramsSchema.parse(req.params);
      const body = updateBody.parse(req.body);

      const result = await prisma.client.updateMany({
        where: { id, workspaceId },
        data: body,
      });
      if (result.count === 0) {
        return reply.status(404).send({ error: "Client not found" });
      }
      return prisma.client.findUnique({ where: { id } });
    },
  );

  // Archive client (DELETE → sets status to archived)
  app.delete(
    "/workspaces/:workspaceId/clients/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = paramsSchema.parse(req.params);

      const result = await prisma.client.updateMany({
        where: { id, workspaceId },
        data: { status: "archived" },
      });
      if (result.count === 0) {
        return reply.status(404).send({ error: "Client not found" });
      }
      return prisma.client.findUnique({ where: { id } });
    },
  );

  // Get tasks for a client
  app.get(
    "/workspaces/:workspaceId/clients/:id/tasks",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = paramsSchema.parse(req.params);

      const client = await prisma.client.findFirst({
        where: { id, workspaceId },
      });
      if (!client) {
        return reply.status(404).send({ error: "Client not found" });
      }

      const tasks = await prisma.task.findMany({
        where: { clientId: id, workspaceId },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          updatedAt: true,
          agent: { select: { id: true, name: true } },
        },
      });

      return tasks;
    },
  );
}
