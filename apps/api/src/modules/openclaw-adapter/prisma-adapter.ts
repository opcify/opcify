import type {
  OpenClawAdapter,
  Agent,
  AgentDetail,
  AgentSkill,
  AgentSummary,
  AgentTemplate,
  AgentTemplateDetail,
  AgentTokenUsage,
  CreateAgentFromTemplateInput,
  CreateFollowUpInput,
  CreateTaskFromTemplateInput,
  CreateTaskGroupFromDecompositionInput,
  CreateTaskGroupResult,
  FollowUpResult,
  SaveTaskTemplateInput,
  Skill,
  Task,
  TaskGroup,
  TaskGroupDetail,
  TaskTemplate,
  TaskWithAgent,
  TaskDetail,
  TaskLog,
  TaskExecutionStep,
  TaskReviewPayload,
  DashboardSummary,
  KanbanSummary,
  KanbanDateResponse,
  KanbanMode,
  KanbanTimingMetrics,
  SuggestedTaskAction,
  SyncExecutionStepsInput,
  CreateAgentInput,
  CreateTaskInput,
  UpdateAgentInput,
  UpdateTaskInput,
  TaskFilters,
  TaskStatus,
  TaskPriority,
} from "@opcify/core";
import { builtInTemplates } from "../agent-templates/built-in-templates.js";
import { builtInTaskTemplates } from "../task-templates/built-in-templates.js";
import { prisma } from "../../db.js";
import { syncAgentToWorkspace, removeAgentFromWorkspace, restartWorkspaceGateway } from "../agents/workspace-sync.js";
import {
  recomputeAgentStatus,
  recomputeAgentStatusForTask,
} from "../agents/agent-status.js";
import { fetchAgentTokenUsage } from "./openclaw-usage.js";
import { computeKanbanTimingMetrics, emptyKanbanTimingMetrics } from "../kanban/timing-metrics.js";

import type { TaskExecutionStepSummary } from "@opcify/core";

function toISO(d: Date): string {
  return d.toISOString();
}

function buildStepsSummary(steps: { status: string; agentName: string | null }[]): TaskExecutionStepSummary | null {
  if (steps.length === 0) return null;
  const completed = steps.filter((s) => s.status === "completed").length;
  const running = steps.filter((s) => s.status === "running");
  return {
    total: steps.length,
    completed,
    running: running.length,
    currentAgentName: running[0]?.agentName ?? null,
  };
}

const EMPTY_USAGE: AgentTokenUsage = { today: 0, week: 0, total: 0, daily: [] };

