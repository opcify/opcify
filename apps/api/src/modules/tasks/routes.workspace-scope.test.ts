import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { PrismaAdapter } from "../openclaw-adapter/index.js";
import { taskRoutes, taskCallbackRoutes } from "./routes.js";
import { kanbanRoutes } from "../kanban/routes.js";

let app: FastifyInstance;
let adapter: PrismaAdapter;

let userAId: string;
let userBId: string;
let tokenA: string;

let workspaceA: string;
let workspaceB: string;

let agentA: string;
let agentB: string;

let taskInA: string;
let taskInB: string;

async function resetWorld() {
  await prisma.task.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
  const freshA = await prisma.task.create({
    data: {
      title: "Task A",
      agentId: agentA,
      workspaceId: workspaceA,
    },
  });
  const freshB = await prisma.task.create({
    data: {
      title: "Task B",
      agentId: agentB,
      workspaceId: workspaceB,
    },
  });
  taskInA = freshA.id;
  taskInB = freshB.id;
}

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

  adapter = new PrismaAdapter();
  await taskRoutes(app, adapter);
  await taskCallbackRoutes(app, adapter);
  await kanbanRoutes(app, adapter);
  await app.ready();

  const userA = await prisma.user.create({
    data: { email: "a@example.test", name: "User A" },
  });
  const userB = await prisma.user.create({
    data: { email: "b@example.test", name: "User B" },
  });
  userAId = userA.id;
  userBId = userB.id;

  tokenA = signJwt({ sub: userAId, email: userA.email, name: userA.name });

  const wsA = await prisma.workspace.create({
    data: {
      name: "Workspace A",
      slug: "ws-scope-a",
      status: "ready",
      userId: userAId,
    },
  });
  const wsB = await prisma.workspace.create({
    data: {
      name: "Workspace B",
      slug: "ws-scope-b",
      status: "ready",
      userId: userBId,
    },
  });
  workspaceA = wsA.id;
  workspaceB = wsB.id;

  const aA = await prisma.agent.create({
    data: { name: "Agent A", role: "worker", workspaceId: workspaceA },
  });
  const aB = await prisma.agent.create({
    data: { name: "Agent B", role: "worker", workspaceId: workspaceB },
  });
  agentA = aA.id;
  agentB = aB.id;
});

afterAll(async () => {
  await prisma.task.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
  await prisma.agent.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
  await prisma.workspace.deleteMany({
    where: { id: { in: [workspaceA, workspaceB] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetWorld();
});

describe("workspace-scoped task routes", () => {
  describe("GET /workspaces/:workspaceId/tasks/:id", () => {
    it("returns 200 for a task owned by the caller's workspace", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${workspaceA}/tasks/${taskInA}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(taskInA);
      expect(body.workspaceId).toBe(workspaceA);
    });

    it("returns 404 for a task that exists in a different workspace (no existence leak)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${workspaceA}/tasks/${taskInB}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 403 when the caller is not a member of the path workspace", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${workspaceB}/tasks/${taskInA}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      // requireWorkspaceAuth returns 403 for authenticated-but-not-owner.
      // (404 is reserved for truly-nonexistent workspace ids.)
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 when no Bearer token is provided", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${workspaceA}/tasks/${taskInA}`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /workspaces/:workspaceId/tasks/:id", () => {
    it("rejects cross-workspace update with 404", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/workspaces/${workspaceA}/tasks/${taskInB}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { title: "Hijacked" },
      });
      expect(res.statusCode).toBe(404);
      const task = await prisma.task.findUnique({ where: { id: taskInB } });
      expect(task?.title).toBe("Task B");
    });

    it("allows in-workspace update", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/workspaces/${workspaceA}/tasks/${taskInA}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { title: "Updated Title" },
      });
      expect(res.statusCode).toBe(200);
      const task = await prisma.task.findUnique({ where: { id: taskInA } });
      expect(task?.title).toBe("Updated Title");
    });
  });

  describe("POST /workspaces/:workspaceId/tasks", () => {
    it("creates task in the path workspace", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceA}/tasks`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          title: "New A task",
          agentId: agentA,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.workspaceId).toBe(workspaceA);
    });

    it("rejects creation referencing a foreign agent with 404", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceA}/tasks`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          title: "Cross-scope",
          agentId: agentB,
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("legacy unscoped /tasks/:id route", () => {
    it("no longer exists (404 from Fastify routing, not from handler)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/tasks/${taskInA}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /tasks/:id/execution-steps/sync (callback)", () => {
    it("remains globally routable (not workspace-scoped)", async () => {
      // No callback token configured + no workspace api key → auth falls
      // through, so the request should at least hit the handler (not 404).
      const res = await app.inject({
        method: "POST",
        url: `/tasks/${taskInA}/execution-steps/sync`,
        payload: { steps: [] },
      });
      expect(res.statusCode).not.toBe(404);
    });
  });

  describe("per-workspace API key auth", () => {
    it("rejects a bogus Bearer token with 403 (workspace exists)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${workspaceA}/tasks/${taskInA}`,
        headers: { authorization: "Bearer not-a-real-token" },
      });
      // Workspace exists but the bearer is neither a valid JWT nor a
      // matching per-workspace API key → 403.
      expect(res.statusCode).toBe(403);
    });

    it("returns 404 for a nonexistent workspace even with a valid JWT", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/workspaces/ws_does_not_exist/tasks/${taskInA}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
