import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../db.js";
import { backupWorkspace, restoreWorkspace, BACKUP_VERSION, type WorkspaceBackup } from "./backup-restore.js";

// ─── Test Helpers ───────────────────────────────────────────────────

async function createTestWorkspace() {
  const workspace = await prisma.workspace.create({
    data: {
      name: "Test Workspace",
      slug: `test-ws-${Date.now()}`,
      description: "Integration test workspace",
      type: "starter",
      status: "ready",
      lastProvisionedAt: new Date(),
    },
  });

  // Create skills
  const skillWeb = await prisma.skill.upsert({
    where: { key: "web-search" },
    create: { key: "web-search", name: "Web Search", description: "Search the web", category: "research" },
    update: {},
  });
  const skillCode = await prisma.skill.upsert({
    where: { key: "code-exec" },
    create: { key: "code-exec", name: "Code Execution", description: "Execute code", category: "development" },
    update: {},
  });

  // Create agents
  const agent1 = await prisma.agent.create({
    data: {
      name: "Research Agent",
      role: "researcher",
      description: "Conducts research",
      model: "gpt-5.4",
      agentConfig: "You are a research agent.",
      workspaceId: workspace.id,
    },
  });
  const agent2 = await prisma.agent.create({
    data: {
      name: "Writer Agent",
      role: "writer",
      description: "Writes content",
      model: "gpt-5.4",
      workspaceId: workspace.id,
    },
  });

  // Install skills on agents
  await prisma.agentSkill.create({
    data: { agentId: agent1.id, skillId: skillWeb.id },
  });
  await prisma.agentSkill.create({
    data: { agentId: agent2.id, skillId: skillCode.id },
  });

  // Create a client
  const client = await prisma.client.create({
    data: {
      name: "Acme Corp",
      company: "Acme",
      email: "contact@acme.com",
      workspaceId: workspace.id,
    },
  });

  // Create task group
  const taskGroup = await prisma.taskGroup.create({
    data: {
      title: "Blog Launch",
      description: "Launch the company blog",
      type: "manual",
      workspaceId: workspace.id,
    },
  });

  // Create tasks with various states
  const task1 = await prisma.task.create({
    data: {
      title: "Research competitors",
      description: "Find top 10 competitor blogs",
      agentId: agent1.id,
      status: "done",
      priority: "high",
      progress: 100,
      reviewStatus: "pending",
      resultSummary: "Found 10 competitor blogs",
      resultContent: "Detailed competitor analysis...",
      taskGroupId: taskGroup.id,
      executionMode: "manual_workflow",
      workspaceId: workspace.id,
      finishedAt: new Date(),
    },
  });

  const task2 = await prisma.task.create({
    data: {
      title: "Write first draft",
      description: "Draft the blog post using research",
      agentId: agent2.id,
      status: "queued",
      priority: "medium",
      sourceTaskId: task1.id,
      taskGroupId: taskGroup.id,
      executionMode: "single",
      workspaceId: workspace.id,
      isFocus: true,
    },
  });

  const task3 = await prisma.task.create({
    data: {
      title: "Blocked task",
      description: "Waiting for draft",
      agentId: agent1.id,
      status: "waiting",
      priority: "low",
      waitingReason: "waiting_for_dependency",
      blockedByTaskId: task2.id,
      workspaceId: workspace.id,
      executionMode: "single",
    },
  });

  // Update task group sourceTaskId
  await prisma.taskGroup.update({
    where: { id: taskGroup.id },
    data: { sourceTaskId: task1.id },
  });

  // Create execution steps for task1
  await prisma.taskExecutionStep.createMany({
    data: [
      {
        taskId: task1.id,
        stepOrder: 1,
        agentId: agent1.id,
        agentName: "Research Agent",
        roleLabel: "Research",
        title: "Gather data",
        instruction: "Find competitor blogs",
        status: "completed",
        outputSummary: "Found 10 blogs",
        outputContent: "Full output here...",
        startedAt: new Date(Date.now() - 60000),
        finishedAt: new Date(Date.now() - 30000),
      },
      {
        taskId: task1.id,
        stepOrder: 2,
        agentId: agent2.id,
        agentName: "Writer Agent",
        roleLabel: "Summarize",
        title: "Write summary",
        instruction: "Summarize findings",
        status: "completed",
        outputSummary: "Summary complete",
        startedAt: new Date(Date.now() - 30000),
        finishedAt: new Date(),
      },
    ],
  });

  // Create task logs
  await prisma.taskLog.createMany({
    data: [
      { taskId: task1.id, level: "info", message: "Starting research..." },
      { taskId: task1.id, level: "info", message: "Research complete." },
    ],
  });

  // Create a note
  await prisma.note.create({
    data: {
      title: "Project Notes",
      contentMarkdown: "Some notes here.",
      workspaceId: workspace.id,
      clientId: client.id,
    },
  });

  // Create a task template
  await prisma.taskTemplate.create({
    data: {
      key: `test-tpl-${Date.now()}`,
      name: "Test Template",
      category: "operations",
      description: "A test template",
      defaultTitle: "Do the thing",
      defaultDescription: "Details here",
      workspaceId: workspace.id,
    },
  });

  return {
    workspace,
    agents: [agent1, agent2],
    skills: [skillWeb, skillCode],
    client,
    taskGroup,
    tasks: [task1, task2, task3],
  };
}

