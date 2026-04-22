import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../db.js";
import { PrismaAdapter } from "./openclaw-adapter/prisma-adapter.js";
import { dispatchTaskToOpenClaw } from "./openclaw-integration/dispatch.js";
import type { OpenClawClient } from "./openclaw-integration/service.js";

const adapter = new PrismaAdapter();

const stubOpenClawClient: OpenClawClient = {
  execute: async () => ({ success: true }),
};

let workspaceId: string;
let agentId: string;
const createdTaskIds: string[] = [];

beforeAll(async () => {
  const slug = `test-startedat-${Date.now()}`;
  const ws = await prisma.workspace.create({
    data: {
      name: "test-startedat",
      slug,
      type: "blank",
      status: "ready",
    },
  });
  workspaceId = ws.id;
  const agent = await prisma.agent.create({
    data: {
      name: "test-agent",
      role: "researcher",
      description: "",
      model: "stub",
      maxConcurrent: 5,
      workspaceId: ws.id,
    },
  });
  agentId = agent.id;
});

afterAll(async () => {
  for (const id of createdTaskIds) {
    await prisma.taskExecutionStep.deleteMany({ where: { taskId: id } }).catch(() => {});
    await prisma.taskLog.deleteMany({ where: { taskId: id } }).catch(() => {});
    await prisma.task.delete({ where: { id } }).catch(() => {});
  }
  await prisma.agent.delete({ where: { id: agentId } }).catch(() => {});
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
});

async function createTask(title = "startedAt test"): Promise<string> {
  const task = await adapter.createTask({
    title,
    description: "",
    agentId,
    priority: "medium",
  });
  createdTaskIds.push(task.id);
  return task.id;
}

describe("Task.startedAt persistence", () => {
  it("stamps startedAt on first dispatch (queued → running)", async () => {
    const taskId = await createTask();
    const before = await adapter.getTask(taskId);
    expect(before?.startedAt).toBeNull();

    await dispatchTaskToOpenClaw(taskId, stubOpenClawClient);

    const after = await adapter.getTask(taskId);
    expect(after?.startedAt).not.toBeNull();
    expect(after?.status).toBe("running");
  });

  it("preserves startedAt across running→waiting→running transitions", async () => {
    const taskId = await createTask();
    await dispatchTaskToOpenClaw(taskId, stubOpenClawClient);
    const firstStart = (await adapter.getTask(taskId))?.startedAt;
    expect(firstStart).not.toBeNull();

    // Simulate a transition to waiting, then back to running via adapter.startTask
    await adapter.updateTaskStatus(taskId, "waiting");
    const afterWaiting = await adapter.getTask(taskId);
    expect(afterWaiting?.startedAt).toBe(firstStart);

    await adapter.startTask(taskId);
    const afterResume = await adapter.getTask(taskId);
    expect(afterResume?.startedAt).toBe(firstStart);
  });

  it("clears startedAt on retry and refreshes on next dispatch", async () => {
    const taskId = await createTask();
    await dispatchTaskToOpenClaw(taskId, stubOpenClawClient);
    const firstStart = (await adapter.getTask(taskId))?.startedAt;
    expect(firstStart).not.toBeNull();

    // Terminal transition so retry is valid
    await adapter.updateTaskStatus(taskId, "failed");
    await adapter.retryTask(taskId);
    const afterRetry = await adapter.getTask(taskId);
    expect(afterRetry?.startedAt).toBeNull();
    expect(afterRetry?.finishedAt).toBeNull();
    expect(afterRetry?.status).toBe("queued");

    // Small delay so the next timestamp is strictly greater
    await new Promise((r) => setTimeout(r, 20));
    await dispatchTaskToOpenClaw(taskId, stubOpenClawClient);
    const afterRedispatch = await adapter.getTask(taskId);
    expect(afterRedispatch?.startedAt).not.toBeNull();
    expect(
      new Date(afterRedispatch!.startedAt!).getTime(),
    ).toBeGreaterThan(new Date(firstStart!).getTime());
  });
});

describe("syncExecutionSteps and startedAt derivation", () => {
  beforeEach(async () => {
    // Reset reviewStatus lock if prior tests left it
  });

  it("sets task.startedAt from the earliest step startedAt when task is queued", async () => {
    const taskId = await createTask();
    const before = await adapter.getTask(taskId);
    expect(before?.startedAt).toBeNull();

    const earlyStepStart = new Date(Date.now() - 30_000).toISOString();
    await adapter.syncExecutionSteps(taskId, {
      finalTaskStatus: "running",
      steps: [
        {
          stepOrder: 1,
          status: "running",
          agentName: "researcher",
          startedAt: earlyStepStart,
        },
      ],
    });

    const after = await adapter.getTask(taskId);
    expect(after?.startedAt).not.toBeNull();
    expect(new Date(after!.startedAt!).getTime()).toBe(
      new Date(earlyStepStart).getTime(),
    );
  });

  it("does not overwrite startedAt on subsequent step reports", async () => {
    const taskId = await createTask();
    const firstStart = new Date(Date.now() - 60_000).toISOString();
    await adapter.syncExecutionSteps(taskId, {
      finalTaskStatus: "running",
      steps: [
        { stepOrder: 1, status: "running", startedAt: firstStart },
      ],
    });
    const afterFirst = await adapter.getTask(taskId);
    const captured = afterFirst?.startedAt;

    await adapter.syncExecutionSteps(taskId, {
      finalTaskStatus: "running",
      steps: [
        { stepOrder: 1, status: "completed", startedAt: firstStart, finishedAt: new Date().toISOString() },
        { stepOrder: 2, status: "running", startedAt: new Date().toISOString() },
      ],
    });
    const afterSecond = await adapter.getTask(taskId);
    expect(afterSecond?.startedAt).toBe(captured);
  });
});
