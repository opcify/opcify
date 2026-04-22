import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { taskGroupRoutes } from "./routes.js";
import { PrismaAdapter } from "../openclaw-adapter/prisma-adapter.js";

let app: FastifyInstance;
let adapter: PrismaAdapter;
let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;
let workspaceA: string;
let workspaceB: string;
let agentA: string;
let agentB: string;
let taskInA: string;
let taskInB: string;
let authA: { authorization: string };
let authB: { authorization: string };

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest("userId", null);
  adapter = new PrismaAdapter();

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

  await taskGroupRoutes(app, adapter);
  await app.ready();

  const userA = await prisma.user.create({
    data: { email: "tg-a@test", name: "Alice" },
  });
  const userB = await prisma.user.create({
    data: { email: "tg-b@test", name: "Bob" },
  });
  userAId = userA.id;
  userBId = userB.id;
  tokenA = signJwt({ sub: userAId, email: userA.email, name: userA.name });
  tokenB = signJwt({ sub: userBId, email: userB.email, name: userB.name });
  authA = { authorization: `Bearer ${tokenA}` };
  authB = { authorization: `Bearer ${tokenB}` };

  const wsA = await prisma.workspace.create({
    data: {
      name: "Groups WS A",
      slug: "groups-ws-a",
      status: "ready",
      userId: userAId,
    },
  });
  const wsB = await prisma.workspace.create({
    data: {
      name: "Groups WS B",
      slug: "groups-ws-b",
      status: "ready",
      userId: userBId,
    },
  });
  workspaceA = wsA.id;
  workspaceB = wsB.id;

  const aA = await prisma.agent.create({
    data: { name: "GroupBotA", role: "worker", workspaceId: workspaceA },
  });
  const aB = await prisma.agent.create({
    data: { name: "GroupBotB", role: "worker", workspaceId: workspaceB },
  });
  agentA = aA.id;
  agentB = aB.id;
});

afterAll(async () => {
  await prisma.task.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
  await prisma.taskGroup.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
  await prisma.agent.deleteMany({ where: { id: { in: [agentA, agentB] } } });
  await prisma.workspace.deleteMany({
    where: { id: { in: [workspaceA, workspaceB] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.task.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
  await prisma.taskGroup.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });

  const tA = await prisma.task.create({
    data: {
      title: "Source task A",
      agentId: agentA,
      workspaceId: workspaceA,
    },
  });
  const tB = await prisma.task.create({
    data: {
      title: "Source task B",
      agentId: agentB,
      workspaceId: workspaceB,
    },
  });
  taskInA = tA.id;
  taskInB = tB.id;
});

// ─── Happy path ─────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/task-groups/from-decomposition/:taskId", () => {
  it("creates a group + subtasks inside the caller's workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/task-groups/from-decomposition/${taskInA}`,
      headers: authA,
      payload: {
        tasks: [
          { title: "Subtask 1", agentId: agentA },
          { title: "Subtask 2", agentId: agentA },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.taskGroup.workspaceId).toBe(workspaceA);
    expect(body.tasks.length).toBe(2);
    expect(body.tasks.every((t: { workspaceId: string }) => t.workspaceId === workspaceA)).toBe(true);
  });
});

describe("GET /workspaces/:workspaceId/task-groups", () => {
  it("only lists groups for the caller's workspace", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/task-groups/from-decomposition/${taskInA}`,
      headers: authA,
      payload: { tasks: [{ title: "In A", agentId: agentA }] },
    });
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceB}/task-groups/from-decomposition/${taskInB}`,
      headers: authB,
      payload: { tasks: [{ title: "In B", agentId: agentB }] },
    });

    const resA = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/task-groups`,
      headers: authA,
    });
    expect(resA.statusCode).toBe(200);
    const listA = resA.json();
    expect(listA.length).toBe(1);
    expect(listA[0].workspaceId).toBe(workspaceA);
  });
});

// ─── Cross-workspace isolation ─────────────────────────────────

describe("workspace isolation", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/task-groups`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when Alice reaches into Bob's workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceB}/task-groups`,
      headers: authA,
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses to create a decomposition from Bob's source task", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/task-groups/from-decomposition/${taskInB}`,
      headers: authA,
      payload: { tasks: [{ title: "Hijack", agentId: agentA }] },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when GET-ting a foreign group via the wrong workspace", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceB}/task-groups/from-decomposition/${taskInB}`,
      headers: authB,
      payload: { tasks: [{ title: "In B", agentId: agentB }] },
    });
    const groupId = create.json().taskGroup.id;

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/task-groups/${groupId}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });

  it("old /task-groups route is gone", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/task-groups",
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });
});
