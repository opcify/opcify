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
  type: z.enum(["income", "expense", "quote"]),
  amount: z.number().positive("Amount must be positive"),
  currency: z.string().default("USD"),
  clientId: z.string().optional(),
  taskId: z.string().optional(),
  category: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  attachmentType: z.enum(["invoice", "receipt"]).optional(),
  attachmentUrl: z.string().optional(),
  notes: z.string().optional(),
  metadata: z.string().optional(),
  entryDate: z.string().optional(),
});

const updateBody = z.object({
  type: z.enum(["income", "expense", "quote"]).optional(),
  amount: z.number().positive("Amount must be positive").optional(),
  currency: z.string().optional(),
  clientId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  attachmentType: z.enum(["invoice", "receipt"]).nullable().optional(),
  attachmentUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  metadata: z.string().nullable().optional(),
  entryDate: z.string().optional(),
});

const listQuery = z.object({
  type: z.enum(["income", "expense", "quote"]).optional(),
  clientId: z.string().optional(),
  category: z.string().optional(),
  q: z.string().optional(),
  sort: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const summaryQuery = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export async function ledgerRoutes(app: FastifyInstance) {
  const preHandler = requireWorkspaceAuth;

  // List ledger entries
  app.get("/workspaces/:workspaceId/ledger", { preHandler }, async (req) => {
    const { workspaceId } = workspaceOnlyParams.parse(req.params);
    const { type, clientId, category, q, sort, dateFrom, dateTo } = listQuery.parse(
      req.query,
    );

    const where: Record<string, unknown> = { workspaceId };
    if (type) where.type = type;
    else where.type = { in: ["income", "expense"] };
    if (clientId) where.clientId = clientId;
    if (category) where.category = category;
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        dateFilter.lte = to;
      }
      where.entryDate = dateFilter;
    }
    if (q) {
      where.OR = [
        { description: { contains: q } },
        { notes: { contains: q } },
        { category: { contains: q } },
      ];
    }

    let orderBy: Record<string, string> = { entryDate: "desc" };
    if (sort === "entryDate_asc") orderBy = { entryDate: "asc" };
    else if (sort === "amount_desc") orderBy = { amount: "desc" };
    else if (sort === "amount_asc") orderBy = { amount: "asc" };

    return prisma.ledgerEntry.findMany({
      where,
      orderBy,
      include: {
        client: { select: { id: true, name: true, company: true } },
        task: { select: { id: true, title: true } },
      },
    });
  });

  // Summary
  app.get("/workspaces/:workspaceId/ledger/summary", { preHandler }, async (req) => {
    const { workspaceId } = workspaceOnlyParams.parse(req.params);
    const { dateFrom, dateTo } = summaryQuery.parse(req.query);

    const where: Record<string, unknown> = { workspaceId };
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        dateFilter.lte = to;
      }
      where.entryDate = dateFilter;
    }

    const entries = await prisma.ledgerEntry.findMany({
      where: { ...where, type: { in: ["income", "expense"] } },
      select: { type: true, amount: true },
    });

    let totalIncome = 0;
    let totalExpense = 0;
    for (const e of entries) {
      if (e.type === "income") totalIncome += e.amount;
      else if (e.type === "expense") totalExpense += e.amount;
    }

    return {
      totalIncome,
      totalExpense,
      net: totalIncome - totalExpense,
    };
  });

  // Get entry detail
  app.get("/workspaces/:workspaceId/ledger/:id", { preHandler }, async (req, reply) => {
    const { workspaceId, id } = paramsSchema.parse(req.params);

    const entry = await prisma.ledgerEntry.findFirst({
      where: { id, workspaceId },
      include: {
        client: { select: { id: true, name: true, company: true } },
        task: { select: { id: true, title: true } },
      },
    });

    if (!entry) {
      return reply.status(404).send({ error: "Ledger entry not found" });
    }

    return entry;
  });

  // Create entry
  app.post("/workspaces/:workspaceId/ledger", { preHandler }, async (req, reply) => {
    const { workspaceId } = workspaceOnlyParams.parse(req.params);
    const body = createBody.parse(req.body);

    const data = {
      ...body,
      clientId: body.clientId || null,
      taskId: body.taskId || null,
      category: body.category || null,
      attachmentType: body.attachmentType || null,
      attachmentUrl: body.attachmentUrl || null,
      notes: body.notes || null,
      entryDate: body.entryDate ? new Date(body.entryDate) : new Date(),
      workspaceId,
    };

    const entry = await prisma.ledgerEntry.create({ data });
    return reply.status(201).send(entry);
  });

  // Update entry
  app.patch("/workspaces/:workspaceId/ledger/:id", { preHandler }, async (req, reply) => {
    const { workspaceId, id } = paramsSchema.parse(req.params);
    const body = updateBody.parse(req.body);

    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        if (key === "entryDate") {
          updateData[key] = new Date(value as string);
        } else {
          updateData[key] = value;
        }
      }
    }

    const result = await prisma.ledgerEntry.updateMany({
      where: { id, workspaceId },
      data: updateData,
    });
    if (result.count === 0) {
      return reply.status(404).send({ error: "Ledger entry not found" });
    }
    return prisma.ledgerEntry.findUnique({ where: { id } });
  });

  // Delete entry
  app.delete(
    "/workspaces/:workspaceId/ledger/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = paramsSchema.parse(req.params);
      const result = await prisma.ledgerEntry.deleteMany({
        where: { id, workspaceId },
      });
      if (result.count === 0) {
        return reply.status(404).send({ error: "Ledger entry not found" });
      }
      return reply.status(204).send();
    },
  );
}
