import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { PrismaAdapter } from "../openclaw-adapter/index.js";
import { taskCallbackRoutes } from "./routes.js";

// Covers the waiting→running auto-transition when an agent's step-sync
// callback arrives while the task is still in `waiting` state.

let app: FastifyInstance;
let adapter: PrismaAdapter;
let userId: string;
let workspaceId: string;
let agentId: string;
let taskId: string;

beforeAll(async () => {
  app = Fastify();
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
  await taskCallbackRoutes(app, adapter);
  await app.ready();

  const user = await prisma.user.create({
    data: { email: "sync-resume-test@example.test", name: "Sync Resume Tester" },
  });
  userId = user.id;
  const ws = await prisma.workspace.create({
    data: { name: "Sync Resume WS", slug: "sync-resume-ws", status: "ready", userId },
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
  await prisma.task.deleteMany({ where: { workspaceId } });
  const t = await prisma.task.create({
    data: {
      title: "Resume test",
      agentId,
      workspaceId,
      status: "waiting",
      waitingReason: "waiting_for_input",
      blockingQuestion: null, // already cleared when CEO clicked resume
      executionMode: "orchestrated",
    },
  });
  taskId = t.id;
});

describe("POST /tasks/:id/execution-steps/sync — waiting→running auto-transition", () => {
  it("flips task from waiting to running when an intermediate callback arrives", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/execution-steps/sync`,
      payload: {
        executionMode: "orchestrated",
        steps: [
          {
            stepOrder: 1,
            agentName: "Researcher",
            title: "Research competitors",
            status: "running",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.status).toBe("running");
    expect(task?.waitingReason).toBeNull();
  });

  it("does NOT transition to running when finalTaskStatus is present (terminal callback)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/execution-steps/sync`,
      payload: {
        executionMode: "orchestrated",
        finalTaskStatus: "done",
        steps: [
          {
            stepOrder: 1,
            agentName: "Researcher",
            title: "Research competitors",
            status: "completed",
            outputSummary: "Done",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    // Existing sync-handler path will set task to done on finalTaskStatus via
    // the adapter; we just want to confirm we did NOT incorrectly flip to
    // "running" before that.
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.status).not.toBe("running");
  });

  it("does nothing when task is already running", async () => {
    await prisma.task.update({ where: { id: taskId }, data: { status: "running" } });
    const res = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/execution-steps/sync`,
      payload: {
        executionMode: "orchestrated",
        steps: [
          {
            stepOrder: 1,
            agentName: "Researcher",
            title: "Research competitors",
            status: "running",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.status).toBe("running");
  });

  it("returns 409 for stopped tasks (existing guard still fires first)", async () => {
    await prisma.task.update({ where: { id: taskId }, data: { status: "stopped" } });
    const res = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/execution-steps/sync`,
      payload: {
        executionMode: "orchestrated",
        steps: [
          {
            stepOrder: 1,
            agentName: "Researcher",
            title: "x",
            status: "running",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(409);
  });
});
