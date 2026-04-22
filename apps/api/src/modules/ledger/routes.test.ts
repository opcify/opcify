import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { ledgerRoutes } from "./routes.js";

let app: FastifyInstance;
let userId: string;
let token: string;
let workspaceId: string;
let clientId: string;
let agentId: string;
let taskId: string;

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest("userId", null);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "Validation failed",
        issues: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    return reply.status(500).send({ error: "Internal server error" });
  });

  await ledgerRoutes(app);
  await app.ready();

  const user = await prisma.user.create({
    data: { email: "ledger-owner@example.test", name: "Ledger Owner" },
  });
  userId = user.id;
  token = signJwt({ sub: userId, email: user.email, name: user.name });

  const ws = await prisma.workspace.create({
    data: {
      name: "Ledger Test WS",
      slug: "ledger-test-ws",
      status: "ready",
      userId,
    },
  });
  workspaceId = ws.id;

  const client = await prisma.client.create({
    data: { name: "Acme Corp", workspaceId },
  });
  clientId = client.id;

  const agent = await prisma.agent.create({
    data: { name: "Test Agent", role: "assistant", workspaceId },
  });
  agentId = agent.id;

  const task = await prisma.task.create({
    data: { title: "Test Task", agentId, workspaceId },
  });
  taskId = task.id;
});

afterAll(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { workspaceId } });
  await prisma.task.deleteMany({ where: { workspaceId } });
  await prisma.agent.deleteMany({ where: { workspaceId } });
  await prisma.client.deleteMany({ where: { workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId } });
  await prisma.user.delete({ where: { id: userId } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { workspaceId } });
});

const auth = () => ({ authorization: `Bearer ${token}` });
const base = () => `/workspaces/${workspaceId}/ledger`;

describe("POST /workspaces/:workspaceId/ledger", () => {
  it("should create an income entry", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        type: "income",
        amount: 5000,
        description: "Website project",
        clientId,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.type).toBe("income");
    expect(body.amount).toBe(5000);
    expect(body.clientId).toBe(clientId);
    expect(body.workspaceId).toBe(workspaceId);
  });

  it("should create an expense entry", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        type: "expense",
        amount: 99.99,
        description: "Cloud hosting",
        category: "Software",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("expense");
    expect(res.json().category).toBe("Software");
  });

  it("should reject missing description", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { type: "income", amount: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("should reject non-positive amount", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { type: "expense", amount: -50, description: "Bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("should persist attachment reference", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        type: "income",
        amount: 3000,
        description: "Consulting invoice",
        attachmentType: "invoice",
        attachmentUrl: "https://example.com/invoice.pdf",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.attachmentType).toBe("invoice");
    expect(body.attachmentUrl).toBe("https://example.com/invoice.pdf");
  });

  it("should 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      payload: { type: "income", amount: 100, description: "x" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /workspaces/:workspaceId/ledger", () => {
  it("should list entries scoped by workspace", async () => {
    await prisma.ledgerEntry.createMany({
      data: [
        { type: "income", amount: 1000, description: "A", workspaceId },
        { type: "expense", amount: 200, description: "B", workspaceId },
      ],
    });
    const res = await app.inject({
      method: "GET",
      url: base(),
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(2);
  });

  it("should filter by type", async () => {
    await prisma.ledgerEntry.createMany({
      data: [
        { type: "income", amount: 1000, description: "Inc", workspaceId },
        { type: "expense", amount: 200, description: "Exp", workspaceId },
      ],
    });
    const res = await app.inject({
      method: "GET",
      url: `${base()}?type=income`,
      headers: auth(),
    });
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].type).toBe("income");
  });

  it("should filter by clientId", async () => {
    await prisma.ledgerEntry.createMany({
      data: [
        {
          type: "income",
          amount: 5000,
          description: "Client work",
          clientId,
          workspaceId,
        },
        {
          type: "expense",
          amount: 100,
          description: "No client",
          workspaceId,
        },
      ],
    });
    const res = await app.inject({
      method: "GET",
      url: `${base()}?clientId=${clientId}`,
      headers: auth(),
    });
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].clientId).toBe(clientId);
  });

  it("should search by description", async () => {
    await prisma.ledgerEntry.createMany({
      data: [
        { type: "income", amount: 100, description: "Alpha project", workspaceId },
        { type: "expense", amount: 50, description: "Beta tool", workspaceId },
      ],
    });
    const res = await app.inject({
      method: "GET",
      url: `${base()}?q=Alpha`,
      headers: auth(),
    });
    expect(res.json().length).toBe(1);
  });
});

