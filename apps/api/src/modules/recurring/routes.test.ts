import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { recurringRoutes } from "./routes.js";
import { computeNextRun, processRecurringRules } from "./scheduler.js";

let app: FastifyInstance;
let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;
let authA: { authorization: string };
let authB: { authorization: string };
let workspaceId: string;
let workspaceId2: string;
let clientId: string;
let clientId2: string;

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

  await recurringRoutes(app);
  await app.ready();

  const userA = await prisma.user.create({
    data: { email: "recurring-a@test", name: "Alice" },
  });
  const userB = await prisma.user.create({
    data: { email: "recurring-b@test", name: "Bob" },
  });
  userAId = userA.id;
  userBId = userB.id;
  tokenA = signJwt({ sub: userAId, email: userA.email, name: userA.name });
  tokenB = signJwt({ sub: userBId, email: userB.email, name: userB.name });
  authA = { authorization: `Bearer ${tokenA}` };
  authB = { authorization: `Bearer ${tokenB}` };

  const ws = await prisma.workspace.create({
    data: {
      name: "Recurring Test WS",
      slug: "recurring-test-ws",
      status: "ready",
      userId: userAId,
    },
  });
  workspaceId = ws.id;

  const ws2 = await prisma.workspace.create({
    data: {
      name: "Recurring Test WS2",
      slug: "recurring-test-ws2",
      status: "ready",
      userId: userBId,
    },
  });
  workspaceId2 = ws2.id;

  const client = await prisma.client.create({
    data: { name: "Test Client", workspaceId },
  });
  clientId = client.id;

  const client2 = await prisma.client.create({
    data: { name: "Other Client", workspaceId: workspaceId2 },
  });
  clientId2 = client2.id;

  await prisma.agent.create({
    data: { name: "Test Agent", role: "assistant", workspaceId },
  });
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { workspaceId } });
  await prisma.task.deleteMany({ where: { workspaceId: workspaceId2 } });
  await prisma.recurringRule.deleteMany({ where: { workspaceId } });
  await prisma.recurringRule.deleteMany({ where: { workspaceId: workspaceId2 } });
  await prisma.agent.deleteMany({ where: { workspaceId } });
  await prisma.agent.deleteMany({ where: { workspaceId: workspaceId2 } });
  await prisma.client.deleteMany({ where: { workspaceId } });
  await prisma.client.deleteMany({ where: { workspaceId: workspaceId2 } });
  await prisma.workspace.delete({ where: { id: workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId2 } });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.task.deleteMany({ where: { workspaceId } });
  await prisma.recurringRule.deleteMany({ where: { workspaceId } });
  await prisma.recurringRule.deleteMany({ where: { workspaceId: workspaceId2 } });
});

// ── 1. Create recurring rule ───────────────────────────────────────

describe("POST /recurring", () => {
  it("should create a weekly recurring rule", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Weekly Review",
        frequency: "weekly",
        dayOfWeek: 1, // Monday
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe("Weekly Review");
    expect(body.frequency).toBe("weekly");
    expect(body.dayOfWeek).toBe(1);
    expect(body.isActive).toBe(true);
    expect(body.nextRunAt).toBeTruthy();
  });

  it("should create an hourly recurring rule", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Hourly Check",
        frequency: "hourly",
        interval: 2,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.frequency).toBe("hourly");
    expect(body.interval).toBe(2);
  });

  it("should create a daily recurring rule", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Daily Standup",
        frequency: "daily",
        hour: 9,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.frequency).toBe("daily");
    expect(body.hour).toBe(9);
  });

  it("should create a monthly recurring rule", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Monthly Report",
        frequency: "monthly",
        dayOfMonth: 15,
        interval: 1,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.frequency).toBe("monthly");
    expect(body.dayOfMonth).toBe(15);
  });

  it("should create a rule with clientId", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Client Follow-up",
        frequency: "weekly",
        dayOfWeek: 3,
        clientId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().clientId).toBe(clientId);
  });

  it("should reject weekly without dayOfWeek", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Bad Rule",
        frequency: "weekly",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("should reject monthly without dayOfMonth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Bad Rule",
        frequency: "monthly",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── 7. Reject cross-workspace client link ──────────────────────

  it("should reject cross-workspace clientId", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Cross workspace",
        frequency: "weekly",
        dayOfWeek: 1,
        clientId: clientId2, // belongs to workspaceId2
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Client not found/);
  });
});

