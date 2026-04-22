import { randomUUID } from "node:crypto";
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
  SaveTemplateFromTaskInput,
  Skill,
  Task,
  TaskGroup,
  TaskGroupDetail,
  TaskTemplate,
  TaskWithAgent,
  TaskDetail,
  TaskLog,
  TaskReviewPayload,
  DashboardSummary,
  KanbanSummary,
  KanbanDateResponse,
  KanbanMode,
  KanbanTimingMetrics,
  SuggestedTaskAction,
  CreateAgentInput,
  CreateTaskInput,
  UpdateAgentInput,
  UpdateTaskInput,
  TaskFilters,
  AgentStatus,
  TaskStatus,
  TaskType,
  TaskPriority,
  LogLevel,
  ReviewStatus,
  WaitingReason,
} from "@opcify/core";
import { builtInTemplates } from "../agent-templates/built-in-templates.js";
import { builtInTaskTemplates } from "../task-templates/built-in-templates.js";
import { readJson, writeJson, writeText, listDirs, exists, ensureDir, rmdir, join } from "./fs-utils.js";
import { computeKanbanTimingMetrics, emptyKanbanTimingMetrics } from "../kanban/timing-metrics.js";

/*
 * Workspace layout:
 *
 * <root>/
 *   agents/<id>/agent.json      — { id, name, role, description, status, skills[], createdAt, updatedAt }
 *   skills/<key>/skill.json     — { id, key, name, description, category }
 *   tasks/<id>/task.json        — { id, title, description, agentId, status, progress, resultSummary, createdAt, updatedAt, finishedAt }
 *   tasks/<id>/logs.json        — TaskLog[]
 */

interface AgentFile {
  id: string;
  name: string;
  role: string;
  description: string;
  model?: string;
  soul?: string | null;
  agentConfig?: string | null;
  identity?: string | null;
  user?: string | null;
  tools?: string | null;
  heartbeat?: string | null;
  bootstrap?: string | null;
  isSystem?: boolean;
  status: AgentStatus;
  deletedAt?: string | null;
  maxConcurrent?: number;
  skills: string[]; // skill keys
  createdAt: string;
  updatedAt: string;
}

interface SkillFile {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
}

interface TaskFile {
  id: string;
  title: string;
  description: string;
  taskType: TaskType;
  agentId: string;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  reviewStatus: ReviewStatus | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  resultSummary: string | null;
  resultContent: string | null;
  sourceTaskId: string | null;
  plannedDate: string | null;
  isFocus: boolean;
  taskGroupId: string | null;
  waitingReason: WaitingReason | null;
  blockingQuestion: string | null;
  blockedByTaskId: string | null;
  executionMode: import("@opcify/core").ExecutionMode;
  orchestratorAgentId: string | null;
  clientId: string | null;
  maxRetries: number;
  recurringRuleId: string | null;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface TaskGroupFile {
  id: string;
  title: string;
  description: string;
  type: string;
  sourceTaskId: string | null;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TaskLogFile {
  id: string;
  taskId: string;
  level: LogLevel;
  message: string;
  createdAt: string;
}

const MAX_FOCUS_TASKS = 3;

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 };

function comparePriority(a: Task, b: Task): number {
  return (PRIORITY_ORDER[b.priority] ?? 2) - (PRIORITY_ORDER[a.priority] ?? 2);
}

export class FilesystemAdapter implements OpenClawAdapter {
  constructor(private workspaceRoot: string) {}

  private agentsDir() { return join(this.workspaceRoot, "agents"); }
  private skillsDir() { return join(this.workspaceRoot, "skills"); }
  private tasksDir() { return join(this.workspaceRoot, "tasks"); }

  /** Write SOUL.md / AGENTS.md / IDENTITY.md into agent directory when content is present. */
  private async syncAgentWorkspaceFiles(id: string, af: AgentFile): Promise<void> {
    const dir = join(this.agentsDir(), id);
    if (af.soul != null) await writeText(join(dir, "SOUL.md"), af.soul);
    if (af.agentConfig != null) await writeText(join(dir, "AGENTS.md"), af.agentConfig);
    if (af.identity != null) await writeText(join(dir, "IDENTITY.md"), af.identity);
    if (af.user != null) await writeText(join(dir, "USER.md"), af.user);
    if (af.tools != null) await writeText(join(dir, "TOOLS.md"), af.tools);
    if (af.heartbeat != null) await writeText(join(dir, "HEARTBEAT.md"), af.heartbeat);
    if (af.bootstrap != null) await writeText(join(dir, "BOOTSTRAP.md"), af.bootstrap);
  }

  // --- Agents ---

  async listAgents(_workspaceId?: string): Promise<AgentSummary[]> {
    const ids = await listDirs(this.agentsDir());
    const agents: AgentSummary[] = [];
    const allTasks = await this.loadAllTasks();
    for (const id of ids) {
      const af = await this.readAgentFile(id);
      if (!af || af.deletedAt) continue;
      const runningTask = allTasks.find((t) => t.agentId === id && t.status === "running");
      const usage = this.generateTokenUsage(id);
      agents.push({
        ...this.agentFileToAgent(af),
        currentTask: runningTask ? { id: runningTask.id, title: runningTask.title, progress: runningTask.progress } : null,
        tokenUsageToday: usage.today,
        tokenUsageWeek: usage.week,
        installedSkillsCount: af.skills.length,
      });
    }
    agents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return agents;
  }

