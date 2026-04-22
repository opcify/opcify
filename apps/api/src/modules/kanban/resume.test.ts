import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { PrismaAdapter } from "../openclaw-adapter/index.js";
import { kanbanRoutes } from "./routes.js";
import { chatService } from "../chat/service.js";

let app: FastifyInstance;
let adapter: PrismaAdapter;

let userId: string;
let token: string;
let workspaceId: string;
let agentId: string;
let waitingTaskId: string;

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
  await kanbanRoutes(app, adapter);
  await app.ready();

  const user = await prisma.user.create({
    data: { email: "resume-test@example.test", name: "Resume Tester" },
  });
  userId = user.id;
  token = signJwt({ sub: user.id, email: user.email, name: user.name });

  const ws = await prisma.workspace.create({
    data: {
      name: "Resume WS",
      slug: "resume-ws",
      status: "ready",
      userId,
    },
  });
  workspaceId = ws.id;

  const agent = await prisma.agent.create({
    data: { name: "COO", role: "orchestrator", workspaceId },
  });
  agentId = agent.id;
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { workspaceId } });
  await prisma.agent.deleteMany({ where: { workspaceId } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.task.deleteMany({ where: { workspaceId } });
  const t = await prisma.task.create({
    data: {
      title: "Write bike comparison",
      agentId,
      workspaceId,
      status: "waiting",
      waitingReason: "waiting_for_input",
      blockingQuestion: "Budget not in the brief — assume $10k or confirm?",
    },
  });
  waitingTaskId = t.id;
});

describe("POST /workspaces/:workspaceId/tasks/:id/resume", () => {
  describe("action: continue", () => {
    it("sends a CEO-continue marker into the task session, clears blockingQuestion, keeps status=waiting", async () => {
      const sendSpy = vi
        .spyOn(chatService, "send")
        .mockResolvedValue({ sessionKey: `task-${waitingTaskId}` });

      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceId}/tasks/${waitingTaskId}/resume`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: "continue" },
      });
      expect(res.statusCode).toBe(200);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const [, slug, input] = sendSpy.mock.calls[0];
      expect(slug).toBe("coo");
      expect(input.sessionKey).toBe(`task-${waitingTaskId}`);
      expect(input.message).toMatch(/CEO/);
      expect(input.message).toMatch(/continue/i);

      const body = res.json();
      expect(body.status).toBe("waiting");
      expect(body.blockingQuestion).toBeNull();
    });

    it("returns 502 if chat delivery fails (no silent fallback)", async () => {
      vi.spyOn(chatService, "send").mockRejectedValue(new Error("gateway down"));
      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceId}/tasks/${waitingTaskId}/resume`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: "continue" },
      });
      expect(res.statusCode).toBe(502);
      // Question still present — CEO can retry.
      const after = await prisma.task.findUnique({ where: { id: waitingTaskId } });
      expect(after?.blockingQuestion).not.toBeNull();
      expect(after?.status).toBe("waiting");
    });
  });

  describe("action: append", () => {
    it("requires a non-empty message", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceId}/tasks/${waitingTaskId}/resume`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: "append" },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(JSON.stringify(body.issues)).toContain("message");
    });

    it("delivers the CEO's message into the task session and clears blockingQuestion", async () => {
      const sendSpy = vi
        .spyOn(chatService, "send")
        .mockResolvedValue({ sessionKey: `task-${waitingTaskId}` });

      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceId}/tasks/${waitingTaskId}/resume`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: "append", message: "Use $10k budget." },
      });

      expect(res.statusCode).toBe(200);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const [, slug, input] = sendSpy.mock.calls[0];
      expect(slug).toBe("coo");
      expect(input.sessionKey).toBe(`task-${waitingTaskId}`);
      expect(input.message).toBe("Use $10k budget.");

      const body = res.json();
      // Status stays waiting — agent's next callback auto-flips it to running.
      expect(body.status).toBe("waiting");
      expect(body.blockingQuestion).toBeNull();
    });

    it("returns 502 if chat delivery fails (no description fallback)", async () => {
      vi.spyOn(chatService, "send").mockRejectedValue(new Error("gateway down"));
      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceId}/tasks/${waitingTaskId}/resume`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: "append", message: "Use $10k budget." },
      });
      expect(res.statusCode).toBe(502);
      const after = await prisma.task.findUnique({ where: { id: waitingTaskId } });
      expect(after?.description).not.toContain("[CEO response]");
      expect(after?.blockingQuestion).not.toBeNull();
    });
  });

  describe("action: cancel", () => {
    it("sets status to stopped and clears blocking fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceId}/tasks/${waitingTaskId}/resume`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: "cancel" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("stopped");
      expect(body.blockingQuestion).toBeNull();
      expect(body.waitingReason).toBeNull();
      expect(body.resultSummary).toContain("Cancelled by CEO");
    });
  });

  describe("guards", () => {
    it("rejects non-waiting tasks with 400", async () => {
      await prisma.task.update({
        where: { id: waitingTaskId },
        data: { status: "running" },
      });
      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceId}/tasks/${waitingTaskId}/resume`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: "continue" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("running");
    });

    it("rejects unknown action with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspaceId}/tasks/${waitingTaskId}/resume`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: "teleport" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