// ── 3. Update recurring rule ───────────────────────────────────────

describe("PATCH /recurring/:id", () => {
  it("should update a rule title and schedule", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Original",
        frequency: "weekly",
        dayOfWeek: 1,
      },
    });
    const id = create.json().id;

    const res = await app.inject({
      method: "PATCH",
      url: `/workspaces/${workspaceId}/recurring/${id}`,
      headers: authA,
      payload: {
        title: "Updated",
        dayOfWeek: 5,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Updated");
    expect(res.json().dayOfWeek).toBe(5);
  });

  it("should pause and resume a rule", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "Pausable",
        frequency: "weekly",
        dayOfWeek: 2,
      },
    });
    const id = create.json().id;

    // Pause
    const pause = await app.inject({
      method: "PATCH",
      url: `/workspaces/${workspaceId}/recurring/${id}`,
      headers: authA,
      payload: { isActive: false },
    });
    expect(pause.json().isActive).toBe(false);

    // Resume
    const resume = await app.inject({
      method: "PATCH",
      url: `/workspaces/${workspaceId}/recurring/${id}`,
      headers: authA,
      payload: { isActive: true },
    });
    expect(resume.json().isActive).toBe(true);
  });
});

// ── DELETE ──────────────────────────────────────────────────────────

describe("DELETE /recurring/:id", () => {
  it("should delete a rule", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: {
        title: "To Delete",
        frequency: "weekly",
        dayOfWeek: 0,
      },
    });
    const id = create.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/workspaces/${workspaceId}/recurring/${id}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(204);

    const get = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/recurring/${id}`,
      headers: authA,
    });
    expect(get.statusCode).toBe(404);
  });
});

// ── LIST ────────────────────────────────────────────────────────────

describe("GET /recurring", () => {
  it("should list rules for a workspace", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: { title: "Rule A", frequency: "weekly", dayOfWeek: 1 },
    });
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: { title: "Rule B", frequency: "monthly", dayOfMonth: 10 },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
    });
    expect(res.statusCode).toBe(200);
    const rules = res.json();
    expect(rules.length).toBe(2);
  });

  // ── 6. Workspace isolation ──────────────────────────────────────

  it("should not return rules from another workspace", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: { title: "WS1 Rule", frequency: "weekly", dayOfWeek: 1 },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId2}/recurring`,
      headers: authB,
    });
    expect(res.json().length).toBe(0);
  });

  it("returns 403 when Alice reaches into Bob's recurring rules", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId2}/recurring`,
      headers: authA,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/recurring`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses to PATCH Alice's rule via Bob's workspace path", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/recurring`,
      headers: authA,
      payload: { title: "Alice's rule", frequency: "weekly", dayOfWeek: 1 },
    });
    const id = create.json().id;

    const res = await app.inject({
      method: "PATCH",
      url: `/workspaces/${workspaceId2}/recurring/${id}`,
      headers: authB,
      payload: { title: "Hijacked" },
    });
    expect(res.statusCode).toBe(404);
    const after = await prisma.recurringRule.findUnique({ where: { id } });
    expect(after?.title).toBe("Alice's rule");
  });
});

// ── Scheduler: computeNextRun ──────────────────────────────────────