  async getAgent(id: string): Promise<AgentDetail | null> {
    const af = await this.readAgentFile(id);
    if (!af) return null;

    const allSkills = await this.loadSkillMap();
    const skills: Skill[] = [];
    for (const key of af.skills) {
      const s = allSkills.get(key);
      if (s) skills.push(s);
    }

    const allTasks = await this.loadAllTasks();
    const agentTasks = allTasks.filter((t) => t.agentId === id);
    const counts = { total: agentTasks.length, running: 0, done: 0, failed: 0 };
    for (const t of agentTasks) {
      if (t.status === "running") counts.running++;
      if (t.status === "done") counts.done++;
      if (t.status === "failed") counts.failed++;
    }
    const runningTask = agentTasks.find((t) => t.status === "running");

    const recentTasks = [...agentTasks]
      .sort((a, b) => {
        const aTime = a.finishedAt ?? a.createdAt;
        const bTime = b.finishedAt ?? b.createdAt;
        return bTime.localeCompare(aTime);
      })
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        resultSummary: t.resultSummary,
        finishedAt: t.finishedAt,
      }));

    return {
      id: af.id,
      name: af.name,
      role: af.role,
      description: af.description,
      model: af.model ?? "gpt-5.4",
      soul: af.soul ?? null,
      agentConfig: af.agentConfig ?? null,
      identity: af.identity ?? null,
      user: af.user ?? null,
      tools: af.tools ?? null,
      heartbeat: af.heartbeat ?? null,
      bootstrap: af.bootstrap ?? null,
      isSystem: af.isSystem ?? false,
      status: af.status,
      maxConcurrent: af.maxConcurrent ?? 1,
      deletedAt: af.deletedAt ?? null,
      createdAt: af.createdAt,
      updatedAt: af.updatedAt,
      skills,
      taskCounts: counts,
      currentTask: runningTask ? { id: runningTask.id, title: runningTask.title, progress: runningTask.progress } : null,
      tokenUsage: this.generateTokenUsage(id),
      recentTasks,
    };
  }

  async getAgentTokenUsage(id: string): Promise<AgentTokenUsage> {
    return this.generateTokenUsage(id);
  }

  async createAgent(data: CreateAgentInput): Promise<Agent> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const af: AgentFile = {
      id,
      name: data.name,
      role: data.role,
      description: data.description ?? "",
      soul: data.soul ?? null,
      agentConfig: data.agentConfig ?? null,
      identity: data.identity ?? null,
      user: data.user ?? null,
      tools: data.tools ?? null,
      heartbeat: data.heartbeat ?? null,
      bootstrap: data.bootstrap ?? null,
      status: "idle",
      skills: [],
      createdAt: now,
      updatedAt: now,
    };
    const dir = join(this.agentsDir(), id);
    await ensureDir(dir);
    await writeJson(join(dir, "agent.json"), af);
    await this.syncAgentWorkspaceFiles(id, af);
    return this.agentFileToAgent(af);
  }

  async updateAgent(id: string, data: UpdateAgentInput): Promise<Agent> {
    const af = await this.readAgentFile(id);
    if (!af) throw new Error("Agent not found");
    if (data.name !== undefined) af.name = data.name;
    if (data.role !== undefined) af.role = data.role;
    if (data.description !== undefined) af.description = data.description;
    if (data.model !== undefined) af.model = data.model;
    if (data.soul !== undefined) af.soul = data.soul;
    if (data.agentConfig !== undefined) af.agentConfig = data.agentConfig;
    if (data.identity !== undefined) af.identity = data.identity;
    if (data.user !== undefined) af.user = data.user;
    if (data.tools !== undefined) af.tools = data.tools;
    if (data.heartbeat !== undefined) af.heartbeat = data.heartbeat;
    if (data.bootstrap !== undefined) af.bootstrap = data.bootstrap;
    af.updatedAt = new Date().toISOString();
    await writeJson(join(this.agentsDir(), id, "agent.json"), af);
    await this.syncAgentWorkspaceFiles(id, af);
    return this.agentFileToAgent(af);
  }

  async deleteAgent(id: string): Promise<void> {
    const af = await this.readAgentFile(id);
    if (!af) throw new Error("Agent not found");
    if (af.isSystem) throw new Error("Cannot delete a system agent");
    af.deletedAt = new Date().toISOString();
    af.status = "disabled";
    af.updatedAt = new Date().toISOString();
    await writeJson(join(this.agentsDir(), id, "agent.json"), af);
  }

  async restoreAgent(id: string): Promise<Agent> {
    const af = await this.readAgentFile(id);
    if (!af) throw new Error("Agent not found");
    if (!af.deletedAt) throw new Error("Agent is not deleted");
    af.deletedAt = null;
    af.status = "idle";
    af.updatedAt = new Date().toISOString();
    await writeJson(join(this.agentsDir(), id, "agent.json"), af);
    return this.agentFileToAgent(af);
  }

  async enableAgent(id: string): Promise<Agent> {
    const af = await this.readAgentFile(id);
    if (!af) throw new Error("Agent not found");
    af.status = "idle";
    af.updatedAt = new Date().toISOString();
    await writeJson(join(this.agentsDir(), id, "agent.json"), af);
    return this.agentFileToAgent(af);
  }

  async disableAgent(id: string): Promise<Agent> {
    const af = await this.readAgentFile(id);
    if (!af) throw new Error("Agent not found");
    af.status = "disabled";
    af.updatedAt = new Date().toISOString();
    await writeJson(join(this.agentsDir(), id, "agent.json"), af);
    return this.agentFileToAgent(af);
  }

  // --- Skills ---

  async listSkills(): Promise<Skill[]> {
    const keys = await listDirs(this.skillsDir());
    const skills: Skill[] = [];
    for (const key of keys) {
      const s = await this.readSkill(key);
      if (s) skills.push(s);
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }

  async getAgentSkills(agentId: string): Promise<AgentSkill[]> {
    const af = await this.readAgentFile(agentId);
    if (!af) return [];
    const skillMap = await this.loadSkillMap();
    const result: AgentSkill[] = [];
    for (const key of af.skills) {
      const skill = skillMap.get(key);
      if (skill) {
        result.push({
          id: `${agentId}:${skill.id}`,
          agentId,
          skillId: skill.id,
          installedAt: af.updatedAt,
          skill,
        });
      }
    }
    return result;
  }

  async getSkillRecommendations(agentId: string): Promise<Skill[]> {
    const af = await this.readAgentFile(agentId);
    if (!af) return [];
    const installedKeys = new Set(af.skills);
    const allSkills = await this.listSkills();
    return allSkills.filter((s) => !installedKeys.has(s.key));
  }

  async installSkill(agentId: string, skillId: string): Promise<AgentSkill> {
    const af = await this.readAgentFile(agentId);
    if (!af) throw new Error("Agent not found");

    const allSkills = await this.listSkills();
    const skill = allSkills.find((s) => s.id === skillId);
    if (!skill) throw new Error("Skill not found");

    if (!af.skills.includes(skill.key)) {
      af.skills.push(skill.key);
      af.updatedAt = new Date().toISOString();
      await writeJson(join(this.agentsDir(), agentId, "agent.json"), af);
    }

    return {
      id: `${agentId}:${skillId}`,
      agentId,
      skillId,
      installedAt: af.updatedAt,
      skill,
    };
  }

  async uninstallSkill(agentId: string, skillId: string): Promise<void> {
    const af = await this.readAgentFile(agentId);
    if (!af) throw new Error("Agent not found");
    const allSkills = await this.listSkills();
    const skill = allSkills.find((s) => s.id === skillId);
    if (!skill) throw new Error("Skill not found");
    af.skills = af.skills.filter((k) => k !== skill.key);
    af.updatedAt = new Date().toISOString();
    await writeJson(join(this.agentsDir(), agentId, "agent.json"), af);
  }

  // --- Tasks ---

  async listTasks(filters?: TaskFilters): Promise<TaskWithAgent[]> {
    let tasks = await this.loadAllTasks();
    if (filters?.status) tasks = tasks.filter((t) => t.status === filters.status);
    if (filters?.priority) tasks = tasks.filter((t) => t.priority === filters.priority);
    if (filters?.agentId) tasks = tasks.filter((t) => t.agentId === filters.agentId);
    if (filters?.q) {
      const q = filters.q.toLowerCase();
      tasks = tasks.filter((t) => t.title.toLowerCase().includes(q));
    }

    const sortKey = filters?.sort ?? "updatedAt_desc";
    const sorters: Record<string, (a: Task, b: Task) => number> = {
      updatedAt_desc: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      updatedAt_asc: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
      createdAt_desc: (a, b) => b.createdAt.localeCompare(a.createdAt),
      progress_desc: (a, b) => b.progress - a.progress,
      title_asc: (a, b) => a.title.localeCompare(b.title),
      priority_desc: (a, b) => comparePriority(a, b) || b.updatedAt.localeCompare(a.updatedAt),
    };
    tasks.sort(sorters[sortKey] ?? sorters.updatedAt_desc);

    const limit = filters?.limit ?? 50;
    const sliced = tasks.slice(0, limit);

    const results: TaskWithAgent[] = [];
    for (const t of sliced) {
      const agent = await this.readAgent(t.agentId);
      results.push({
        ...t,
        agent: agent ? { id: agent.id, name: agent.name } : { id: t.agentId, name: "Unknown" },
      });
    }
    return results;
  }

  async createTask(data: CreateTaskInput): Promise<Task> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const tf: TaskFile = {
      id,
      title: data.title,
      description: data.description ?? "",
      taskType: data.taskType ?? "normal",
      agentId: data.agentId,
      status: "queued",
      priority: data.priority ?? "medium",
      progress: 0,
      reviewStatus: null,
      reviewedAt: null,
      reviewNotes: null,
      resultSummary: null,
      resultContent: null,
      sourceTaskId: data.sourceTaskId ?? null,
      plannedDate: data.plannedDate ?? null,
      isFocus: false,
      taskGroupId: null,
      waitingReason: null,
      blockingQuestion: null,
      blockedByTaskId: null,
      executionMode: "single",
      orchestratorAgentId: null,
      clientId: data.clientId ?? null,
      maxRetries: 3,
      recurringRuleId: null,
      workspaceId: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    const dir = join(this.tasksDir(), id);
    await ensureDir(dir);
    await writeJson(join(dir, "task.json"), tf);
    await writeJson(join(dir, "logs.json"), []);
    return tf;
  }

  async updateTask(id: string, data: UpdateTaskInput): Promise<Task> {
    const tf = await this.readTaskFile(id);
    if (!tf) throw new Error("Task not found");
    if (data.title !== undefined) tf.title = data.title;
    if (data.description !== undefined) tf.description = data.description;
    if (data.agentId !== undefined) tf.agentId = data.agentId;
    if (data.priority !== undefined) tf.priority = data.priority;
    if (data.status !== undefined) {
      tf.status = data.status;
      if (data.status === "done" || data.status === "failed" || data.status === "stopped") {
        tf.finishedAt = new Date().toISOString();
      }
      if (data.status === "done") {
        tf.progress = 100;
        tf.reviewStatus = "pending";
      }
    }
    if (data.plannedDate !== undefined) {
      tf.plannedDate = data.plannedDate ?? null;
    }
    if (data.waitingReason !== undefined) {
      tf.waitingReason = data.waitingReason ?? null;
    }
    if (data.blockingQuestion !== undefined) {
      tf.blockingQuestion = data.blockingQuestion ?? null;
    }
    if (data.blockedByTaskId !== undefined) {
      tf.blockedByTaskId = data.blockedByTaskId ?? null;
    }
    if (data.clientId !== undefined) {
      tf.clientId = data.clientId ?? null;
    }
    tf.updatedAt = new Date().toISOString();
    await writeJson(join(this.tasksDir(), id, "task.json"), tf);
    return { ...tf, reviewStatus: tf.reviewStatus ?? null };
  }

  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    const tf = await this.readTaskFile(id);
    if (!tf) throw new Error("Task not found");
    tf.status = status;
    tf.updatedAt = new Date().toISOString();
    if (status === "done" || status === "failed" || status === "stopped") {
      tf.finishedAt = tf.updatedAt;
    }
    if (status === "done") {
      tf.progress = 100;
      tf.reviewStatus = "pending";
    }
    await writeJson(join(this.tasksDir(), id, "task.json"), tf);
    return { ...tf, reviewStatus: tf.reviewStatus ?? null };
  }

  async startTask(id: string): Promise<Task> {
    const tf = await this.readTaskFile(id);
    if (!tf) throw new Error("Task not found");
    tf.status = "running";
    tf.progress = 0;
    tf.reviewStatus = null;
    if (tf.startedAt == null) tf.startedAt = new Date().toISOString();
    tf.updatedAt = new Date().toISOString();
    await writeJson(join(this.tasksDir(), id, "task.json"), tf);
    return { ...tf, reviewStatus: null };
  }

  async acceptTask(id: string, notes?: string): Promise<Task> {
    const tf = await this.readTaskFile(id);
    if (!tf) throw new Error("Task not found");
    tf.reviewStatus = "accepted";
    tf.reviewedAt = new Date().toISOString();
    if (notes) tf.reviewNotes = notes;
    tf.updatedAt = new Date().toISOString();
    await writeJson(join(this.tasksDir(), id, "task.json"), tf);

    const visited = new Set<string>([id]);
    let currentSourceId = tf.sourceTaskId;
    while (currentSourceId && !visited.has(currentSourceId)) {
      visited.add(currentSourceId);
      const parent = await this.readTaskFile(currentSourceId);
      if (!parent || parent.reviewStatus === "accepted") break;
      parent.reviewStatus = "accepted";
      parent.reviewedAt = new Date().toISOString();
      parent.updatedAt = new Date().toISOString();
      await writeJson(join(this.tasksDir(), currentSourceId, "task.json"), parent);
      currentSourceId = parent.sourceTaskId;
    }

    return tf;
  }

  async retryTask(id: string, notes?: string, overrideInstruction?: string): Promise<Task> {
    const tf = await this.readTaskFile(id);
    if (!tf) throw new Error("Task not found");
    tf.status = "queued";
    tf.progress = 0;
    tf.reviewStatus = null;
    tf.reviewedAt = null;
    tf.reviewNotes = notes ?? null;
    tf.finishedAt = null;
    tf.startedAt = null;
    tf.updatedAt = new Date().toISOString();

    if (overrideInstruction) {
      tf.description = `[Override Instruction]: ${overrideInstruction}\n\n${tf.description}`;
    }

    await writeJson(join(this.tasksDir(), id, "task.json"), tf);
    return { ...tf, reviewStatus: null };
  }

  async followUpTask(id: string, data: CreateFollowUpInput): Promise<FollowUpResult> {
    const source = await this.readTaskFile(id);
    if (!source) throw new Error("Source task not found");

    const title = data.title || `Follow up: ${source.title}`;
    const descParts: string[] = [];
    if (data.description) descParts.push(data.description);
    if (source.resultSummary) descParts.push(`Previous result: ${source.resultSummary}`);
    const description = descParts.join("\n\n");

    source.reviewStatus = "followed_up";
    source.updatedAt = new Date().toISOString();
    await writeJson(join(this.tasksDir(), id, "task.json"), source);

    const followUpTask = await this.createTask({
      title,
      description,
      agentId: data.agentId || source.agentId,
      priority: data.priority || source.priority || "medium",
      plannedDate: data.plannedDate,
      sourceTaskId: id,
    });

    return {
      sourceTask: { ...source, reviewStatus: source.reviewStatus ?? null },
      followUpTask,
    };
  }

  async getTaskReview(id: string): Promise<TaskReviewPayload | null> {
    const tf = await this.readTaskFile(id);
    if (!tf) return null;

    const agent = await this.readAgent(tf.agentId);

    return {
      id: tf.id,
      title: tf.title,
      description: tf.description,
      status: tf.status,
      priority: tf.priority,
      reviewStatus: tf.reviewStatus,
      resultSummary: tf.resultSummary,
      resultContent: tf.resultContent,
      agent: agent ? { id: agent.id, name: agent.name } : null,
      finishedAt: tf.finishedAt,
      reviewedAt: tf.reviewedAt,
      reviewNotes: tf.reviewNotes,
      sourceTaskId: tf.sourceTaskId,
    };
  }

  async updatePlannedDate(id: string, date: string | null): Promise<Task> {
    const tf = await this.readTaskFile(id);
    if (!tf) throw new Error("Task not found");
    tf.plannedDate = date;
    tf.updatedAt = new Date().toISOString();
    await writeJson(join(this.tasksDir(), id, "task.json"), tf);
    return { ...tf, reviewStatus: tf.reviewStatus ?? null };
  }

  async toggleFocus(id: string, isFocus: boolean): Promise<Task> {
    const tf = await this.readTaskFile(id);
    if (!tf) throw new Error("Task not found");

    if (isFocus) {
      const allTasks = await this.loadAllTasks();
      const currentFocusCount = allTasks.filter((t) => t.isFocus && t.id !== id).length;
      if (currentFocusCount >= MAX_FOCUS_TASKS) {
        throw new Error(`Maximum ${MAX_FOCUS_TASKS} focus tasks allowed`);
      }
    }

    tf.isFocus = isFocus;
    tf.updatedAt = new Date().toISOString();
    await writeJson(join(this.tasksDir(), id, "task.json"), tf);
    return { ...tf, reviewStatus: tf.reviewStatus ?? null };
  }

  async getKanbanByDate(date: string, _workspaceId?: string, timezone?: string): Promise<KanbanDateResponse> {
    const now = new Date();
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

    if (mode === "today") {
      const existing = await this.getKanbanSummary();

      const allTasks = await this.loadAllTasks();
      const focusRaw = allTasks.filter((t) => t.isFocus);
      focusRaw.sort((a, b) => comparePriority(a, b) || b.updatedAt.localeCompare(a.updatedAt));
      const focusTasks: TaskWithAgent[] = [];
      for (const t of focusRaw) {
        const a = await this.readAgent(t.agentId);
        focusTasks.push({
          ...t,
          agent: a ? { id: a.id, name: a.name } : { id: t.agentId, name: "Unknown" },
        });
      }

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
        focusTasks,
        sections: {
          todayPlan: existing.todayPlan,
          inProgress: existing.inProgress,
          readyForReview: existing.readyForReview,
          completedToday: existing.completedToday,
          nextActions: existing.nextActions,
        },
        timingMetrics: existing.timingMetrics,
      };
    }

    const allTasks = await this.loadAllTasks();
    const agents = await this.listAgents();
    const dateTaskMap = new Map(allTasks.map((t) => [t.id, t]));

    const withAgent = async (tasks: Task[]): Promise<TaskWithAgent[]> => {
      const results: TaskWithAgent[] = [];
      for (const t of tasks) {
        const a = await this.readAgent(t.agentId);
        let sourceTask = null;
        if (t.sourceTaskId) {
          const src = dateTaskMap.get(t.sourceTaskId);
          if (src) {
            sourceTask = {
              id: src.id,
              title: src.title,
              resultSummary: src.resultSummary,
              reviewStatus: src.reviewStatus,
            };
          }
        }
        results.push({
          ...t,
          agent: a ? { id: a.id, name: a.name } : { id: t.agentId, name: "Unknown" },
          sourceTask,
        });
      }
      return results;
    };

    if (mode === "past") {
      const assigned = allTasks.filter((t) => t.createdAt.slice(0, 10) === date);
      const completed = allTasks.filter((t) => t.status === "done" && t.finishedAt?.slice(0, 10) === date);
      const completedDateSet = new Set(completed.map((t) => t.id));
      const stillInProgress = allTasks.filter((t) =>
        t.createdAt.slice(0, 10) <= date &&
        !completedDateSet.has(t.id) &&
        (
          t.status === "running" || t.status === "waiting" || t.status === "queued" ||
          (t.status === "done" && t.reviewStatus !== "accepted")
        ),
      );
      const attention = allTasks.filter((t) =>
        (t.status === "failed" && t.updatedAt.slice(0, 10) === date) ||
        (t.status === "done" && t.reviewStatus === "pending" && t.finishedAt?.slice(0, 10) === date) ||
        (t.status === "done" && t.reviewStatus === "rejected" && t.finishedAt?.slice(0, 10) === date),
      );

      const suggestedNextSteps: SuggestedTaskAction[] = [];
      const attentionWithAgent = await withAgent(attention);
      for (const t of attentionWithAgent) {
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
      const completedWithAgent = await withAgent(completed);
      for (const t of completedWithAgent) {
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

      const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const parts: string[] = [];
      if (assigned.length > 0) parts.push(`${assigned.length} task${assigned.length === 1 ? " was" : "s were"} assigned`);
      if (completed.length > 0) parts.push(`${completed.length} completed`);
      if (stillInProgress.length > 0) parts.push(`${stillInProgress.length} remained in progress`);
      if (attention.length > 0) parts.push(`${attention.length} required attention`);
      const dailySummaryText = parts.length > 0
        ? `On ${dateLabel}, ${parts.join(", ")}.`
        : undefined;

      return {
        mode: "past",
        selectedDate: date,
        dailySummaryText,
        summary: {
          items: [
            { label: "Assigned", value: assigned.length, color: "text-blue-400", bg: "bg-blue-500/10", dot: "bg-blue-400" },
            { label: "Completed", value: completed.length, color: "text-emerald-400", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
            { label: "In Progress", value: stillInProgress.length, color: "text-amber-400", bg: "bg-amber-500/10", dot: "bg-amber-400" },
            { label: "Attention", value: attention.length, color: "text-red-400", bg: "bg-red-500/10", dot: "bg-red-400" },
          ],
        },
        sections: {
          assignedThatDay: await withAgent(assigned),
          completedThatDay: completedWithAgent,
          stillInProgress: await withAgent(stillInProgress),
          attentionNeeded: attentionWithAgent,
          suggestedNextSteps,
        },
        timingMetrics: computeKanbanTimingMetrics(
          [...completedWithAgent, ...attentionWithAgent.filter((t) => t.status === "failed" || t.status === "stopped")],
          (await withAgent(stillInProgress)).filter((t) => t.status === "running"),
          [],
        ),
      };
    }

    // Future
    const planned = allTasks.filter((t) => t.plannedDate?.slice(0, 10) === date || (t.status === "queued" && t.createdAt.slice(0, 10) === date));
    const templates = builtInTaskTemplates;
    const suggestedTasks: SuggestedTaskAction[] = templates.slice(0, 4).map((tpl) => ({
      id: `suggest-${tpl.id}`,
      title: tpl.defaultTitle,
      suggestedAgentId: agents[0]?.id,
      suggestedAgentName: agents[0]?.name,
      reason: "Plan this for " + new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      templateId: tpl.id,
    }));

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
        plannedTasks: await withAgent(planned),
        suggestedTasks,
      },
      timingMetrics: emptyKanbanTimingMetrics(),
    };
  }

  async getKanbanTimingMetrics(
    _workspaceId: string,
    _date: string,
    _timezone?: string,
  ): Promise<KanbanTimingMetrics> {
    // fs-adapter is a legacy path; aggregate metrics would require a full scan.
    // Return zeros — production deployments use the prisma adapter.
    return emptyKanbanTimingMetrics();
  }

  async getTask(id: string): Promise<TaskDetail | null> {
    const tf = await this.readTaskFile(id);
    if (!tf) return null;

    const agent = await this.readAgent(tf.agentId);
    const logs = await this.readTaskLogs(id);

    let sourceTask = null;
    if (tf.sourceTaskId) {
      const src = await this.readTaskFile(tf.sourceTaskId);
      if (src) {
        sourceTask = {
          id: src.id,
          title: src.title,
          resultSummary: src.resultSummary,
          reviewStatus: src.reviewStatus,
        };
      }
    }

    const allTasks = await this.loadAllTasks();
    const followUpTasks = allTasks
      .filter((t) => t.sourceTaskId === id)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        reviewStatus: t.reviewStatus,
      }));

    let blockedByTask = null;
    if (tf.blockedByTaskId) {
      const blocker = await this.readTaskFile(tf.blockedByTaskId);
      if (blocker) {
        blockedByTask = {
          id: blocker.id,
          title: blocker.title,
          status: blocker.status,
          reviewStatus: blocker.reviewStatus,
        };
      }
    }

    return {
      ...tf,
      agent: agent
        ? { id: agent.id, name: agent.name, role: agent.role, model: agent.model }
        : { id: tf.agentId, name: "Unknown", role: "unknown", model: "gpt-5.4" },
      logs,
      sourceTask,
      followUpTasks,
      blockedByTask,
      executionSteps: [],
      client: null, // Client resolution not available in filesystem adapter
      recurringRule: null, // Recurring rule resolution not available in filesystem adapter
    };
  }

  async getTaskLogs(taskId: string): Promise<TaskLog[]> {
    return this.readTaskLogs(taskId);
  }

  // --- Dashboard ---

  async getDashboardSummary(): Promise<DashboardSummary> {
    const [agents, tasks, allSkills] = await Promise.all([
      this.listAgents(),
      this.loadAllTasks(),
      this.listSkills(),
    ]);

    const agentCounts = { total: agents.length, idle: 0, running: 0, error: 0, disabled: 0 };
    for (const a of agents) {
      if (a.status in agentCounts) agentCounts[a.status as keyof typeof agentCounts]++;
    }

    const taskCounts = { total: tasks.length, queued: 0, running: 0, done: 0, failed: 0 };
    for (const t of tasks) {
      if (t.status in taskCounts) taskCounts[t.status as keyof typeof taskCounts]++;
    }

    let installedCount = 0;
    for (const agent of agents) {
      const af = await this.readAgentFile(agent.id);
      if (af) installedCount += af.skills.length;
    }

    const recent = [...tasks]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);

    return {
      agents: agentCounts,
      tasks: taskCounts,
      skills: { total: allSkills.length, installed: installedCount },
      recentTasks: recent,
    };
  }

  // --- Kanban ---

  async getKanbanSummary(): Promise<KanbanSummary> {
    const allTasks = await this.loadAllTasks();
    const agents = await this.listAgents();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const planned = allTasks.filter((t) => t.status === "queued");
    const inProgress = allTasks.filter((t) => t.status === "running" || t.status === "waiting");
    const review = allTasks.filter((t) => t.status === "done" && t.reviewStatus === "pending");
    const completed = allTasks.filter(
      (t) => t.status === "done" && t.reviewStatus === "accepted" &&
        ((t.finishedAt && new Date(t.finishedAt) >= startOfToday) ||
         (t.reviewedAt && new Date(t.reviewedAt) >= startOfToday)),
    );
    const failed = allTasks.filter(
      (t) =>
        (t.status === "failed" || t.status === "stopped") &&
        ((t.finishedAt && new Date(t.finishedAt) >= startOfToday) ||
         (t.updatedAt && new Date(t.updatedAt) >= startOfToday)),
    );

    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const withAgent = async (tasks: Task[]): Promise<TaskWithAgent[]> => {
      const results: TaskWithAgent[] = [];
      for (const t of tasks) {
        const a = await this.readAgent(t.agentId);
        let sourceTask = null;
        if (t.sourceTaskId) {
          const src = taskMap.get(t.sourceTaskId);
          if (src) {
            sourceTask = {
              id: src.id,
              title: src.title,
              resultSummary: src.resultSummary,
              reviewStatus: src.reviewStatus,
            };
          }
        }
        results.push({
          ...t,
          agent: a ? { id: a.id, name: a.name } : { id: t.agentId, name: "Unknown" },
          sourceTask,
        });
      }
      return results;
    };

    const nextActions: SuggestedTaskAction[] = [];
    const templates = builtInTaskTemplates;
    for (const tpl of templates.slice(0, 4)) {
      nextActions.push({
        id: `next-${tpl.id}`,
        title: tpl.defaultTitle,
        suggestedAgentId: agents[0]?.id,
        suggestedAgentName: agents[0]?.name,
        reason: "Recommended from your task templates",
        templateId: tpl.id,
      });
    }

    planned.sort((a, b) => comparePriority(a, b) || a.createdAt.localeCompare(b.createdAt));
    inProgress.sort((a, b) => comparePriority(a, b) || b.updatedAt.localeCompare(a.updatedAt));
    review.sort((a, b) => comparePriority(a, b) || b.finishedAt!.localeCompare(a.finishedAt!));
    completed.sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!));

    const inProgressWithAgent = await withAgent(inProgress);
    const completedWithAgent = await withAgent(completed);
    const failedWithAgent = await withAgent(failed);
    return {
      summary: { planned: planned.length, running: inProgress.length, review: review.length, completed: completed.length },
      todayPlan: await withAgent(planned),
      inProgress: inProgressWithAgent,
      readyForReview: await withAgent(review),
      completedToday: completedWithAgent,
      failedToday: failedWithAgent,
      nextActions,
      timingMetrics: computeKanbanTimingMetrics(
        [...completedWithAgent, ...failedWithAgent],
        inProgressWithAgent.filter((t) => t.status === "running"),
        [],
      ),
    };
  }

  // --- Internal helpers ---

  private agentFileToAgent(af: AgentFile): Agent {
    return {
      id: af.id,
      name: af.name,
      role: af.role,
      description: af.description,
      model: af.model ?? "gpt-5.4",
      soul: af.soul ?? null,
      agentConfig: af.agentConfig ?? null,
      identity: af.identity ?? null,
      user: af.user ?? null,
      tools: af.tools ?? null,
      heartbeat: af.heartbeat ?? null,
      bootstrap: af.bootstrap ?? null,
      isSystem: af.isSystem ?? false,
      status: af.status,
      maxConcurrent: af.maxConcurrent ?? 1,
      deletedAt: af.deletedAt ?? null,
      createdAt: af.createdAt,
      updatedAt: af.updatedAt,
    };
  }

  private generateTokenUsage(agentId: string): AgentTokenUsage {
    function hash(s: string): number {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return Math.abs(h);
    }
    const today = (hash(agentId + "today") % 25000) + 500;
    const daily: { date: string; tokens: number }[] = [];
    const now = new Date();
    let weekTotal = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const tokens = i === 0 ? today : (hash(agentId + dateStr) % 30000) + 200;
      daily.push({ date: dateStr, tokens });
      weekTotal += tokens;
    }
    const total = weekTotal + (hash(agentId + "hist") % 200000);
    return { today, week: weekTotal, total, daily };
  }

  private async readAgentFile(id: string): Promise<AgentFile | null> {
    const path = join(this.agentsDir(), id, "agent.json");
    if (!(await exists(path))) return null;
    return readJson<AgentFile>(path);
  }

  private async readAgent(id: string): Promise<Agent | null> {
    const af = await this.readAgentFile(id);
    return af ? this.agentFileToAgent(af) : null;
  }

  private async readSkill(key: string): Promise<Skill | null> {
    const path = join(this.skillsDir(), key, "skill.json");
    if (!(await exists(path))) return null;
    return readJson<SkillFile>(path);
  }

  private async loadSkillMap(): Promise<Map<string, Skill>> {
    const skills = await this.listSkills();
    return new Map(skills.map((s) => [s.key, s]));
  }

  private async readTaskFile(id: string): Promise<TaskFile | null> {
    const path = join(this.tasksDir(), id, "task.json");
    if (!(await exists(path))) return null;
    const raw = await readJson<Record<string, unknown>>(path);
    const tf = raw as unknown as TaskFile;
    if (!tf.priority) tf.priority = "medium";
    if (!tf.taskType) tf.taskType = "normal";
    if (tf.reviewedAt === undefined) tf.reviewedAt = null;
    if (tf.reviewNotes === undefined) tf.reviewNotes = null;
    if (tf.resultContent === undefined) tf.resultContent = null;
    if (tf.sourceTaskId === undefined) tf.sourceTaskId = null;
    if (tf.isFocus === undefined) tf.isFocus = false;
    if (tf.taskGroupId === undefined) tf.taskGroupId = null;
    if (tf.waitingReason === undefined) tf.waitingReason = null as WaitingReason | null;
    if (tf.blockingQuestion === undefined) tf.blockingQuestion = null;
    if (tf.blockedByTaskId === undefined) tf.blockedByTaskId = null;
    if (!tf.executionMode) tf.executionMode = "single";
    if (tf.orchestratorAgentId === undefined) tf.orchestratorAgentId = null;
    if (tf.maxRetries === undefined) tf.maxRetries = 3;
    if (tf.recurringRuleId === undefined) tf.recurringRuleId = null;
    if (tf.workspaceId === undefined) tf.workspaceId = null;
    return tf;
  }

  private async readTaskLogs(taskId: string): Promise<TaskLog[]> {
    const path = join(this.tasksDir(), taskId, "logs.json");
    if (!(await exists(path))) return [];
    return readJson<TaskLogFile[]>(path);
  }

  private async loadAllTasks(): Promise<Task[]> {
    const ids = await listDirs(this.tasksDir());
    const tasks: Task[] = [];
    for (const id of ids) {
      const tf = await this.readTaskFile(id);
      if (tf) tasks.push(tf);
    }
    return tasks;
  }

  // --- Task Groups ---

  private taskGroupsDir() { return join(this.workspaceRoot, "task-groups"); }

  async createTaskGroupFromDecomposition(
    taskId: string,
    input: CreateTaskGroupFromDecompositionInput,
  ): Promise<CreateTaskGroupResult> {
    const sourceTask = await this.readTaskFile(taskId);
    if (!sourceTask) throw new Error("Source task not found");

    const groupId = randomUUID();
    const now = new Date().toISOString();
    const groupFile: TaskGroupFile = {
      id: groupId,
      title: sourceTask.title,
      description: sourceTask.description,
      type: "decomposition",
      sourceTaskId: taskId,
      workspaceId: sourceTask.workspaceId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const groupDir = join(this.taskGroupsDir(), groupId);
    await ensureDir(groupDir);
    await writeJson(join(groupDir, "group.json"), groupFile);

    const createdTasks: Task[] = [];
    for (const item of input.tasks) {
      const task = await this.createTask({
        title: item.title,
        description: item.description,
        agentId: item.agentId,
        priority: item.priority,
      });
      const tf = await this.readTaskFile(task.id);
      if (tf) {
        tf.taskGroupId = groupId;
        tf.updatedAt = new Date().toISOString();
        await writeJson(join(this.tasksDir(), task.id, "task.json"), tf);
        createdTasks.push({ ...tf });
      }
    }

    return {
      taskGroup: groupFile as TaskGroup,
      tasks: createdTasks,
    };
  }

  async getTaskGroup(id: string): Promise<TaskGroupDetail | null> {
    const path = join(this.taskGroupsDir(), id, "group.json");
    if (!(await exists(path))) return null;
    const gf = await readJson<TaskGroupFile>(path);

    const allTasks = await this.loadAllTasks();
    const groupTasks = allTasks.filter((t) => t.taskGroupId === id);

    const tasksWithAgent: TaskWithAgent[] = [];
    for (const t of groupTasks) {
      const a = await this.readAgent(t.agentId);
      tasksWithAgent.push({
        ...t,
        agent: a ? { id: a.id, name: a.name } : { id: t.agentId, name: "Unknown" },
        taskGroup: { id: gf.id, title: gf.title },
      });
    }

    return {
      ...(gf as TaskGroup),
      tasks: tasksWithAgent,
    };
  }

  async listTaskGroups(workspaceId?: string): Promise<TaskGroup[]> {
    const dir = this.taskGroupsDir();
    if (!(await exists(dir))) return [];
    const ids = await listDirs(dir);
    const groups: TaskGroup[] = [];
    for (const id of ids) {
      const path = join(dir, id, "group.json");
      if (await exists(path)) {
        groups.push(await readJson<TaskGroupFile>(path) as TaskGroup);
      }
    }
    const filtered = workspaceId
      ? groups.filter((g) => g.workspaceId === workspaceId)
      : groups;
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filtered;
  }

  // --- Agent Templates ---

  async listAgentTemplates(): Promise<AgentTemplate[]> {
    return builtInTemplates;
  }

  async getAgentTemplate(id: string): Promise<AgentTemplateDetail | null> {
    const tpl = builtInTemplates.find((t) => t.id === id);
    if (!tpl) return null;

    const allSkills = await this.listSkills();
    const suggestedSkills = allSkills.filter((s) =>
      tpl.suggestedSkillKeys.includes(s.key),
    );

    return { ...tpl, suggestedSkills };
  }

  async createAgentFromTemplate(data: CreateAgentFromTemplateInput): Promise<Agent> {
    const tpl = builtInTemplates.find((t) => t.id === data.templateId);
    if (!tpl) throw new Error("Template not found");

    const agent = await this.createAgent({
      name: data.name,
      role: tpl.role,
      description: data.description ?? tpl.description,
      soul: data.soul || tpl.defaultSoul,
      agentConfig: data.agentConfig || tpl.defaultAgentConfig,
      identity: data.identity || tpl.defaultIdentity,
      user: data.user || tpl.defaultUser,
      tools: data.tools || tpl.defaultTools,
      heartbeat: data.heartbeat || tpl.defaultHeartbeat,
      bootstrap: data.bootstrap || tpl.defaultBootstrap,
    });

    if (data.model) {
      await this.updateAgent(agent.id, { model: data.model });
    }

    if (data.skillIds) {
      for (const skillId of data.skillIds) {
        try {
          await this.installSkill(agent.id, skillId);
        } catch {
          // skip skills that don't exist
        }
      }
    }

    return agent;
  }

  // --- Task Templates ---

  private templatesCacheDir() { return join(this.workspaceRoot, "task-templates"); }

  private async loadCustomTemplates(): Promise<TaskTemplate[]> {
    const dir = this.templatesCacheDir();
    if (!(await exists(dir))) return [];
    const ids = await listDirs(dir);
    const templates: TaskTemplate[] = [];
    for (const id of ids) {
      const path = join(dir, id, "template.json");
      if (await exists(path)) {
        templates.push(await readJson<TaskTemplate>(path));
      }
    }
    return templates;
  }

  private async writeCustomTemplate(tpl: TaskTemplate): Promise<void> {
    const dir = join(this.templatesCacheDir(), tpl.id);
    await ensureDir(dir);
    await writeJson(join(dir, "template.json"), tpl);
  }

  async syncExecutionSteps(): Promise<import("@opcify/core").TaskExecutionStep[]> {
    throw new Error("syncExecutionSteps not supported in FilesystemAdapter");
  }

  async listTaskTemplates(workspaceId?: string): Promise<TaskTemplate[]> {
    const custom = await this.loadCustomTemplates();
    const scoped = workspaceId
      ? custom.filter((t) => !t.workspaceId || t.workspaceId === workspaceId)
      : custom;
    return [...builtInTaskTemplates, ...scoped];
  }

  async getTaskTemplate(id: string): Promise<TaskTemplate | null> {
    const builtIn = builtInTaskTemplates.find((t) => t.id === id);
    if (builtIn) return builtIn;
    const custom = await this.loadCustomTemplates();
    return custom.find((t) => t.id === id) ?? null;
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
    const id = `ttpl-custom-${Date.now()}`;
    const template: TaskTemplate = {
      id,
      key: data.name.toLowerCase().replace(/\s+/g, "-"),
      ...data,
      isBuiltIn: false,
    };
    await this.writeCustomTemplate(template);
    return template;
  }

  async saveTemplateFromTask(taskId: string, input?: SaveTemplateFromTaskInput): Promise<TaskTemplate> {
    const tf = await this.readTaskFile(taskId);
    if (!tf) throw new Error("Task not found");

    const id = `ttpl-custom-${Date.now()}`;
    const template: TaskTemplate = {
      id,
      key: (input?.name ?? tf.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      name: input?.name ?? tf.title,
      category: "operations",
      description: tf.description,
      suggestedAgentRoles: [],
      defaultTitle: tf.title,
      defaultDescription: tf.description,
      defaultTags: [],
      defaultAgentId: tf.agentId,
      defaultPriority: tf.priority,
      sourceTaskId: taskId,
      isBuiltIn: false,
    };
    await this.writeCustomTemplate(template);
    return template;
  }

  async deleteTaskTemplate(id: string): Promise<void> {
    const builtIn = builtInTaskTemplates.find((t) => t.id === id);
    if (builtIn) throw new Error("Cannot delete built-in template");
    const dir = join(this.templatesCacheDir(), id);
    if (await exists(dir)) {
      await rmdir(dir);
    }
  }
}