async function cleanupWorkspace(workspaceId: string) {
  const tasks = await prisma.task.findMany({ where: { workspaceId }, select: { id: true } });
  const taskIds = tasks.map((t) => t.id);

  await prisma.task.updateMany({
    where: { workspaceId },
    data: { sourceTaskId: null, blockedByTaskId: null },
  });
  await prisma.taskGroup.updateMany({
    where: { workspaceId },
    data: { sourceTaskId: null },
  });

  if (taskIds.length > 0) {
    await prisma.taskExecutionStep.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.taskLog.deleteMany({ where: { taskId: { in: taskIds } } });
  }
  await prisma.task.deleteMany({ where: { workspaceId } });
  await prisma.taskGroup.deleteMany({ where: { workspaceId } });
  await prisma.note.deleteMany({ where: { workspaceId } });
  await prisma.client.deleteMany({ where: { workspaceId } });
  await prisma.taskTemplate.deleteMany({ where: { workspaceId } });
  const agents = await prisma.agent.findMany({ where: { workspaceId }, select: { id: true } });
  if (agents.length > 0) {
    await prisma.agentSkill.deleteMany({ where: { agentId: { in: agents.map((a) => a.id) } } });
  }
  await prisma.agent.deleteMany({ where: { workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId } });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Workspace Backup & Restore (v2)", () => {
  let testData: Awaited<ReturnType<typeof createTestWorkspace>>;
  let backup: WorkspaceBackup;
  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    testData = await createTestWorkspace();
    createdWorkspaceIds.push(testData.workspace.id);
  });

  afterAll(async () => {
    for (const id of createdWorkspaceIds) {
      try {
        await cleanupWorkspace(id);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ── Backup Tests ──

  describe("backupWorkspace", () => {
    it("exports v2 format with config and data sections", async () => {
      backup = await backupWorkspace(testData.workspace.id);

      expect(backup.backupVersion).toBe(BACKUP_VERSION);
      expect(backup.exportedAt).toBeTruthy();
      expect(backup.config).toBeDefined();
      expect(backup.data).toBeDefined();
      expect(backup.config.workspace.name).toBe("Test Workspace");
    });

    it("config.agents includes skill keys per agent", () => {
      expect(backup.config.agents).toHaveLength(2);
      const researcher = backup.config.agents.find((a) => a.name === "Research Agent");
      expect(researcher?.skillKeys).toContain("web-search");
      expect(researcher?.agentConfig).toBe("You are a research agent.");
    });

    it("config.skills includes all skill keys", () => {
      expect(backup.config.skills).toContain("web-search");
      expect(backup.config.skills).toContain("code-exec");
    });

    it("config.taskTemplates includes custom templates", () => {
      expect(backup.config.taskTemplates.length).toBeGreaterThanOrEqual(1);
      expect(backup.config.taskTemplates.some((t) => t.name === "Test Template")).toBe(true);
    });

    it("data includes tasks with agent names", () => {
      expect(backup.data!.tasks).toHaveLength(3);
      const doneTask = backup.data!.tasks.find((t) => t.title === "Research competitors");
      expect(doneTask?.agentName).toBe("Research Agent");
      expect(doneTask?.status).toBe("done");
    });

    it("data includes clients", () => {
      expect(backup.data!.clients).toHaveLength(1);
      expect(backup.data!.clients[0].name).toBe("Acme Corp");
    });

    it("data includes notes with client references by name", () => {
      expect(backup.data!.notes).toHaveLength(1);
      expect(backup.data!.notes[0].clientName).toBe("Acme Corp");
    });

    it("data includes execution steps and logs", () => {
      expect(backup.data!.taskExecutionSteps).toHaveLength(2);
      expect(backup.data!.taskLogs).toHaveLength(2);
    });

    it("throws for non-existent workspace", async () => {
      await expect(backupWorkspace("nonexistent")).rejects.toThrow("Workspace not found");
    });
  });

  // ── Full Restore Tests ──

  describe("restoreWorkspace (full)", () => {
    let restoreResult: Awaited<ReturnType<typeof restoreWorkspace>>;

    it("creates a new workspace with mode=full", async () => {
      restoreResult = await restoreWorkspace(backup, "Test Workspace Restored");
      createdWorkspaceIds.push(restoreResult.workspaceId);

      expect(restoreResult.mode).toBe("full");
      expect(restoreResult.workspaceId).not.toBe(testData.workspace.id);

      const ws = await prisma.workspace.findUnique({ where: { id: restoreResult.workspaceId } });
      expect(ws?.name).toBe("Test Workspace Restored");
      expect(ws?.status).toBe("ready");
    });

    it("syncs agent workspace files to disk", async () => {
      const { existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { getDataDir } = await import("../../workspace/WorkspaceConfig.js");
      const { agentSlug } = await import("../agents/workspace-sync.js");

      const agentDir = join(getDataDir(restoreResult.workspaceId), "agents", agentSlug("Research Agent"), "agent");
      expect(existsSync(agentDir)).toBe(true);
      expect(existsSync(join(agentDir, "SOUL.md"))).toBe(true);
      expect(existsSync(join(agentDir, "AGENTS.md"))).toBe(true);

      // openclaw.json should have the agents
      const configPath = join(getDataDir(restoreResult.workspaceId), "openclaw.json");
      expect(existsSync(configPath)).toBe(true);
    });

    it("restores agents with skill assignments", async () => {
      const agents = await prisma.agent.findMany({
        where: { workspaceId: restoreResult.workspaceId },
        include: { skills: { include: { skill: true } } },
      });
      expect(agents).toHaveLength(2);
      const researcher = agents.find((a) => a.name === "Research Agent");
      expect(researcher?.skills.some((s) => s.skill.key === "web-search")).toBe(true);
    });

    it("restores tasks with cross-references", async () => {
      const tasks = await prisma.task.findMany({ where: { workspaceId: restoreResult.workspaceId } });
      expect(tasks).toHaveLength(3);

      const followUp = tasks.find((t) => t.title === "Write first draft");
      const source = tasks.find((t) => t.title === "Research competitors");
      expect(followUp?.sourceTaskId).toBe(source?.id);

      const blocked = tasks.find((t) => t.title === "Blocked task");
      const blocker = tasks.find((t) => t.title === "Write first draft");
      expect(blocked?.blockedByTaskId).toBe(blocker?.id);
    });

    it("restores clients", async () => {
      const clients = await prisma.client.findMany({ where: { workspaceId: restoreResult.workspaceId } });
      expect(clients).toHaveLength(1);
      expect(clients[0].name).toBe("Acme Corp");
    });

    it("restores notes linked to clients", async () => {
      const notes = await prisma.note.findMany({ where: { workspaceId: restoreResult.workspaceId } });
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("Project Notes");
      expect(notes[0].clientId).toBeTruthy();
    });

    it("restores execution steps and logs", async () => {
      const tasks = await prisma.task.findMany({ where: { workspaceId: restoreResult.workspaceId } });
      const doneTask = tasks.find((t) => t.title === "Research competitors");
      const steps = await prisma.taskExecutionStep.findMany({ where: { taskId: doneTask!.id } });
      expect(steps).toHaveLength(2);
      const logs = await prisma.taskLog.findMany({ where: { taskId: doneTask!.id } });
      expect(logs).toHaveLength(2);
    });

    it("reports correct counts", () => {
      expect(restoreResult.counts.agents).toBe(2);
      expect(restoreResult.counts.tasks).toBe(3);
      expect(restoreResult.counts.clients).toBe(1);
      expect(restoreResult.counts.notes).toBe(1);
    });
  });

  // ── Config-Only Restore Tests ──

  describe("restoreWorkspace (config-only)", () => {
    it("restores only config when data section is absent", async () => {
      const configOnly: WorkspaceBackup = {
        backupVersion: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        config: backup.config,
        // no data section
      };

      const result = await restoreWorkspace(configOnly, "Config Only WS");
      createdWorkspaceIds.push(result.workspaceId);

      expect(result.mode).toBe("config-only");

      // Agents should exist
      const agents = await prisma.agent.findMany({ where: { workspaceId: result.workspaceId } });
      expect(agents).toHaveLength(2);

      // No tasks
      const tasks = await prisma.task.findMany({ where: { workspaceId: result.workspaceId } });
      expect(tasks).toHaveLength(0);

      // No clients
      const clients = await prisma.client.findMany({ where: { workspaceId: result.workspaceId } });
      expect(clients).toHaveLength(0);
    });
  });

  // ── Roundtrip Test ──

  describe("backup -> restore roundtrip", () => {
    it("produces matching data after roundtrip", async () => {
      const result = await restoreWorkspace(backup, "Roundtrip WS");
      createdWorkspaceIds.push(result.workspaceId);

      const roundtrip = await backupWorkspace(result.workspaceId);

      expect(roundtrip.config.agents.length).toBe(backup.config.agents.length);
      expect(roundtrip.data!.tasks.length).toBe(backup.data!.tasks.length);
      expect(roundtrip.data!.clients.length).toBe(backup.data!.clients.length);
      expect(roundtrip.data!.notes.length).toBe(backup.data!.notes.length);

      expect(roundtrip.config.agents.map((a) => a.name).sort()).toEqual(
        backup.config.agents.map((a) => a.name).sort(),
      );
    });
  });

  // ── Validation Tests ──

  describe("validation", () => {
    it("rejects malformed backup", async () => {
      await expect(restoreWorkspace({} as WorkspaceBackup)).rejects.toThrow();
    });

    it("rejects duplicate workspace name", async () => {
      await expect(restoreWorkspace(backup, "Test Workspace")).rejects.toThrow("already exists");
    });
  });
});

// ── Workspace Scoping Test ──

describe("Workspace scoping", () => {
  it("tasks and agents are isolated by workspace", async () => {
    const wsA = await prisma.workspace.create({
      data: { name: "WS-A", slug: `ws-a-${Date.now()}`, status: "ready" },
    });
    const wsB = await prisma.workspace.create({
      data: { name: "WS-B", slug: `ws-b-${Date.now()}`, status: "ready" },
    });

    const agentA = await prisma.agent.create({
      data: { name: "Agent A", role: "a", workspaceId: wsA.id },
    });
    const agentB = await prisma.agent.create({
      data: { name: "Agent B", role: "b", workspaceId: wsB.id },
    });

    await prisma.task.create({
      data: { title: "Task A", agentId: agentA.id, workspaceId: wsA.id },
    });
    await prisma.task.create({
      data: { title: "Task B", agentId: agentB.id, workspaceId: wsB.id },
    });

    const tasksA = await prisma.task.findMany({ where: { workspaceId: wsA.id } });
    const tasksB = await prisma.task.findMany({ where: { workspaceId: wsB.id } });

    expect(tasksA).toHaveLength(1);
    expect(tasksA[0].title).toBe("Task A");
    expect(tasksB).toHaveLength(1);
    expect(tasksB[0].title).toBe("Task B");

    // Cleanup
    await prisma.task.deleteMany({ where: { workspaceId: { in: [wsA.id, wsB.id] } } });
    await prisma.agent.deleteMany({ where: { workspaceId: { in: [wsA.id, wsB.id] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA.id, wsB.id] } } });
  });
});

// ── Review / Follow-up Regression Test ──

describe("Review and Follow-up flows", () => {
  it("accept task sets reviewStatus and cascades to parent", async () => {
    const ws = await prisma.workspace.create({
      data: { name: "Review WS", slug: `review-${Date.now()}`, status: "ready" },
    });
    const agent = await prisma.agent.create({
      data: { name: "Test Agent", role: "test", workspaceId: ws.id },
    });

    const parent = await prisma.task.create({
      data: {
        title: "Parent Task",
        agentId: agent.id,
        status: "done",
        reviewStatus: "pending",
        workspaceId: ws.id,
      },
    });
    const followUp = await prisma.task.create({
      data: {
        title: "Follow Up Task",
        agentId: agent.id,
        status: "done",
        reviewStatus: "pending",
        sourceTaskId: parent.id,
        workspaceId: ws.id,
      },
    });

    await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      await tx.task.update({
        where: { id: followUp.id },
        data: { reviewStatus: "accepted", reviewedAt: new Date() },
      });
      await tx.task.update({
        where: { id: parent.id },
        data: { reviewStatus: "accepted", reviewedAt: new Date() },
      });
    });

    const updatedParent = await prisma.task.findUnique({ where: { id: parent.id } });
    const updatedFollowUp = await prisma.task.findUnique({ where: { id: followUp.id } });

    expect(updatedFollowUp?.reviewStatus).toBe("accepted");
    expect(updatedParent?.reviewStatus).toBe("accepted");

    // Cleanup
    await prisma.task.updateMany({ where: { workspaceId: ws.id }, data: { sourceTaskId: null } });
    await prisma.task.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.agent.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.workspace.delete({ where: { id: ws.id } });
  });

  it("retry resets task state", async () => {
    const ws = await prisma.workspace.create({
      data: { name: "Retry WS", slug: `retry-${Date.now()}`, status: "ready" },
    });
    const agent = await prisma.agent.create({
      data: { name: "Test Agent", role: "test", workspaceId: ws.id },
    });
    const task = await prisma.task.create({
      data: {
        title: "Failed Task",
        agentId: agent.id,
        status: "done",
        progress: 100,
        reviewStatus: "rejected",
        finishedAt: new Date(),
        workspaceId: ws.id,
      },
    });

    await prisma.task.update({
      where: { id: task.id },
      data: { status: "queued", progress: 0, reviewStatus: null, reviewedAt: null, finishedAt: null },
    });

    const retried = await prisma.task.findUnique({ where: { id: task.id } });
    expect(retried?.status).toBe("queued");
    expect(retried?.progress).toBe(0);
    expect(retried?.reviewStatus).toBeNull();

    // Cleanup
    await prisma.task.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.agent.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.workspace.delete({ where: { id: ws.id } });
  });
});