describe("computeNextRun", () => {
  it("should return a future date for hourly", () => {
    const next = computeNextRun({
      frequency: "hourly",
      interval: 1,
      dayOfWeek: null,
      dayOfMonth: null,
      hour: null,
      minute: null,
    });
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("should return a future date for daily", () => {
    const next = computeNextRun({
      frequency: "daily",
      interval: 1,
      dayOfWeek: null,
      dayOfMonth: null,
      hour: 9,
      minute: null,
    });
    expect(next.getTime()).toBeGreaterThan(Date.now());
    // Default timezone is UTC, so check UTC hours
    expect(next.getUTCHours()).toBe(9);
  });

  it("should return a future date for weekly", () => {
    const next = computeNextRun({
      frequency: "weekly",
      interval: 1,
      dayOfWeek: 1, // Monday
      dayOfMonth: null,
      hour: null,
      minute: null,
    });
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("should return a future date for monthly", () => {
    const next = computeNextRun({
      frequency: "monthly",
      interval: 1,
      dayOfWeek: null,
      dayOfMonth: 15,
      hour: null,
      minute: null,
    });
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("should skip weeks for interval > 1", () => {
    const next1 = computeNextRun({
      frequency: "weekly",
      interval: 1,
      dayOfWeek: 1,
      dayOfMonth: null,
      hour: null,
      minute: null,
    });
    const next2 = computeNextRun({
      frequency: "weekly",
      interval: 2,
      dayOfWeek: 1,
      dayOfMonth: null,
      hour: null,
      minute: null,
    });
    // next2 should be approximately 7 days after next1
    const diff = next2.getTime() - next1.getTime();
    expect(diff).toBeGreaterThanOrEqual(6 * 24 * 60 * 60 * 1000); // at least 6 days more
  });
});

// ── 2. Scheduler picks due rules + 4. nextRunAt updates ────────────

describe("processRecurringRules", () => {
  it("should create a task when rule is due", async () => {
    // Create a rule with nextRunAt in the past
    await prisma.recurringRule.create({
      data: {
        title: "Due Rule",
        frequency: "weekly",
        interval: 1,
        dayOfWeek: 1,
        nextRunAt: new Date(Date.now() - 60_000), // 1 minute ago
        isActive: true,
        workspaceId,
      },
    });

    const count = await processRecurringRules();
    expect(count).toBe(1);

    // Check task was created
    const tasks = await prisma.task.findMany({
      where: { workspaceId, title: "Due Rule" },
    });
    expect(tasks.length).toBe(1);
    expect(tasks[0].status).toBe("queued");
  });

  it("should update nextRunAt after processing", async () => {
    const rule = await prisma.recurringRule.create({
      data: {
        title: "Advance Rule",
        frequency: "weekly",
        interval: 1,
        dayOfWeek: 3,
        nextRunAt: new Date(Date.now() - 60_000),
        isActive: true,
        workspaceId,
      },
    });

    await processRecurringRules();

    const updated = await prisma.recurringRule.findUnique({
      where: { id: rule.id },
    });
    expect(updated!.lastRunAt).not.toBeNull();
    expect(new Date(updated!.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  // ── 5. Paused rule should not fire ──────────────────────────────

  it("should not process paused rules", async () => {
    await prisma.recurringRule.create({
      data: {
        title: "Paused Rule",
        frequency: "weekly",
        interval: 1,
        dayOfWeek: 1,
        nextRunAt: new Date(Date.now() - 60_000),
        isActive: false,
        workspaceId,
      },
    });

    const count = await processRecurringRules();
    expect(count).toBe(0);

    const tasks = await prisma.task.findMany({
      where: { workspaceId, title: "Paused Rule" },
    });
    expect(tasks.length).toBe(0);
  });

  it("should use preset data when creating tasks", async () => {
    await prisma.recurringRule.create({
      data: {
        title: "Preset Rule",
        frequency: "weekly",
        interval: 1,
        dayOfWeek: 1,
        nextRunAt: new Date(Date.now() - 60_000),
        isActive: true,
        workspaceId,
        clientId,
        presetData: JSON.stringify({
          description: "Auto-generated task",
          priority: "high",
        }),
      },
    });

    await processRecurringRules();

    const tasks = await prisma.task.findMany({
      where: { workspaceId, title: "Preset Rule" },
    });
    expect(tasks.length).toBe(1);
    expect(tasks[0].description).toBe("Auto-generated task");
    expect(tasks[0].priority).toBe("high");
    expect(tasks[0].clientId).toBe(clientId);
  });
});