describe("PATCH /workspaces/:workspaceId/ledger/:id", () => {
  it("should update an entry", async () => {
    const entry = await prisma.ledgerEntry.create({
      data: { type: "income", amount: 100, description: "Old", workspaceId },
    });
    const res = await app.inject({
      method: "PATCH",
      url: `${base()}/${entry.id}`,
      headers: auth(),
      payload: { description: "Updated", amount: 200 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().description).toBe("Updated");
    expect(res.json().amount).toBe(200);
  });

  it("should return 404 for non-existent", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `${base()}/nonexistent`,
      headers: auth(),
      payload: { description: "X" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /workspaces/:workspaceId/ledger/:id", () => {
  it("should delete an entry", async () => {
    const entry = await prisma.ledgerEntry.create({
      data: { type: "expense", amount: 50, description: "Del", workspaceId },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `${base()}/${entry.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);
    const deleted = await prisma.ledgerEntry.findUnique({
      where: { id: entry.id },
    });
    expect(deleted).toBeNull();
  });
});

describe("GET /workspaces/:workspaceId/ledger/summary", () => {
  it("should return correct totals", async () => {
    await prisma.ledgerEntry.createMany({
      data: [
        { type: "income", amount: 5000, description: "A", workspaceId },
        { type: "income", amount: 3000, description: "B", workspaceId },
        { type: "expense", amount: 1000, description: "C", workspaceId },
        { type: "expense", amount: 500, description: "D", workspaceId },
      ],
    });
    const res = await app.inject({
      method: "GET",
      url: `${base()}/summary`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalIncome).toBe(8000);
    expect(body.totalExpense).toBe(1500);
    expect(body.net).toBe(6500);
  });

  it("should return zeros when empty", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${base()}/summary`,
      headers: auth(),
    });
    const body = res.json();
    expect(body.totalIncome).toBe(0);
    expect(body.totalExpense).toBe(0);
    expect(body.net).toBe(0);
  });
});

describe("GET /workspaces/:workspaceId/ledger/:id", () => {
  it("should return entry with client", async () => {
    const entry = await prisma.ledgerEntry.create({
      data: {
        type: "income",
        amount: 2500,
        description: "Client project",
        clientId,
        workspaceId,
      },
    });
    const res = await app.inject({
      method: "GET",
      url: `${base()}/${entry.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.client.name).toBe("Acme Corp");
  });

  it("should return entry with task", async () => {
    const entry = await prisma.ledgerEntry.create({
      data: {
        type: "income",
        amount: 3000,
        description: "Task-linked income",
        taskId,
        workspaceId,
      },
    });
    const res = await app.inject({
      method: "GET",
      url: `${base()}/${entry.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.taskId).toBe(taskId);
    expect(body.task.id).toBe(taskId);
    expect(body.task.title).toBe("Test Task");
  });
});

describe("Ledger-Task relation", () => {
  it("should create entry with no task", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        type: "expense",
        amount: 100,
        description: "No task",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().taskId).toBeNull();
  });

  it("should create entry with taskId", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        type: "income",
        amount: 5000,
        description: "Task revenue",
        taskId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().taskId).toBe(taskId);
  });

  it("should update ledger taskId", async () => {
    const entry = await prisma.ledgerEntry.create({
      data: { type: "income", amount: 100, description: "To link", workspaceId },
    });
    const res = await app.inject({
      method: "PATCH",
      url: `${base()}/${entry.id}`,
      headers: auth(),
      payload: { taskId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().taskId).toBe(taskId);
  });

  it("should clear ledger taskId with null", async () => {
    const entry = await prisma.ledgerEntry.create({
      data: { type: "income", amount: 100, description: "Linked", taskId, workspaceId },
    });
    const res = await app.inject({
      method: "PATCH",
      url: `${base()}/${entry.id}`,
      headers: auth(),
      payload: { taskId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().taskId).toBeNull();
  });

  it("should include task summary in list", async () => {
    await prisma.ledgerEntry.create({
      data: {
        type: "income",
        amount: 1000,
        description: "With task",
        taskId,
        workspaceId,
      },
    });
    const res = await app.inject({
      method: "GET",
      url: base(),
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json();
    expect(entries.length).toBe(1);
    expect(entries[0].task.id).toBe(taskId);
    expect(entries[0].task.title).toBe("Test Task");
  });
});

describe("Ledger quotes", () => {
  it("should create and round-trip a quote entry with metadata", async () => {
    const metadata = JSON.stringify({
      status: "draft",
      lineItems: [{ description: "Plumbing, 2hrs", qty: 2, unitPrice: 120 }],
      shareToken: "tok-abc123",
      quoteNumber: "Q-TEST01",
      validUntil: "2026-05-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        type: "quote",
        amount: 240,
        description: "Plumbing quote",
        clientId,
        metadata,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.type).toBe("quote");
    expect(body.metadata).toBe(metadata);
    expect(JSON.parse(body.metadata).quoteNumber).toBe("Q-TEST01");
  });

  it("should hide quotes from the default list", async () => {
    await prisma.ledgerEntry.createMany({
      data: [
        { type: "income", amount: 100, description: "Inc", workspaceId },
        {
          type: "quote",
          amount: 500,
          description: "Draft quote",
          workspaceId,
          metadata: "{}",
        },
      ],
    });
    const res = await app.inject({ method: "GET", url: base(), headers: auth() });
    const entries = res.json();
    expect(entries.length).toBe(1);
    expect(entries[0].type).toBe("income");
  });

  it("should return quotes when type=quote is requested", async () => {
    await prisma.ledgerEntry.create({
      data: {
        type: "quote",
        amount: 500,
        description: "Draft quote",
        workspaceId,
        metadata: "{}",
      },
    });
    const res = await app.inject({
      method: "GET",
      url: `${base()}?type=quote`,
      headers: auth(),
    });
    const entries = res.json();
    expect(entries.length).toBe(1);
    expect(entries[0].type).toBe("quote");
  });

  it("should exclude quotes from summary totals", async () => {
    await prisma.ledgerEntry.createMany({
      data: [
        { type: "income", amount: 1000, description: "Real income", workspaceId },
        {
          type: "quote",
          amount: 9999,
          description: "Should not count",
          workspaceId,
          metadata: "{}",
        },
      ],
    });
    const res = await app.inject({
      method: "GET",
      url: `${base()}/summary`,
      headers: auth(),
    });
    const body = res.json();
    expect(body.totalIncome).toBe(1000);
    expect(body.totalExpense).toBe(0);
  });
});