export class PrismaAdapter implements OpenClawAdapter {
  async listAgents(workspaceId?: string): Promise<AgentSummary[]> {
    const rows = await prisma.agent.findMany({
      where: { deletedAt: null, ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { skills: true } },
        tasks: {
          where: { status: "running" },
          take: 1,
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, progress: true },
        },
      },
    });
    // Fetch real token usage for all agents in one batch
    const usageMap = new Map<string, AgentTokenUsage>();
    if (workspaceId) {
      await Promise.all(
        rows.map(async (r) => {
          const u = await fetchAgentTokenUsage(workspaceId, r.name).catch(() => EMPTY_USAGE);
          usageMap.set(r.id, u);
        }),
      );
    }

    // Sub-agent fallback: when an agent has no task assigned directly via
    // Task.agentId but DOES have a running TaskExecutionStep (it was spawned
    // by an orchestrator), surface that orchestrator's task as currentTask.
    // Without this, sub-agents like a Researcher that the COO hands work to
    // show as "running" with "no active task" — confusing because the user
    // can see the agent is busy.
    const stepBasedTasks = new Map<
      string,
      { id: string; title: string; progress: number }
    >();
    const agentsMissingTask = rows
      .filter((r) => r.tasks.length === 0)
      .map((r) => r.id);
    if (agentsMissingTask.length > 0) {
      const steps = await prisma.taskExecutionStep.findMany({
        where: {
          agentId: { in: agentsMissingTask },
          status: "running",
          task: { status: "running" },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          agentId: true,
          task: { select: { id: true, title: true, progress: true } },
        },
      });
      for (const s of steps) {
        if (s.agentId && !stepBasedTasks.has(s.agentId)) {
          stepBasedTasks.set(s.agentId, s.task);
        }
      }
    }

    return rows.map((r) => {
      const usage = usageMap.get(r.id) ?? EMPTY_USAGE;
      const row = r as typeof r & {
        user?: string | null;
        tools?: string | null;
        heartbeat?: string | null;
        bootstrap?: string | null;
      };
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        description: r.description,
        model: r.model,
        soul: r.soul ?? null,
        agentConfig: r.agentConfig ?? null,
        identity: r.identity ?? null,
        user: row.user ?? null,
        tools: row.tools ?? null,
        heartbeat: row.heartbeat ?? null,
        bootstrap: row.bootstrap ?? null,
        isSystem: r.isSystem,
        maxConcurrent: r.maxConcurrent,
        status: r.status as Agent["status"],
        deletedAt: null,
        createdAt: toISO(r.createdAt),
        updatedAt: toISO(r.updatedAt),
        currentTask: r.tasks[0] ?? stepBasedTasks.get(r.id) ?? null,
        tokenUsageToday: usage.today,
        tokenUsageWeek: usage.week,
        installedSkillsCount: r._count.skills,
      };
    });
  }

  async getAgent(id: string): Promise<AgentDetail | null> {
    const row = await prisma.agent.findUnique({
      where: { id },
      include: {
        skills: { include: { skill: true } },
        tasks: {
          where: { status: "running" },
          take: 1,
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, progress: true },
        },
      },
    });
    if (!row) return null;

    const [taskCounts, recentTaskRows] = await Promise.all([
      prisma.task.groupBy({
        by: ["status"],
        where: { agentId: id },
        _count: true,
      }),
      prisma.task.findMany({
        where: { agentId: id },
        orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 5,
        select: { id: true, title: true, status: true, resultSummary: true, finishedAt: true },
      }),
    ]);

    // Sub-agent fallback: if no task is assigned directly to this agent but
    // it has a running execution step inside someone else's task, surface
    // that orchestrator's task as currentTask. Mirrors the listAgents path.
    let stepBasedCurrentTask: { id: string; title: string; progress: number } | null = null;
    if (row.tasks.length === 0) {
      const stepRow = await prisma.taskExecutionStep.findFirst({
        where: {
          agentId: id,
          status: "running",
          task: { status: "running" },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          task: { select: { id: true, title: true, progress: true } },
        },
      });
      if (stepRow) stepBasedCurrentTask = stepRow.task;
    }

    const counts = { total: 0, running: 0, done: 0, failed: 0 };
    for (const g of taskCounts) {
      counts.total += g._count;
      if (g.status === "running") counts.running = g._count;
      if (g.status === "done") counts.done = g._count;
      if (g.status === "failed" || g.status === "stopped") counts.failed += g._count;
    }

    const r2 = row as typeof row & {
      user?: string | null;
      tools?: string | null;
      heartbeat?: string | null;
      bootstrap?: string | null;
    };
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      description: row.description,
      model: row.model,
      soul: row.soul ?? null,
      agentConfig: row.agentConfig ?? null,
      identity: row.identity ?? null,
      user: r2.user ?? null,
      tools: r2.tools ?? null,
      heartbeat: r2.heartbeat ?? null,
      bootstrap: r2.bootstrap ?? null,
      isSystem: row.isSystem,
      maxConcurrent: row.maxConcurrent,
      status: row.status as Agent["status"],
      deletedAt: row.deletedAt ? toISO(row.deletedAt) : null,
      createdAt: toISO(row.createdAt),
      updatedAt: toISO(row.updatedAt),
      skills: row.skills.map((as) => as.skill),
      taskCounts: counts,
      currentTask: row.tasks[0] ?? stepBasedCurrentTask ?? null,
      tokenUsage: row.workspaceId
        ? await fetchAgentTokenUsage(row.workspaceId, row.name).catch(() => EMPTY_USAGE)
        : EMPTY_USAGE,
      recentTasks: recentTaskRows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status as Task["status"],
        resultSummary: t.resultSummary,
        finishedAt: t.finishedAt ? toISO(t.finishedAt) : null,
      })),
    };
  }

  async getAgentTokenUsage(id: string): Promise<AgentTokenUsage> {
    const agent = await prisma.agent.findUnique({ where: { id }, select: { name: true, workspaceId: true } });
    if (!agent?.workspaceId) return EMPTY_USAGE;
    return fetchAgentTokenUsage(agent.workspaceId, agent.name).catch(() => EMPTY_USAGE);
  }

  async createAgent(data: CreateAgentInput): Promise<Agent> {
    const existing = await prisma.agent.findFirst({
      where: {
        name: data.name,
        workspaceId: data.workspaceId ?? null,
        deletedAt: null,
      },
    });
    if (existing) throw new Error(`Agent "${data.name}" already exists`);

    const row = await prisma.agent.create({
      data: {
        name: data.name,
        role: data.role,
        description: data.description ?? "",
        ...(data.model && { model: data.model }),
        soul: data.soul ?? null,
        agentConfig: data.agentConfig ?? null,
        identity: data.identity ?? null,
        user: data.user ?? null,
        tools: data.tools ?? null,
        heartbeat: data.heartbeat ?? null,
        bootstrap: data.bootstrap ?? null,
        workspaceId: data.workspaceId ?? null,
      },
    });
    const agent = r(row);
    if (row.workspaceId) {
      await syncAgentToWorkspace(row.workspaceId, {
        ...agent,
        model: row.model,
      });
    }
    return agent;
  }

  async updateAgent(id: string, data: UpdateAgentInput): Promise<Agent> {
    const row = await prisma.agent.update({ where: { id }, data });
    const agent = r(row);
    if (row.workspaceId) {
      await syncAgentToWorkspace(row.workspaceId, {
        ...agent,
        model: row.model,
      });
      // Restart gateway when model changes so OpenClaw picks up the new config
      if (data.model) {
        restartWorkspaceGateway(row.workspaceId);
      }
    }
    return agent;
  }

  async deleteAgent(id: string): Promise<void> {
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) throw new Error("Agent not found");
    if (agent.isSystem) throw new Error("Cannot delete a system agent");
    await prisma.agent.update({
      where: { id },
      data: { deletedAt: new Date(), status: "disabled" },
    });
    if (agent.workspaceId) {
      await removeAgentFromWorkspace(agent.workspaceId, id, agent.name);
    }
  }

  async restoreAgent(id: string): Promise<Agent> {
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) throw new Error("Agent not found");
    if (!agent.deletedAt) throw new Error("Agent is not deleted");
    const row = await prisma.agent.update({
      where: { id },
      data: { deletedAt: null, status: "idle" },
    });
    const restored = r(row);
    if (row.workspaceId) {
      await syncAgentToWorkspace(row.workspaceId, {
        ...restored,
        model: row.model,
      });
    }
    return restored;
  }

  async enableAgent(id: string): Promise<Agent> {
    const row = await prisma.agent.update({
      where: { id },
      data: { status: "idle" },
    });
    return { ...r(row) };
  }

  async disableAgent(id: string): Promise<Agent> {
    const row = await prisma.agent.update({
      where: { id },
      data: { status: "disabled" },
    });
    return { ...r(row) };
  }

  async listSkills(): Promise<Skill[]> {
    return prisma.skill.findMany({ orderBy: { name: "asc" } });
  }

  async getAgentSkills(agentId: string): Promise<AgentSkill[]> {
    const rows = await prisma.agentSkill.findMany({
      where: { agentId },
      include: { skill: true },
      orderBy: { installedAt: "desc" },
    });
    return rows.map((row) => ({
      ...row,
      installedAt: toISO(row.installedAt),
    }));
  }

  async getSkillRecommendations(agentId: string): Promise<Skill[]> {
    const installed = await prisma.agentSkill.findMany({
      where: { agentId },
      select: { skillId: true },
    });
    const installedIds = installed.map((row) => row.skillId);

    return prisma.skill.findMany({
      where: { id: { notIn: installedIds } },
      orderBy: { name: "asc" },
    });
  }

  async installSkill(agentId: string, skillId: string): Promise<AgentSkill> {
    const row = await prisma.agentSkill.create({
      data: { agentId, skillId },
      include: { skill: true },
    });
    return { ...row, installedAt: toISO(row.installedAt) };
  }

  async uninstallSkill(agentId: string, skillId: string): Promise<void> {
    await prisma.agentSkill.delete({
      where: { agentId_skillId: { agentId, skillId } },
    });
  }

  async listTasks(filters?: TaskFilters): Promise<TaskWithAgent[]> {
    const orderByMap: Record<string, object> = {
      updatedAt_desc: { updatedAt: "desc" },
      updatedAt_asc: { updatedAt: "asc" },
      createdAt_desc: { createdAt: "desc" },
      progress_desc: { progress: "desc" },
      title_asc: { title: "asc" },
    };
    const orderBy = (filters?.sort && orderByMap[filters.sort]) || { updatedAt: "desc" };

    const rows = await prisma.task.findMany({
      where: {
        ...(filters?.archived === "true"
          ? { archivedAt: { not: null } }
          : { archivedAt: null }),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.priority ? { priority: filters.priority } : {}),
        ...(filters?.agentId ? { agentId: filters.agentId } : {}),
        ...(filters?.workspaceId ? { workspaceId: filters.workspaceId } : {}),
        ...(filters?.q ? { title: { contains: filters.q } } : {}),
      },
      include: {
        agent: { select: { id: true, name: true } },
        taskGroup: { select: { id: true, title: true } },
        executionSteps: { orderBy: { stepOrder: "asc" } },
      },
      orderBy,
      take: filters?.limit ?? 50,
    });

    let result = rows.map((row) => ({
      ...row,
      taskType: (row.taskType ?? "normal") as Task["taskType"],
      status: row.status as Task["status"],
      priority: row.priority as TaskPriority,
      reviewStatus: (row.reviewStatus as Task["reviewStatus"]) ?? null,
      reviewedAt: row.reviewedAt ? toISO(row.reviewedAt) : null,
      reviewNotes: row.reviewNotes ?? null,
      resultContent: row.resultContent ?? null,
      sourceTaskId: row.sourceTaskId ?? null,
      taskGroupId: row.taskGroupId ?? null,
      waitingReason: (row.waitingReason as Task["waitingReason"]) ?? null,
      blockingQuestion: row.blockingQuestion ?? null,
      blockedByTaskId: row.blockedByTaskId ?? null,
      executionMode: (row.executionMode ?? "single") as Task["executionMode"],
      orchestratorAgentId: row.orchestratorAgentId ?? null,
      plannedDate: row.plannedDate ? toISO(row.plannedDate) : null,
      createdAt: toISO(row.createdAt),
      updatedAt: toISO(row.updatedAt),
      startedAt: row.startedAt ? toISO(row.startedAt) : null,
      finishedAt: row.finishedAt ? toISO(row.finishedAt) : null,
      taskGroup: row.taskGroup ?? null,
      executionStepsSummary: buildStepsSummary(row.executionSteps),
    }));

    if (filters?.sort === "priority_desc") {
      const pOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
      result.sort((a, b) => (pOrder[b.priority] ?? 2) - (pOrder[a.priority] ?? 2) || b.updatedAt.localeCompare(a.updatedAt));
    }

    return result;
  }

  async createTask(data: CreateTaskInput): Promise<Task> {
    // Derive workspaceId from the agent if not set
    const agent = await prisma.agent.findUnique({
      where: { id: data.agentId },
      select: { workspaceId: true },
    });
    const row = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description ?? "",
        taskType: data.taskType ?? "normal",
        agentId: data.agentId,
        priority: data.priority ?? "medium",
        workspaceId: agent?.workspaceId ?? null,
        ...(data.plannedDate ? { plannedDate: new Date(data.plannedDate) } : {}),
        ...(data.sourceTaskId ? { sourceTaskId: data.sourceTaskId } : {}),
        ...(data.clientId ? { clientId: data.clientId } : {}),
      },
    });
    return taskRow(row);
  }

  async updateTask(id: string, data: UpdateTaskInput): Promise<Task> {
    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.agentId !== undefined) updateData.agentId = data.agentId;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.status !== undefined) {
      updateData.status = data.status;
      if (data.status === "done" || data.status === "failed" || data.status === "stopped") {
        updateData.finishedAt = new Date();
      }
      if (data.status === "done") {
        updateData.progress = 100;
        updateData.reviewStatus = "pending";
      }
    }
    if (data.plannedDate !== undefined) {
      updateData.plannedDate = data.plannedDate ? new Date(data.plannedDate) : null;
    }
    if (data.waitingReason !== undefined) {
      updateData.waitingReason = data.waitingReason;
    }
    if (data.blockingQuestion !== undefined) {
      updateData.blockingQuestion = data.blockingQuestion;
    }
    if (data.blockedByTaskId !== undefined) {
      updateData.blockedByTaskId = data.blockedByTaskId;
    }
    if (data.clientId !== undefined) {
      updateData.clientId = data.clientId;
    }
    if ((data as Record<string, unknown>).recurringRuleId !== undefined) {
      updateData.recurringRuleId = (data as Record<string, unknown>).recurringRuleId;
    }
    const row = await prisma.task.update({
      where: { id },
      data: updateData,
    });
    return taskRow(row);
  }

  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    const finishedAt = status === "done" || status === "failed" || status === "stopped" ? new Date() : undefined;
    const progress = status === "done" ? 100 : undefined;
    // Only set reviewStatus to "pending" if it hasn't already been acted on
    // (accepted or followed_up should not be overwritten by late callbacks)
    let reviewStatus: string | undefined;
    if (status === "done") {
      const current = await prisma.task.findUnique({ where: { id }, select: { reviewStatus: true } });
      if (!current?.reviewStatus || current.reviewStatus === "pending" || current.reviewStatus === "rejected") {
        reviewStatus = "pending";
      }
    }
    const row = await prisma.task.update({
      where: { id },
      data: {
        status,
        ...(finishedAt ? { finishedAt } : {}),
        ...(progress !== undefined ? { progress } : {}),
        ...(reviewStatus ? { reviewStatus } : {}),
      },
    });
    await recomputeAgentStatusForTask(id);
    return taskRow(row);
  }

  async startTask(id: string): Promise<Task> {
    const existing = await prisma.task.findUnique({
      where: { id },
      select: { startedAt: true },
    });
    const row = await prisma.task.update({
      where: { id },
      data: {
        status: "running",
        progress: 0,
        reviewStatus: null,
        ...(existing?.startedAt == null ? { startedAt: new Date() } : {}),
      },
    });
    await recomputeAgentStatusForTask(id);
    return taskRow(row);
  }

  async acceptTask(id: string, notes?: string): Promise<Task> {
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.task.update({
        where: { id },
        data: {
          reviewStatus: "accepted",
          reviewedAt: new Date(),
          ...(notes ? { reviewNotes: notes } : {}),
        },
      });

      const visited = new Set<string>([id]);
      let currentSourceId = row.sourceTaskId;
      while (currentSourceId && !visited.has(currentSourceId)) {
        visited.add(currentSourceId);
        const parent = await tx.task.findUnique({ where: { id: currentSourceId } });
        if (!parent || parent.reviewStatus === "accepted") break;
        await tx.task.update({
          where: { id: currentSourceId },
          data: { reviewStatus: "accepted", reviewedAt: new Date() },
        });
        currentSourceId = parent.sourceTaskId;
      }

      return row;
    });

    return taskRow(result);
  }

  async retryTask(id: string, notes?: string, overrideInstruction?: string): Promise<Task> {
    // Clear startedAt (and finishedAt) so the next dispatch stamps a fresh start time.
    // This is the one place we intentionally null startedAt — see schema.prisma comment.
    const updateData: Record<string, unknown> = {
      status: "queued",
      progress: 0,
      reviewStatus: null,
      reviewedAt: null,
      reviewNotes: notes ?? null,
      finishedAt: null,
      startedAt: null,
    };

    if (overrideInstruction) {
      const existing = await prisma.task.findUnique({ where: { id }, select: { description: true } });
      if (existing) {
        updateData.description = `[Override Instruction]: ${overrideInstruction}\n\n${existing.description}`;
      }
    }

    const row = await prisma.task.update({
      where: { id },
      data: updateData,
    });
    return taskRow(row);
  }

  async followUpTask(id: string, data: CreateFollowUpInput): Promise<FollowUpResult> {
    const source = await prisma.task.findUnique({
      where: { id },
      include: { agent: { select: { id: true, name: true } } },
    });
    if (!source) throw new Error("Source task not found");

    const title = data.title || `Follow up: ${source.title}`;
    // Keep description lean — the agent will fetch full context at runtime
    // via GET /tasks/{sourceTaskId}
    const description = data.description?.trim() || "";

    const updatedSource = await prisma.task.update({
      where: { id },
      data: { reviewStatus: "followed_up" },
    });

    const followUpTask = await this.createTask({
      title,
      description,
      agentId: data.agentId || source.agentId,
      priority: data.priority || (source.priority as TaskPriority) || "medium",
      plannedDate: data.plannedDate,
      sourceTaskId: id,
    });

    return {
      sourceTask: taskRow(updatedSource),
      followUpTask,
    };
  }

  async getTaskReview(id: string): Promise<TaskReviewPayload | null> {
    const row = await prisma.task.findUnique({
      where: { id },
      include: { agent: { select: { id: true, name: true } } },
    });
    if (!row) return null;

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status as Task["status"],
      priority: (row.priority || "medium") as TaskPriority,
      reviewStatus: (row.reviewStatus as Task["reviewStatus"]) ?? null,
      resultSummary: row.resultSummary,
      resultContent: row.resultContent,
      agent: row.agent,
      finishedAt: row.finishedAt ? toISO(row.finishedAt) : null,
      reviewedAt: row.reviewedAt ? toISO(row.reviewedAt) : null,
      reviewNotes: row.reviewNotes,
      sourceTaskId: row.sourceTaskId,
    };
  }

  async updatePlannedDate(id: string, date: string | null): Promise<Task> {
    const row = await prisma.task.update({
      where: { id },
      data: { plannedDate: date ? new Date(date) : null },
    });
    return taskRow(row);
  }

  async toggleFocus(id: string, isFocus: boolean): Promise<Task> {
    if (isFocus) {
      const focusCount = await prisma.task.count({ where: { isFocus: true, id: { not: id } } });
      if (focusCount >= 3) {
        throw new Error("Maximum 3 focus tasks allowed");
      }
    }
    const row = await prisma.task.update({
      where: { id },
      data: { isFocus },
    });
    return taskRow(row);
  }

  async getKanbanByDate(date: string, workspaceId: string, timezone?: string): Promise<KanbanDateResponse> {
    const selected = new Date(date + "T00:00:00");
    const now = new Date();
    // Compute "today" in the user's timezone (falls back to server local time)
    let todayStr: string;
    if (timezone) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
      todayStr = `${p.year}-${p.month}-${p.day}`;
    } else {
      todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }

    let mode: KanbanMode;
    if (date === todayStr) mode = "today";
    else if (date < todayStr) mode = "past";
    else mode = "future";

    const dayStart = new Date(date + "T00:00:00");
    const dayEnd = new Date(date + "T23:59:59.999");

    const includeAgent = {
      agent: { select: { id: true, name: true } },
      sourceTask: { select: { id: true, title: true, resultSummary: true, reviewStatus: true } },
      taskGroup: { select: { id: true, title: true } },
      executionSteps: { orderBy: { stepOrder: "asc" as const } },
    } as const;

    const toTWA = (row: Awaited<ReturnType<typeof prisma.task.findMany>>[number] & { agent: { id: string; name: string }; sourceTask?: { id: string; title: string; resultSummary: string | null; reviewStatus: string | null } | null; taskGroup?: { id: string; title: string } | null; executionSteps?: { status: string; agentName: string | null }[] }): TaskWithAgent => ({
      id: row.id,
      title: row.title,
      description: row.description,
      taskType: (row.taskType ?? "normal") as Task["taskType"],
      agentId: row.agentId,
      status: row.status as Task["status"],
      priority: row.priority as TaskPriority,
      progress: row.progress,
      reviewStatus: (row.reviewStatus as Task["reviewStatus"]) ?? null,
      reviewedAt: row.reviewedAt ? toISO(row.reviewedAt) : null,
      reviewNotes: row.reviewNotes ?? null,
      resultSummary: row.resultSummary,
      resultContent: row.resultContent ?? null,
      sourceTaskId: row.sourceTaskId ?? null,
      taskGroupId: row.taskGroupId ?? null,
      waitingReason: (row.waitingReason as Task["waitingReason"]) ?? null,
      blockingQuestion: row.blockingQuestion ?? null,
      blockedByTaskId: row.blockedByTaskId ?? null,
      executionMode: (row.executionMode ?? "single") as Task["executionMode"],
      orchestratorAgentId: row.orchestratorAgentId ?? null,
      maxRetries: row.maxRetries,
      clientId: row.clientId ?? null,
      recurringRuleId: row.recurringRuleId ?? null,
      workspaceId: row.workspaceId ?? null,
      plannedDate: row.plannedDate ? toISO(row.plannedDate) : null,
      isFocus: row.isFocus,
      createdAt: toISO(row.createdAt),
      updatedAt: toISO(row.updatedAt),
      startedAt: row.startedAt ? toISO(row.startedAt) : null,
      finishedAt: row.finishedAt ? toISO(row.finishedAt) : null,
      agent: row.agent,
      sourceTask: row.sourceTask ? {
        id: row.sourceTask.id,
        title: row.sourceTask.title,
        resultSummary: row.sourceTask.resultSummary,
        reviewStatus: (row.sourceTask.reviewStatus as Task["reviewStatus"]) ?? null,
      } : null,
      taskGroup: row.taskGroup ?? null,
      executionStepsSummary: buildStepsSummary(row.executionSteps ?? []),
    });

    if (mode === "today") {
      const existing = await this.getKanbanSummary(workspaceId);

      const focusRows = await prisma.task.findMany({
        where: { isFocus: true, workspaceId },
        include: includeAgent,
        orderBy: { updatedAt: "desc" },
      });
      const pOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
      focusRows.sort((a, b) =>
        ((pOrder[b.priority] ?? 2) - (pOrder[a.priority] ?? 2)) ||
        b.updatedAt.getTime() - a.updatedAt.getTime()
      );

      return {
        mode: "today",
        selectedDate: date,
        summary: {
          items: [
            { label: "Planned", value: existing.summary.planned, color: "text-blue-400", bg: "bg-blue-500/10", dot: "bg-blue-400" },
            { label: "Running", value: existing.summary.running, color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
            { label: "Review", value: existing.summary.review, color: "text-amber-400", bg: "bg-amber-500/10", dot: "bg-amber-400" },
            { label: "Completed", value: existing.summary.completed, color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
          ],
        },
        focusTasks: focusRows.map(toTWA),
        sections: {
          todayPlan: existing.todayPlan,
          inProgress: existing.inProgress,
          readyForReview: existing.readyForReview,
          completedToday: existing.completedToday,
          failedToday: existing.failedToday,
          nextActions: existing.nextActions,
        },
        timingMetrics: existing.timingMetrics,
      };
    }

    if (mode === "past") {
      const [assigned, completed, inProgress, attention, startedInScope] = await Promise.all([
        prisma.task.findMany({
          where: { workspaceId, createdAt: { gte: dayStart, lte: dayEnd } },
          include: includeAgent,
          orderBy: { createdAt: "desc" },
        }),
        prisma.task.findMany({
          where: { workspaceId, status: "done", finishedAt: { gte: dayStart, lte: dayEnd } },
          include: includeAgent,
          orderBy: { finishedAt: "desc" },
        }),
        prisma.task.findMany({
          where: {
            workspaceId,
            createdAt: { lte: dayEnd },
            OR: [
              { status: { in: ["running", "waiting", "queued"] } },
              { status: "done", reviewStatus: { notIn: ["accepted"] } },
            ],
            NOT: { status: "done", finishedAt: { gte: dayStart, lte: dayEnd } },
          },
          include: includeAgent,
          orderBy: { updatedAt: "desc" },
        }),
        prisma.task.findMany({
          where: {
            workspaceId,
            OR: [
              { status: { in: ["failed", "stopped"] }, updatedAt: { gte: dayStart, lte: dayEnd } },
              { status: "done", reviewStatus: "pending", finishedAt: { gte: dayStart, lte: dayEnd } },
              { status: "done", reviewStatus: "rejected", finishedAt: { gte: dayStart, lte: dayEnd } },
            ],
          },
          include: includeAgent,
          orderBy: { updatedAt: "desc" },
        }),
        prisma.task.findMany({
          where: { workspaceId, startedAt: { gte: dayStart, lte: dayEnd } },
          select: { id: true, startedAt: true, createdAt: true },
        }),
      ]);

      const suggestedNextSteps: SuggestedTaskAction[] = [];
      for (const t of attention.map(toTWA)) {
        if (suggestedNextSteps.length >= 4) break;
        if (t.status === "failed") {
          suggestedNextSteps.push({
            id: `suggest-retry-${t.id}`,
            title: `Retry: ${t.title}`,
            suggestedAgentId: t.agent.id,
            suggestedAgentName: t.agent.name,
            reason: "This task failed and may need another attempt.",
            sourceTaskId: t.id,
          });
        } else if (t.status === "done" && t.reviewStatus === "pending") {
          suggestedNextSteps.push({
            id: `suggest-review-${t.id}`,
            title: `Review: ${t.title}`,
            suggestedAgentId: t.agent.id,
            suggestedAgentName: t.agent.name,
            reason: "This task is done but still awaiting your review.",
            sourceTaskId: t.id,
          });
        } else if (t.status === "done" && t.reviewStatus === "rejected") {
          suggestedNextSteps.push({
            id: `suggest-followup-${t.id}`,
            title: `Follow up: ${t.title}`,
            suggestedAgentId: t.agent.id,
            suggestedAgentName: t.agent.name,
            reason: "This task was rejected and may need a follow-up.",
            sourceTaskId: t.id,
          });
        }
      }
      for (const t of completed.map(toTWA)) {
        if (suggestedNextSteps.length >= 4) break;
        if (t.reviewStatus === "accepted") {
          suggestedNextSteps.push({
            id: `suggest-continue-${t.id}`,
            title: `Continue from: ${t.title}`,
            suggestedAgentId: t.agent.id,
            suggestedAgentName: t.agent.name,
            reason: "Build on this completed work with a follow-up task.",
            sourceTaskId: t.id,
          });
        }
      }

      const dateLabel = new Date(selected).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const parts: string[] = [];
      if (assigned.length > 0) parts.push(`${assigned.length} task${assigned.length === 1 ? " was" : "s were"} assigned`);
      if (completed.length > 0) parts.push(`${completed.length} completed`);
      if (inProgress.length > 0) parts.push(`${inProgress.length} remained in progress`);
      if (attention.length > 0) parts.push(`${attention.length} required attention`);
      const dailySummaryText = parts.length > 0
        ? `On ${dateLabel}, ${parts.join(", ")}.`
        : undefined;

      const completedTWA = completed.map(toTWA);
      const attentionTWA = attention.map(toTWA);
      const inProgressTWA = inProgress.map(toTWA);
      const terminalForMetrics = [
        ...completedTWA,
        ...attentionTWA.filter((t) => t.status === "failed" || t.status === "stopped"),
      ];
      const runningForMetrics = inProgressTWA.filter((t) => t.status === "running");
      const startedInScopeMetrics = startedInScope.map((row) => ({
        id: row.id,
        startedAt: row.startedAt ? toISO(row.startedAt) : null,
        createdAt: toISO(row.createdAt),
      }));
      const timingMetrics = computeKanbanTimingMetrics(
        terminalForMetrics,
        runningForMetrics,
        startedInScopeMetrics,
      );

      return {
        mode: "past",
        selectedDate: date,
        dailySummaryText,
        summary: {
          items: [
            { label: "Assigned", value: assigned.length, color: "text-blue-400", bg: "bg-blue-500/10", dot: "bg-blue-400" },
            { label: "Completed", value: completed.length, color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
            { label: "In Progress", value: inProgress.length, color: "text-amber-400", bg: "bg-amber-500/10", dot: "bg-amber-400" },
            { label: "Attention", value: attention.length, color: "text-red-400", bg: "bg-red-500/10", dot: "bg-red-400" },
          ],
        },
        sections: {
          assignedThatDay: assigned.map(toTWA),
          completedThatDay: completedTWA,
          stillInProgress: inProgressTWA,
          attentionNeeded: attentionTWA,
          suggestedNextSteps,
        },
        timingMetrics,
      };
    }

    // Future mode
    const [planned, agents] = await Promise.all([
      prisma.task.findMany({
        where: {
          workspaceId,
          OR: [
            { plannedDate: { gte: dayStart, lte: dayEnd } },
            { status: "queued", createdAt: { gte: dayStart, lte: dayEnd } },
          ],
        },
        include: includeAgent,
        orderBy: { createdAt: "desc" },
      }),
      prisma.agent.findMany({ where: { workspaceId }, take: 10 }),
    ]);

    const suggestedTasks: SuggestedTaskAction[] = [];
    const templates = builtInTaskTemplates;
    for (const tpl of templates.slice(0, 4)) {
      suggestedTasks.push({
        id: `suggest-${tpl.id}`,
        title: tpl.defaultTitle,
        suggestedAgentId: agents[0]?.id,
        suggestedAgentName: agents[0]?.name,
        reason: "Plan this for " + new Date(selected).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        templateId: tpl.id,
      });
    }

    return {
      mode: "future",
      selectedDate: date,
      summary: {
        items: [
          { label: "Planned", value: planned.length, color: "text-blue-400", bg: "bg-blue-500/10", dot: "bg-blue-400" },
          { label: "Agents", value: agents.length, color: "text-violet-400", bg: "bg-violet-500/10", dot: "bg-violet-400" },
          { label: "Templates", value: templates.length, color: "text-zinc-400", bg: "bg-zinc-500/10", dot: "bg-zinc-400" },
        ],
      },
      sections: {
        plannedTasks: planned.map(toTWA),
        suggestedTasks,
      },
      // Future-mode tasks haven't executed yet; metrics are all zero/null.
      timingMetrics: emptyKanbanTimingMetrics(),
    };
  }

  async getTask(id: string): Promise<TaskDetail | null> {
    const row = await prisma.task.findUnique({
      where: { id },
      include: {
        agent: { select: { id: true, name: true, role: true, model: true } },
        logs: { orderBy: { createdAt: "asc" } },
        sourceTask: { select: { id: true, title: true, resultSummary: true, reviewStatus: true } },
        followUpTasks: { select: { id: true, title: true, status: true, reviewStatus: true }, orderBy: { createdAt: "asc" } },
        taskGroup: { select: { id: true, title: true } },
        executionSteps: { orderBy: { stepOrder: "asc" } },
        client: { select: { id: true, name: true } },
        recurringRule: { select: { id: true, title: true, frequency: true, interval: true, dayOfWeek: true, dayOfMonth: true, hour: true, minute: true, startDate: true, nextRunAt: true, lastRunAt: true, isActive: true } },
      },
    });
    if (!row) return null;

    let blockedByTask: TaskDetail["blockedByTask"] = null;
    if (row.blockedByTaskId) {
      const blocker = await prisma.task.findUnique({
        where: { id: row.blockedByTaskId },
        select: { id: true, title: true, status: true, reviewStatus: true },
      });
      if (blocker) {
        blockedByTask = {
          id: blocker.id,
          title: blocker.title,
          status: blocker.status as Task["status"],
          reviewStatus: (blocker.reviewStatus as Task["reviewStatus"]) ?? null,
        };
      }
    }

    return {
      ...row,
      taskType: (row.taskType ?? "normal") as Task["taskType"],
      status: row.status as Task["status"],
      priority: row.priority as TaskPriority,
      reviewStatus: (row.reviewStatus as Task["reviewStatus"]) ?? null,
      reviewedAt: row.reviewedAt ? toISO(row.reviewedAt) : null,
      reviewNotes: row.reviewNotes ?? null,
      resultContent: row.resultContent ?? null,
      sourceTaskId: row.sourceTaskId ?? null,
      taskGroupId: row.taskGroupId ?? null,
      waitingReason: (row.waitingReason as Task["waitingReason"]) ?? null,
      blockingQuestion: row.blockingQuestion ?? null,
      blockedByTaskId: row.blockedByTaskId ?? null,
      executionMode: (row.executionMode ?? "single") as Task["executionMode"],
      orchestratorAgentId: row.orchestratorAgentId ?? null,
      plannedDate: row.plannedDate ? toISO(row.plannedDate) : null,
      createdAt: toISO(row.createdAt),
      updatedAt: toISO(row.updatedAt),
      startedAt: row.startedAt ? toISO(row.startedAt) : null,
      finishedAt: row.finishedAt ? toISO(row.finishedAt) : null,
      sourceTask: row.sourceTask ? {
        id: row.sourceTask.id,
        title: row.sourceTask.title,
        resultSummary: row.sourceTask.resultSummary,
        reviewStatus: (row.sourceTask.reviewStatus as Task["reviewStatus"]) ?? null,
      } : null,
      followUpTasks: row.followUpTasks.map((ft) => ({
        id: ft.id,
        title: ft.title,
        status: ft.status as Task["status"],
        reviewStatus: (ft.reviewStatus as Task["reviewStatus"]) ?? null,
      })),
      taskGroup: row.taskGroup ?? null,
      blockedByTask,
      executionSteps: row.executionSteps.map(executionStepRow),
      client: row.client ?? null,
      recurringRuleId: row.recurringRuleId ?? null,
      recurringRule: row.recurringRule ? {
        ...row.recurringRule,
        startDate: row.recurringRule.startDate ? toISO(row.recurringRule.startDate) : null,
        nextRunAt: toISO(row.recurringRule.nextRunAt),
        lastRunAt: row.recurringRule.lastRunAt ? toISO(row.recurringRule.lastRunAt) : null,
      } : null,
      logs: row.logs.map((l) => ({
        ...l,
        level: l.level as TaskLog["level"],
        createdAt: toISO(l.createdAt),
      })),
    };
  }

  async getTaskLogs(taskId: string): Promise<TaskLog[]> {
    const rows = await prisma.taskLog.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      ...row,
      level: row.level as TaskLog["level"],
      createdAt: toISO(row.createdAt),
    }));
  }

  async getDashboardSummary(workspaceId: string): Promise<DashboardSummary> {
    const [agentRows, taskRows, skillCount, installCount, recentRows] =
      await Promise.all([
        prisma.agent.groupBy({ by: ["status"], where: { workspaceId }, _count: true }),
        prisma.task.groupBy({ by: ["status"], where: { workspaceId }, _count: true }),
        prisma.skill.count(),
        prisma.agentSkill.count({ where: { agent: { workspaceId } } }),
        prisma.task.findMany({
          where: { workspaceId },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);

    const agents = { total: 0, idle: 0, running: 0, error: 0, disabled: 0 };
    for (const g of agentRows) {
      agents.total += g._count;
      if (g.status in agents) agents[g.status as keyof typeof agents] += g._count;
    }

    const tasks = { total: 0, queued: 0, running: 0, done: 0, failed: 0 };
    for (const g of taskRows) {
      tasks.total += g._count;
      if (g.status in tasks) tasks[g.status as keyof typeof tasks] += g._count;
    }

    return {
      agents,
      tasks,
      skills: { total: skillCount, installed: installCount },
      recentTasks: recentRows.map((row) => taskRow(row)),
    };
  }

  async getKanbanSummary(workspaceId: string): Promise<KanbanSummary> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const includeWithSource = {
      agent: { select: { id: true, name: true } },
      sourceTask: { select: { id: true, title: true, resultSummary: true, reviewStatus: true } },
      taskGroup: { select: { id: true, title: true } },
      executionSteps: { orderBy: { stepOrder: "asc" as const } },
    } as const;

    const notArchived = { archivedAt: null };
    const [planned, running, reviewPending, accepted, failed, agents, startedInScope] = await Promise.all([
      prisma.task.findMany({
        where: { status: "queued", workspaceId, ...notArchived },
        include: includeWithSource,
        orderBy: { createdAt: "desc" },
      }),
      prisma.task.findMany({
        where: { status: { in: ["running", "waiting"] }, workspaceId, ...notArchived },
        include: includeWithSource,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.task.findMany({
        where: { status: "done", reviewStatus: "pending", workspaceId, ...notArchived },
        include: includeWithSource,
        orderBy: { finishedAt: "desc" },
      }),
      prisma.task.findMany({
        where: {
          status: "done",
          reviewStatus: "accepted",
          workspaceId,
          ...notArchived,
          OR: [
            { finishedAt: { gte: startOfToday } },
            { reviewedAt: { gte: startOfToday } },
          ],
        },
        include: includeWithSource,
        orderBy: { finishedAt: "desc" },
      }),
      prisma.task.findMany({
        where: { status: { in: ["failed", "stopped"] }, workspaceId, ...notArchived },
        include: includeWithSource,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.agent.findMany({ where: { workspaceId }, take: 10 }),
      prisma.task.findMany({
        where: { workspaceId, startedAt: { gte: startOfToday } },
        select: { id: true, startedAt: true, createdAt: true },
      }),
    ]);

    const toTaskWithAgent = (row: typeof planned[number]): TaskWithAgent => ({
      ...row,
      taskType: (row.taskType ?? "normal") as Task["taskType"],
      status: row.status as Task["status"],
      priority: row.priority as TaskPriority,
      progress: row.progress,
      reviewStatus: (row.reviewStatus as Task["reviewStatus"]) ?? null,
      reviewedAt: row.reviewedAt ? toISO(row.reviewedAt) : null,
      reviewNotes: row.reviewNotes ?? null,
      resultContent: row.resultContent ?? null,
      sourceTaskId: row.sourceTaskId ?? null,
      taskGroupId: row.taskGroupId ?? null,
      waitingReason: (row.waitingReason as Task["waitingReason"]) ?? null,
      blockingQuestion: row.blockingQuestion ?? null,
      blockedByTaskId: row.blockedByTaskId ?? null,
      executionMode: (row.executionMode ?? "single") as Task["executionMode"],
      orchestratorAgentId: row.orchestratorAgentId ?? null,
      plannedDate: row.plannedDate ? toISO(row.plannedDate) : null,
      isFocus: row.isFocus,
      createdAt: toISO(row.createdAt),
      updatedAt: toISO(row.updatedAt),
      startedAt: row.startedAt ? toISO(row.startedAt) : null,
      finishedAt: row.finishedAt ? toISO(row.finishedAt) : null,
      sourceTask: row.sourceTask ? {
        id: row.sourceTask.id,
        title: row.sourceTask.title,
        resultSummary: row.sourceTask.resultSummary,
        reviewStatus: (row.sourceTask.reviewStatus as Task["reviewStatus"]) ?? null,
      } : null,
      taskGroup: row.taskGroup ?? null,
      executionStepsSummary: buildStepsSummary(row.executionSteps ?? []),
    });

    const completedTasks = await prisma.task.findMany({
      where: { status: "done", reviewStatus: "accepted" },
      orderBy: { finishedAt: "desc" },
      take: 5,
    });

    const nextActions: SuggestedTaskAction[] = [];
    const categoryMap: Record<string, string[]> = {
      research: ["ttpl-competitor-analysis", "ttpl-blog-draft"],
      content: ["ttpl-weekly-summary", "ttpl-document-summary"],
      reporting: ["ttpl-market-research", "ttpl-lead-research"],
      operations: ["ttpl-data-cleanup", "ttpl-inbox-cleanup"],
      sales: ["ttpl-market-research", "ttpl-competitor-analysis"],
    };

    const allTemplates = builtInTaskTemplates;
    const usedIds = new Set<string>();

    for (const done of completedTasks) {
      const title = done.title.toLowerCase();
      let category = "research";
      if (title.includes("blog") || title.includes("draft") || title.includes("content")) category = "content";
      else if (title.includes("report") || title.includes("summary")) category = "reporting";
      else if (title.includes("inbox") || title.includes("cleanup") || title.includes("data")) category = "operations";
      else if (title.includes("lead") || title.includes("sales")) category = "sales";

      const suggestions = categoryMap[category] || [];
      for (const tplId of suggestions) {
        if (usedIds.has(tplId) || nextActions.length >= 4) break;
        const tpl = allTemplates.find((t) => t.id === tplId);
        if (!tpl) continue;
        usedIds.add(tplId);
        const agent = agents[0];
        nextActions.push({
          id: `next-${tplId}`,
          title: tpl.defaultTitle,
          suggestedAgentId: agent?.id,
          suggestedAgentName: agent?.name,
          reason: `Suggested after completing "${done.title}"`,
          templateId: tplId,
        });
      }
    }

    if (nextActions.length < 4) {
      const fallback = ["ttpl-market-research", "ttpl-blog-draft", "ttpl-inbox-cleanup", "ttpl-weekly-summary"];
      for (const tplId of fallback) {
        if (usedIds.has(tplId) || nextActions.length >= 4) continue;
        const tpl = allTemplates.find((t) => t.id === tplId);
        if (!tpl) continue;
        usedIds.add(tplId);
        const agent = agents[0];
        nextActions.push({
          id: `next-${tplId}`,
          title: tpl.defaultTitle,
          suggestedAgentId: agent?.id,
          suggestedAgentName: agent?.name,
          reason: `Recommended from your task templates`,
          templateId: tplId,
        });
      }
    }

    const pOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const byPriority = (a: typeof planned[number], b: typeof planned[number]) =>
      (pOrder[b.priority] ?? 2) - (pOrder[a.priority] ?? 2);

    const sortedPlan = [...planned].sort((a, b) => byPriority(a, b) || a.createdAt.getTime() - b.createdAt.getTime());
    const sortedRunning = [...running].sort((a, b) => byPriority(a, b) || b.updatedAt.getTime() - a.updatedAt.getTime());
    const sortedReview = [...reviewPending].sort((a, b) => byPriority(a, b) || (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));

    const sortedFailed = [...failed].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const completedTodayTWA = accepted.map(toTaskWithAgent);
    const failedTodayTWA = sortedFailed.map(toTaskWithAgent);
    const inProgressTWA = sortedRunning.map(toTaskWithAgent);
    const startedInScopeMetrics = startedInScope.map((row) => ({
      id: row.id,
      startedAt: row.startedAt ? toISO(row.startedAt) : null,
      createdAt: toISO(row.createdAt),
    }));
    const timingMetrics = computeKanbanTimingMetrics(
      [...completedTodayTWA, ...failedTodayTWA],
      inProgressTWA.filter((t) => t.status === "running"),
      startedInScopeMetrics,
    );

    return {
      summary: {
        planned: planned.length,
        running: running.length,
        review: reviewPending.length,
        completed: accepted.length,
      },
      todayPlan: sortedPlan.map(toTaskWithAgent),
      inProgress: inProgressTWA,
      readyForReview: sortedReview.map(toTaskWithAgent),
      completedToday: completedTodayTWA,
      failedToday: failedTodayTWA,
      nextActions,
      timingMetrics,
    };
  }

  async getKanbanTimingMetrics(
    workspaceId: string,
    date: string,
    timezone?: string,
  ): Promise<KanbanTimingMetrics> {
    // Resolve the scope window from `date` in the user's timezone. Uses the same
    // dayStart/dayEnd approach as getKanbanByDate so today/past/future are consistent.
    void timezone; // Reserved for future timezone-aware windowing; today uses server local day.
    const dayStart = new Date(date + "T00:00:00");
    const dayEnd = new Date(date + "T23:59:59.999");
    const now = new Date();

    const [completed, inProgress, startedInScope] = await Promise.all([
      prisma.task.findMany({
        where: {
          workspaceId,
          archivedAt: null,
          status: { in: ["done", "failed", "stopped"] },
          finishedAt: { gte: dayStart, lte: dayEnd },
        },
        select: { id: true, title: true, startedAt: true, finishedAt: true, createdAt: true },
      }),
      prisma.task.findMany({
        where: { workspaceId, archivedAt: null, status: "running" },
        select: { id: true, title: true, startedAt: true },
      }),
      prisma.task.findMany({
        where: { workspaceId, startedAt: { gte: dayStart, lte: dayEnd } },
        select: { id: true, startedAt: true, createdAt: true },
      }),
    ]);

    return computeKanbanTimingMetrics(
      completed.map((row) => ({
        id: row.id,
        title: row.title,
        startedAt: row.startedAt ? toISO(row.startedAt) : null,
        finishedAt: row.finishedAt ? toISO(row.finishedAt) : null,
        createdAt: toISO(row.createdAt),
      })),
      inProgress.map((row) => ({
        id: row.id,
        title: row.title,
        startedAt: row.startedAt ? toISO(row.startedAt) : null,
      })),
      startedInScope.map((row) => ({
        id: row.id,
        startedAt: row.startedAt ? toISO(row.startedAt) : null,
        createdAt: toISO(row.createdAt),
      })),
      now,
    );
  }

  async createTaskGroupFromDecomposition(
    taskId: string,
    input: CreateTaskGroupFromDecompositionInput,
  ): Promise<CreateTaskGroupResult> {
    const sourceTask = await prisma.task.findUnique({ where: { id: taskId } });
    if (!sourceTask) throw new Error("Source task not found");

    const group = await prisma.taskGroup.create({
      data: {
        title: sourceTask.title,
        description: sourceTask.description,
        type: "decomposition",
        sourceTaskId: taskId,
        workspaceId: sourceTask.workspaceId,
      },
    });

    const createdTasks: Task[] = [];
    for (const item of input.tasks) {
      const row = await prisma.task.create({
        data: {
          title: item.title,
          description: item.description ?? "",
          agentId: item.agentId,
          priority: item.priority ?? "medium",
          taskGroupId: group.id,
          workspaceId: sourceTask.workspaceId,
        },
      });
      createdTasks.push(taskRow(row));
    }

    return {
      taskGroup: taskGroupRow(group),
      tasks: createdTasks,
    };
  }

  async getTaskGroup(id: string): Promise<TaskGroupDetail | null> {
    const row = await prisma.taskGroup.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            agent: { select: { id: true, name: true } },
            taskGroup: { select: { id: true, title: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!row) return null;

    return {
      ...taskGroupRow(row),
      tasks: row.tasks.map((t) => ({
        ...taskRow(t),
        taskType: (t.taskType ?? "normal") as Task["taskType"],
        agent: t.agent,
        taskGroup: t.taskGroup ?? null,
        waitingReason: (t.waitingReason as Task["waitingReason"]) ?? null,
        blockingQuestion: t.blockingQuestion ?? null,
        blockedByTaskId: t.blockedByTaskId ?? null,
      })),
    };
  }

  async listTaskGroups(workspaceId?: string): Promise<TaskGroup[]> {
    const rows = await prisma.taskGroup.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(taskGroupRow);
  }

  async listAgentTemplates(): Promise<AgentTemplate[]> {
    return builtInTemplates;
  }

  async getAgentTemplate(id: string): Promise<AgentTemplateDetail | null> {
    const tpl = builtInTemplates.find((t) => t.id === id);
    if (!tpl) return null;

    const allSkills = await prisma.skill.findMany();
    const suggestedSkills = allSkills.filter((s) =>
      tpl.suggestedSkillKeys.includes(s.key),
    );

    return { ...tpl, suggestedSkills };
  }

  // `updatedAt` on TaskExecutionStep is the canonical "last reported at" —
  // do not add other writers to TaskExecutionStep without revisiting the timeline UI
  // (the ExecutionPanel and TaskProcessingTimeline rely on this invariant).
  async syncExecutionSteps(taskId: string, input: SyncExecutionStepsInput): Promise<TaskExecutionStep[]> {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new Error("Task not found");

    // Build task update data
    const taskUpdate: Record<string, unknown> = {};
    if (input.executionMode) {
      taskUpdate.executionMode = input.executionMode;
    }

    // Don't overwrite reviewStatus if it was already acted on (accepted/followed_up)
    const reviewLocked = task.reviewStatus === "accepted" || task.reviewStatus === "followed_up";

    // Helper: pick the earliest agent-reported step startedAt as a more accurate
    // task start time than the server receive time. Falls back to now.
    const earliestStepStart = (): Date => {
      const ms = input.steps
        .map((s) => (s.startedAt ? new Date(s.startedAt).getTime() : null))
        .filter((t): t is number => t !== null)
        .reduce<number | null>((min, t) => (min == null || t < min ? t : min), null);
      return ms != null ? new Date(ms) : new Date();
    };

    // Handle finalTaskStatus — drive task state transitions
    if (input.finalTaskStatus) {
      taskUpdate.status = input.finalTaskStatus;

      if (input.finalTaskStatus === "done") {
        if (!reviewLocked) taskUpdate.reviewStatus = "pending";
        taskUpdate.finishedAt = new Date();
        taskUpdate.progress = 100;
        // Backfill startedAt if the task reached done without going through an earlier
        // running transition (e.g., fast-completing single-shot agents).
        if (task.startedAt == null) {
          taskUpdate.startedAt = earliestStepStart();
        }
        // Copy the last completed step's output to the task result
        const lastCompleted = [...input.steps]
          .reverse()
          .find((s) => s.status === "completed");
        if (lastCompleted?.outputSummary) {
          taskUpdate.resultSummary = lastCompleted.outputSummary;
        }
        if (lastCompleted?.outputContent) {
          taskUpdate.resultContent = lastCompleted.outputContent;
        }
      } else if (input.finalTaskStatus === "failed") {
        taskUpdate.finishedAt = new Date();
        if (task.startedAt == null) {
          taskUpdate.startedAt = earliestStepStart();
        }
      } else if (input.finalTaskStatus === "running") {
        // Derive progress from steps
        const completedCount = input.steps.filter((s) => s.status === "completed").length;
        const totalCount = input.steps.length;
        if (totalCount > 0) {
          taskUpdate.progress = Math.round((completedCount / totalCount) * 100);
        }
        if (task.startedAt == null) {
          taskUpdate.startedAt = earliestStepStart();
        }
      }
    } else {
      // Derive task state from step states if no explicit finalTaskStatus
      const hasRunning = input.steps.some((s) => s.status === "running");
      const hasFailed = input.steps.some((s) => s.status === "failed");
      const allCompleted = input.steps.length > 0 && input.steps.every((s) => s.status === "completed");

      if (hasFailed) {
        taskUpdate.status = "failed";
        taskUpdate.finishedAt = new Date();
        if (task.startedAt == null) {
          taskUpdate.startedAt = earliestStepStart();
        }
      } else if (allCompleted) {
        taskUpdate.status = "done";
        if (!reviewLocked) taskUpdate.reviewStatus = "pending";
        taskUpdate.finishedAt = new Date();
        taskUpdate.progress = 100;
        if (task.startedAt == null) {
          taskUpdate.startedAt = earliestStepStart();
        }
        const lastCompleted = [...input.steps]
          .reverse()
          .find((s) => s.status === "completed");
        if (lastCompleted?.outputSummary) {
          taskUpdate.resultSummary = lastCompleted.outputSummary;
        }
        if (lastCompleted?.outputContent) {
          taskUpdate.resultContent = lastCompleted.outputContent;
        }
      } else if (hasRunning) {
        taskUpdate.status = "running";
        const completedCount = input.steps.filter((s) => s.status === "completed").length;
        taskUpdate.progress = Math.round((completedCount / input.steps.length) * 100);
        if (task.startedAt == null) {
          taskUpdate.startedAt = earliestStepStart();
        }
      }
    }

    // Apply task update if there are changes
    if (Object.keys(taskUpdate).length > 0) {
      await prisma.task.update({ where: { id: taskId }, data: taskUpdate });
    }

    // Resolve agentName → agentId for any step that arrived without an
    // explicit agentId. The opcify skill callback often only knows agent
    // NAMES (it reads them out of the spawned session), but the Agents
    // page status recompute below needs the ID to match against running
    // execution steps. We scope the lookup to the task's workspace so two
    // workspaces with same-named agents stay isolated.
    const stepAgentIds = new Map<number, string>();
    for (const step of input.steps) {
      if (step.agentId) {
        stepAgentIds.set(step.stepOrder, step.agentId);
        continue;
      }
      if (!step.agentName || !task.workspaceId) continue;
      const found = await prisma.agent.findFirst({
        where: { name: step.agentName, workspaceId: task.workspaceId },
        select: { id: true },
      });
      if (found) stepAgentIds.set(step.stepOrder, found.id);
    }

    // Snapshot existing rows so we can (a) preserve any startedAt/finishedAt
    // already on disk and (b) auto-stamp those timestamps when the agent
    // reports a status transition without supplying them. Without this the
    // execution panel can't show "started at HH:MM" or running duration —
    // both fields are conditionally rendered on `step.startedAt` being set.
    const existingRows = await prisma.taskExecutionStep.findMany({
      where: { taskId },
      select: { stepOrder: true, startedAt: true, finishedAt: true },
    });
    const existingMap = new Map(existingRows.map((r) => [r.stepOrder, r]));

    // Upsert each step
    for (const step of input.steps) {
      const resolvedAgentId = stepAgentIds.get(step.stepOrder) ?? step.agentId ?? null;
      const existing = existingMap.get(step.stepOrder);

      // startedAt: prefer the agent's value, fall back to the existing row,
      // and finally stamp `now` when the step has actually begun running or
      // already finished. Pending steps stay null.
      let resolvedStartedAt: Date | null = step.startedAt
        ? new Date(step.startedAt)
        : (existing?.startedAt ?? null);
      const isLive =
        step.status === "running" ||
        step.status === "completed" ||
        step.status === "failed";
      if (!resolvedStartedAt && isLive) {
        resolvedStartedAt = new Date();
      }

      // finishedAt: same logic but only stamps when the step is terminal.
      let resolvedFinishedAt: Date | null = step.finishedAt
        ? new Date(step.finishedAt)
        : (existing?.finishedAt ?? null);
      if (
        !resolvedFinishedAt &&
        (step.status === "completed" || step.status === "failed")
      ) {
        resolvedFinishedAt = new Date();
      }

      await prisma.taskExecutionStep.upsert({
        where: { taskId_stepOrder: { taskId, stepOrder: step.stepOrder } },
        create: {
          taskId,
          stepOrder: step.stepOrder,
          agentId: resolvedAgentId,
          agentName: step.agentName ?? null,
          roleLabel: step.roleLabel ?? null,
          title: step.title ?? null,
          instruction: step.instruction ?? null,
          status: step.status,
          outputSummary: step.outputSummary ?? null,
          outputContent: step.outputContent ?? null,
          startedAt: resolvedStartedAt,
          finishedAt: resolvedFinishedAt,
        },
        update: {
          agentId: resolvedAgentId ?? undefined,
          agentName: step.agentName ?? undefined,
          roleLabel: step.roleLabel ?? undefined,
          title: step.title ?? undefined,
          instruction: step.instruction ?? undefined,
          status: step.status,
          outputSummary: step.outputSummary ?? undefined,
          outputContent: step.outputContent ?? undefined,
          startedAt: resolvedStartedAt ?? undefined,
          finishedAt: resolvedFinishedAt ?? undefined,
        },
      });
    }

    // Recompute Agent.status for every agent touched by this sync — the
    // task's executor, its orchestrator, and every step's resolved agent.
    // Without this the Agents page stays "idle" for sub-agents that an
    // orchestrator spawned via sessions_spawn (they have no Task row,
    // only execution-step entries).
    const touchedAgentIds = new Set<string>();
    if (task.agentId) touchedAgentIds.add(task.agentId);
    if (task.orchestratorAgentId) touchedAgentIds.add(task.orchestratorAgentId);
    for (const id of stepAgentIds.values()) touchedAgentIds.add(id);
    await Promise.all(
      [...touchedAgentIds].map((id) => recomputeAgentStatus(id)),
    );

    const rows = await prisma.taskExecutionStep.findMany({
      where: { taskId },
      orderBy: { stepOrder: "asc" },
    });

    return rows.map(executionStepRow);
  }

  // --- Task Templates ---

  private taskTemplateRow(row: {
    id: string;
    key: string;
    name: string;
    category: string;
    description: string;
    suggestedAgentRoles: string;
    defaultTitle: string;
    defaultDescription: string;
    defaultTags: string;
    defaultAgentId: string | null;
    defaultPriority: string;
    sourceTaskId: string | null;
    workspaceId: string | null;
  }): TaskTemplate {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      category: row.category as TaskTemplate["category"],
      description: row.description,
      suggestedAgentRoles: JSON.parse(row.suggestedAgentRoles) as string[],
      defaultTitle: row.defaultTitle,
      defaultDescription: row.defaultDescription,
      defaultTags: JSON.parse(row.defaultTags) as string[],
      defaultAgentId: row.defaultAgentId,
      defaultPriority: (row.defaultPriority || "medium") as TaskPriority,
      sourceTaskId: row.sourceTaskId,
      workspaceId: row.workspaceId,
      isBuiltIn: false,
    };
  }

  async listTaskTemplates(workspaceId?: string): Promise<TaskTemplate[]> {
    const dbRows = await prisma.taskTemplate.findMany({
      where: workspaceId
        ? { OR: [{ workspaceId: null }, { workspaceId }] }
        : undefined,
      orderBy: { createdAt: "desc" },
    });
    return [...builtInTaskTemplates, ...dbRows.map((r) => this.taskTemplateRow(r))];
  }

  async getTaskTemplate(id: string): Promise<TaskTemplate | null> {
    const builtIn = builtInTaskTemplates.find((t) => t.id === id);
    if (builtIn) return builtIn;
    const row = await prisma.taskTemplate.findUnique({ where: { id } });
    return row ? this.taskTemplateRow(row) : null;
  }

  async createTaskFromTemplate(data: CreateTaskFromTemplateInput): Promise<Task> {
    const tpl = await this.getTaskTemplate(data.templateId);
    if (!tpl) throw new Error("Template not found");

    return this.createTask({
      title: data.title ?? tpl.defaultTitle,
      description: data.description ?? tpl.defaultDescription,
      agentId: data.agentId ?? tpl.defaultAgentId ?? "",
      priority: data.priority ?? tpl.defaultPriority,
      plannedDate: data.plannedDate,
    });
  }

  async saveTaskTemplate(data: SaveTaskTemplateInput): Promise<TaskTemplate> {
    const key = data.name.toLowerCase().replace(/\s+/g, "-");
    const row = await prisma.taskTemplate.create({
      data: {
        key,
        name: data.name,
        category: data.category,
        description: data.description,
        suggestedAgentRoles: JSON.stringify(data.suggestedAgentRoles),
        defaultTitle: data.defaultTitle,
        defaultDescription: data.defaultDescription,
        defaultTags: JSON.stringify(data.defaultTags),
        defaultAgentId: data.defaultAgentId ?? null,
        defaultPriority: data.defaultPriority ?? "medium",
        workspaceId: data.workspaceId ?? null,
      },
    });
    return this.taskTemplateRow(row);
  }

  async saveTemplateFromTask(taskId: string, input?: { name?: string }): Promise<TaskTemplate> {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new Error("Task not found");

    const name = input?.name ?? task.title;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const row = await prisma.taskTemplate.create({
      data: {
        key,
        name,
        category: "operations",
        description: task.description,
        suggestedAgentRoles: "[]",
        defaultTitle: task.title,
        defaultDescription: task.description,
        defaultTags: "[]",
        defaultAgentId: task.agentId,
        defaultPriority: task.priority || "medium",
        sourceTaskId: taskId,
        workspaceId: task.workspaceId,
      },
    });
    return this.taskTemplateRow(row);
  }

  async deleteTaskTemplate(id: string): Promise<void> {
    const builtIn = builtInTaskTemplates.find((t) => t.id === id);
    if (builtIn) throw new Error("Cannot delete built-in template");
    await prisma.taskTemplate.delete({ where: { id } });
  }

  async createAgentFromTemplate(data: CreateAgentFromTemplateInput): Promise<Agent> {
    const tpl = builtInTemplates.find((t) => t.id === data.templateId);
    if (!tpl) throw new Error("Template not found");

    const existing = await prisma.agent.findFirst({
      where: {
        name: data.name,
        workspaceId: data.workspaceId ?? null,
        deletedAt: null,
      },
    });
    if (existing) throw new Error(`Agent "${data.name}" already exists`);

    // Use provided content or fall back to template defaults
    const soul = data.soul || tpl.defaultSoul || undefined;
    const agentConfig = data.agentConfig || tpl.defaultAgentConfig || undefined;
    const identity = data.identity || tpl.defaultIdentity || undefined;

    const row = await prisma.agent.create({
      data: {
        name: data.name,
        role: tpl.role,
        description: data.description ?? tpl.description,
        model: data.model ?? tpl.defaultModel,
        soul: soul ?? null,
        agentConfig: agentConfig ?? null,
        identity: identity ?? null,
        user: data.user || tpl.defaultUser || null,
        tools: data.tools || tpl.defaultTools || null,
        heartbeat: data.heartbeat || tpl.defaultHeartbeat || null,
        bootstrap: data.bootstrap || tpl.defaultBootstrap || null,
        workspaceId: data.workspaceId ?? null,
      },
    });

    if (data.skillIds && data.skillIds.length > 0) {
      for (const skillId of data.skillIds) {
        await prisma.agentSkill.create({
          data: { agentId: row.id, skillId },
        }).catch(() => {});
      }
    }

    const agent = r(row);
    if (row.workspaceId) {
      await syncAgentToWorkspace(row.workspaceId, {
        ...agent,
        model: row.model,
        tools: data.tools || tpl.defaultTools || null,
        user: data.user || tpl.defaultUser || null,
        heartbeat: data.heartbeat || tpl.defaultHeartbeat || null,
        bootstrap: data.bootstrap || tpl.defaultBootstrap || null,
      });
    }
    return agent;
  }
}

function r(row: { id: string; name: string; role: string; description: string; model: string; soul?: string | null; agentConfig?: string | null; identity?: string | null; user?: string | null; tools?: string | null; heartbeat?: string | null; bootstrap?: string | null; isSystem?: boolean; maxConcurrent?: number; status: string; deletedAt?: Date | null; createdAt: Date; updatedAt: Date }): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description,
    model: row.model,
    soul: row.soul ?? null,
    agentConfig: row.agentConfig ?? null,
    identity: row.identity ?? null,
    user: row.user ?? null,
    tools: row.tools ?? null,
    heartbeat: row.heartbeat ?? null,
    bootstrap: row.bootstrap ?? null,
    isSystem: row.isSystem ?? false,
    maxConcurrent: row.maxConcurrent ?? 1,
    status: row.status as Agent["status"],
    deletedAt: row.deletedAt ? toISO(row.deletedAt) : null,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  };
}

function taskRow(row: {
  id: string; title: string; description: string; taskType?: string;
  agentId: string; status: string; priority: string; progress: number;
  reviewStatus: string | null; reviewedAt?: Date | null; reviewNotes?: string | null;
  resultSummary: string | null; resultContent?: string | null;
  sourceTaskId?: string | null; plannedDate?: Date | null;
  isFocus?: boolean; taskGroupId?: string | null;
  waitingReason?: string | null; blockingQuestion?: string | null; blockedByTaskId?: string | null;
  executionMode?: string; orchestratorAgentId?: string | null;
  maxRetries?: number;
  clientId?: string | null; recurringRuleId?: string | null;
  workspaceId?: string | null;
  createdAt: Date; updatedAt: Date; startedAt: Date | null; finishedAt: Date | null;
}): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    taskType: (row.taskType ?? "normal") as Task["taskType"],
    agentId: row.agentId,
    status: row.status as Task["status"],
    priority: (row.priority || "medium") as TaskPriority,
    progress: row.progress,
    reviewStatus: (row.reviewStatus as Task["reviewStatus"]) ?? null,
    reviewedAt: row.reviewedAt ? toISO(row.reviewedAt) : null,
    reviewNotes: row.reviewNotes ?? null,
    resultSummary: row.resultSummary,
    resultContent: row.resultContent ?? null,
    sourceTaskId: row.sourceTaskId ?? null,
    plannedDate: row.plannedDate ? toISO(row.plannedDate) : null,
    isFocus: row.isFocus ?? false,
    taskGroupId: row.taskGroupId ?? null,
    waitingReason: (row.waitingReason as Task["waitingReason"]) ?? null,
    blockingQuestion: row.blockingQuestion ?? null,
    blockedByTaskId: row.blockedByTaskId ?? null,
    executionMode: (row.executionMode ?? "single") as Task["executionMode"],
    orchestratorAgentId: row.orchestratorAgentId ?? null,
    maxRetries: row.maxRetries ?? 3,
    clientId: row.clientId ?? null,
    recurringRuleId: row.recurringRuleId ?? null,
    workspaceId: row.workspaceId ?? null,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
    startedAt: row.startedAt ? toISO(row.startedAt) : null,
    finishedAt: row.finishedAt ? toISO(row.finishedAt) : null,
  };
}

function executionStepRow(row: {
  id: string; taskId: string; stepOrder: number;
  agentId: string | null; agentName: string | null; roleLabel: string | null;
  title: string | null; instruction: string | null; status: string;
  outputSummary: string | null; outputContent: string | null;
  startedAt: Date | null; finishedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}): TaskExecutionStep {
  return {
    id: row.id,
    taskId: row.taskId,
    stepOrder: row.stepOrder,
    agentId: row.agentId,
    agentName: row.agentName,
    roleLabel: row.roleLabel,
    title: row.title,
    instruction: row.instruction,
    status: row.status as TaskExecutionStep["status"],
    outputSummary: row.outputSummary,
    outputContent: row.outputContent,
    startedAt: row.startedAt ? toISO(row.startedAt) : null,
    finishedAt: row.finishedAt ? toISO(row.finishedAt) : null,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  };
}

function taskGroupRow(row: {
  id: string; title: string; description: string; type: string;
  sourceTaskId: string | null; workspaceId: string | null;
  createdAt: Date; updatedAt: Date;
}): TaskGroup {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type as TaskGroup["type"],
    sourceTaskId: row.sourceTaskId,
    workspaceId: row.workspaceId,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  };
}
