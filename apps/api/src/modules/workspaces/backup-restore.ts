/**
 * Full Workspace Backup & Restore (v2)
 *
 * Backup format:
 *   { backupVersion, exportedAt, config: { workspace, agents, skills, taskTemplates }, data?: { ... } }
 *
 * Restore modes:
 *   - Config + Data  → full restore (workspace + all user data)
 *   - Config only    → workspace config restore (agents, skills, templates only)
 */

import { prisma } from "../../db.js";
import { z } from "zod";
import { createLogger } from "../../logger.js";
import { listCapabilities } from "../openclaw-capabilities/service.js";
import { syncAgentToWorkspace, syncAuthProfilesToWorkspace } from "../agents/workspace-sync.js";
import type { WorkspaceAISettings } from "@opcify/core";

const log = createLogger("backup_restore");

// ─── Backup Shape (v2) ────────────────────────────────────────────

export const BACKUP_VERSION = "2.0.0";

export interface WorkspaceBackup {
  backupVersion: string;
  exportedAt: string;
  config: BackupConfig;
  data?: BackupData;
}

export interface BackupConfig {
  workspace: {
    name: string;
    slug: string;
    description: string;
    type: string;
    settingsJson: string | null;
  };
  agents: BackupAgent[];
  skills: string[]; // skill keys
  taskTemplates: BackupTaskTemplate[];
}

export interface BackupAgent {
  name: string;
  role: string;
  description: string;
  model: string;
  skillKeys: string[];
  soul: string | null;
  agentConfig: string | null;
  identity: string | null;
}

export interface BackupTaskTemplate {
  key: string;
  name: string;
  category: string;
  description: string;
  suggestedAgentRoles: string[];
  defaultTitle: string;
  defaultDescription: string;
  defaultTags: string[];
  defaultPriority: string;
}

export interface BackupData {
  taskGroups: BackupTaskGroup[];
  tasks: BackupTask[];
  taskExecutionSteps: BackupTaskExecutionStep[];
  taskLogs: BackupTaskLog[];
  clients: BackupClient[];
  ledgerEntries: BackupLedgerEntry[];
  recurringRules: BackupRecurringRule[];
  inboxItems: BackupInboxItem[];
  notes: BackupNote[];
}

interface BackupTaskGroup {
  id: string;
  title: string;
  description: string;
  type: string;
  sourceTaskId: string | null;
}

interface BackupTask {
  id: string;
  title: string;
  description: string;
  taskType: string;
  agentName: string; // resolved name for restore
  status: string;
  priority: string;
  progress: number;
  reviewStatus: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  resultSummary: string | null;
  resultContent: string | null;
  sourceTaskId: string | null;
  plannedDate: string | null;
  isFocus: boolean;
  taskGroupId: string | null;
  waitingReason: string | null;
  blockedByTaskId: string | null;
  executionMode: string;
  orchestratorAgentName: string | null;
  clientName: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface BackupTaskExecutionStep {
  id: string;
  taskId: string;
  stepOrder: number;
  agentName: string | null;
  roleLabel: string | null;
  title: string | null;
  instruction: string | null;
  status: string;
  outputSummary: string | null;
  outputContent: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

interface BackupTaskLog {
  id: string;
  taskId: string;
  level: string;
  message: string;
  createdAt: string;
}

interface BackupClient {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  status: string;
}

interface BackupLedgerEntry {
  id: string;
  type: string;
  amount: number;
  currency: string;
  clientName: string | null;
  taskId: string | null;
  category: string | null;
  description: string;
  attachmentType: string | null;
  attachmentUrl: string | null;
  notes: string | null;
  entryDate: string;
}

interface BackupRecurringRule {
  id: string;
  title: string;
  frequency: string;
  interval: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number | null;
  minute: number | null;
  startDate: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  isActive: boolean;
  agentName: string | null;
  clientName: string | null;
  presetData: string | null;
}

interface BackupInboxItem {
  id: string;
  content: string;
  status: string;
  kind: string | null;
  source: string;
  snoozedUntil: string | null;
  emailMessageId: string | null;
  emailFrom: string | null;
  emailTo: string | null;
  emailSubject: string | null;
  emailDate: string | null;
  emailThreadId: string | null;
  emailInReplyTo: string | null;
  emailLabels: string | null;
  emailIsRead: boolean;
  aiSummary: string | null;
  aiUrgency: string | null;
  aiSuggestedAction: string | null;
  aiDraftReply: string | null;
  actionTaken: string | null;
  actionAgentId: string | null;
  linkedClientId: string | null;
}

interface BackupNote {
  id: string;
  title: string;
  contentMarkdown: string;
  clientName: string | null;
  isArchived: boolean;
}

// ─── Validation ─────────────────────────────────────────────────────

const configSchema = z.object({
  workspace: z.object({
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    type: z.string(),
    settingsJson: z.string().nullable(),
  }),
  agents: z.array(z.object({
    name: z.string(),
    role: z.string(),
    description: z.string(),
    model: z.string(),
    skillKeys: z.array(z.string()),
  }).passthrough()),
  skills: z.array(z.string()),
  taskTemplates: z.array(z.object({
    key: z.string(),
    name: z.string(),
  }).passthrough()),
});

export const backupSchema = z.object({
  backupVersion: z.string(),
  exportedAt: z.string(),
  config: configSchema,
  data: z.object({
    taskGroups: z.array(z.any()),
    tasks: z.array(z.any()),
    taskExecutionSteps: z.array(z.any()),
    taskLogs: z.array(z.any()),
    clients: z.array(z.any()),
    ledgerEntries: z.array(z.any()),
    recurringRules: z.array(z.any()),
    inboxItems: z.array(z.any()),
    notes: z.array(z.any()),
  }).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────

function toISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function toDate(s: string | null | undefined): Date | null {
  return s ? new Date(s) : null;
}

// ─── Export (Full Backup) ───────────────────────────────────────────

export async function backupWorkspace(workspaceId: string): Promise<WorkspaceBackup> {
  log.info("Starting workspace backup", { workspaceId });
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new Error("Workspace not found");

  // Agents (active only) with their skill keys
  const agents = await prisma.agent.findMany({
    where: { workspaceId, deletedAt: null },
    include: { skills: { include: { skill: true } } },
  });

  // Collect all skill keys (from agent assignments + OpenClaw capabilities)
  const allSkillKeys = new Set<string>();
  const agentExports: BackupAgent[] = agents.map((a) => {
    const skillKeys = a.skills.map((as) => as.skill.key);
    for (const k of skillKeys) allSkillKeys.add(k);
    return {
      name: a.name,
      role: a.role,
      description: a.description,
      model: a.model,
      skillKeys,
      soul: a.soul ?? null,
      agentConfig: a.agentConfig ?? null,
      identity: a.identity ?? null,
    };
  });

  try {
    const caps = await listCapabilities(workspaceId);
    for (const s of caps.skills) {
      if (!s.bundled) allSkillKeys.add(s.slug);
    }
  } catch { /* OpenClaw may not be running */ }

  // Task templates
  const taskTemplateRows = await prisma.taskTemplate.findMany({ where: { workspaceId } });
  const taskTemplates: BackupTaskTemplate[] = taskTemplateRows.map((t) => ({
    key: t.key,
    name: t.name,
    category: t.category,
    description: t.description,
    suggestedAgentRoles: JSON.parse(t.suggestedAgentRoles) as string[],
    defaultTitle: t.defaultTitle,
    defaultDescription: t.defaultDescription,
    defaultTags: JSON.parse(t.defaultTags) as string[],
    defaultPriority: t.defaultPriority,
  }));

  // Build agent ID → name maps for resolving references in data
  const agentIdToName = new Map(agents.map((a) => [a.id, a.name]));

  // ─── Data section ───
  const taskGroups = await prisma.taskGroup.findMany({ where: { workspaceId } });
  const tasks = await prisma.task.findMany({ where: { workspaceId } });
  const taskIds = tasks.map((t) => t.id);

  const executionSteps = await prisma.taskExecutionStep.findMany({
    where: { taskId: { in: taskIds } },
    orderBy: [{ taskId: "asc" }, { stepOrder: "asc" }],
  });
  const taskLogs = await prisma.taskLog.findMany({
    where: { taskId: { in: taskIds } },
    orderBy: { createdAt: "asc" },
  });

  const clients = await prisma.client.findMany({ where: { workspaceId } });
  const clientIdToName = new Map(clients.map((c) => [c.id, c.name]));

  const ledgerEntries = await prisma.ledgerEntry.findMany({ where: { workspaceId } });
  const recurringRules = await prisma.recurringRule.findMany({ where: { workspaceId } });
  const inboxItems = await prisma.inboxItem.findMany({ where: { workspaceId } });
  const notes = await prisma.note.findMany({ where: { workspaceId } });

  return {
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    config: {
      workspace: {
        name: workspace.name,
        slug: workspace.slug,
        description: workspace.description,
        type: workspace.type,
        settingsJson: workspace.settingsJson,
      },
      agents: agentExports,
      skills: Array.from(allSkillKeys),
      taskTemplates,
    },
    data: {
      taskGroups: taskGroups.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        type: g.type,
        sourceTaskId: g.sourceTaskId,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        taskType: t.taskType,
        agentName: agentIdToName.get(t.agentId) ?? "unknown",
        status: t.status,
        priority: t.priority,
        progress: t.progress,
        reviewStatus: t.reviewStatus,
        reviewedAt: toISO(t.reviewedAt),
        reviewNotes: t.reviewNotes,
        resultSummary: t.resultSummary,
        resultContent: t.resultContent,
        sourceTaskId: t.sourceTaskId,
        plannedDate: toISO(t.plannedDate),
        isFocus: t.isFocus,
        taskGroupId: t.taskGroupId,
        waitingReason: t.waitingReason,
        blockedByTaskId: t.blockedByTaskId,
        executionMode: t.executionMode,
        orchestratorAgentName: t.orchestratorAgentId ? (agentIdToName.get(t.orchestratorAgentId) ?? null) : null,
        clientName: t.clientId ? (clientIdToName.get(t.clientId) ?? null) : null,
        createdAt: t.createdAt.toISOString(),
        finishedAt: toISO(t.finishedAt),
      })),
      taskExecutionSteps: executionSteps.map((s) => ({
        id: s.id,
        taskId: s.taskId,
        stepOrder: s.stepOrder,
        agentName: s.agentName ?? (s.agentId ? (agentIdToName.get(s.agentId) ?? null) : null),
        roleLabel: s.roleLabel,
        title: s.title,
        instruction: s.instruction,
        status: s.status,
        outputSummary: s.outputSummary,
        outputContent: s.outputContent,
        startedAt: toISO(s.startedAt),
        finishedAt: toISO(s.finishedAt),
      })),
      taskLogs: taskLogs.map((l) => ({
        id: l.id,
        taskId: l.taskId,
        level: l.level,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
      })),
      clients: clients.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        email: c.email,
        phone: c.phone,
        website: c.website,
        address: c.address,
        notes: c.notes,
        status: c.status,
      })),
      ledgerEntries: ledgerEntries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        currency: e.currency,
        clientName: e.clientId ? (clientIdToName.get(e.clientId) ?? null) : null,
        taskId: e.taskId,
        category: e.category,
        description: e.description,
        attachmentType: e.attachmentType,
        attachmentUrl: e.attachmentUrl,
        notes: e.notes,
        entryDate: e.entryDate.toISOString(),
      })),
      recurringRules: recurringRules.map((r) => ({
        id: r.id,
        title: r.title,
        frequency: r.frequency,
        interval: r.interval,
        dayOfWeek: r.dayOfWeek,
        dayOfMonth: r.dayOfMonth,
        hour: r.hour,
        minute: r.minute,
        startDate: toISO(r.startDate),
        nextRunAt: r.nextRunAt.toISOString(),
        lastRunAt: toISO(r.lastRunAt),
        isActive: r.isActive,
        agentName: r.agentId ? (agentIdToName.get(r.agentId) ?? null) : null,
        clientName: r.clientId ? (clientIdToName.get(r.clientId) ?? null) : null,
        presetData: r.presetData,
      })),
      inboxItems: inboxItems.map((i) => ({
        id: i.id,
        content: i.content,
        status: i.status,
        kind: i.kind,
        source: i.source,
        snoozedUntil: toISO(i.snoozedUntil),
        emailMessageId: i.emailMessageId,
        emailFrom: i.emailFrom,
        emailTo: i.emailTo,
        emailSubject: i.emailSubject,
        emailDate: toISO(i.emailDate),
        emailThreadId: i.emailThreadId,
        emailInReplyTo: i.emailInReplyTo,
        emailLabels: i.emailLabels,
        emailIsRead: i.emailIsRead,
        aiSummary: i.aiSummary,
        aiUrgency: i.aiUrgency,
        aiSuggestedAction: i.aiSuggestedAction,
        aiDraftReply: i.aiDraftReply,
        actionTaken: i.actionTaken,
        actionAgentId: i.actionAgentId,
        linkedClientId: i.linkedClientId,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        contentMarkdown: n.contentMarkdown,
        clientName: n.clientId ? (clientIdToName.get(n.clientId) ?? null) : null,
        isArchived: n.isArchived,
      })),
    },
  };
}

// ─── Restore ──────────────────────��───────────────────────────────

export interface RestoreResult {
  workspaceId: string;
  mode: "full" | "config-only";
  counts: Record<string, number>;
}

export async function restoreWorkspace(backup: WorkspaceBackup, overrideName?: string, userId?: string): Promise<RestoreResult> {
  log.info("Starting workspace restore", { backupVersion: backup.backupVersion });

  backupSchema.parse(backup);

  const wsName = overrideName?.trim() || backup.config.workspace.name;

  // Check for duplicate workspace name
  const existing = await prisma.workspace.findFirst({
    where: { name: wsName, status: { not: "archived" } },
  });
  if (existing) {
    throw new Error(`A workspace named "${wsName}" already exists. Please choose a different name.`);
  }

  const hasData = !!backup.data;
  const mode = hasData ? "full" : "config-only";

  const { randomBytes } = await import("node:crypto");
  function genId(): string {
    return randomBytes(16).toString("base64url").slice(0, 25).toLowerCase();
  }

  const idMap = new Map<string, string>();
  function remap(oldId: string): string {
    if (!idMap.has(oldId)) idMap.set(oldId, genId());
    return idMap.get(oldId)!;
  }
  function remapNullable(oldId: string | null): string | null {
    return oldId ? remap(oldId) : null;
  }

  // Generate slug from name
  const baseSlug = wsName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  let slug = baseSlug;
  let attempt = 0;
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }

  const wsId = genId();
  const counts: Record<string, number> = {};

  await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    // ── Workspace ──
    await tx.workspace.create({
      data: {
        id: wsId,
        name: wsName,
        slug,
        description: backup.config.workspace.description,
        type: backup.config.workspace.type,
        status: "ready",
        settingsJson: backup.config.workspace.settingsJson,
        isDefault: false,
        userId: userId ?? null,
      },
    });

    // ── Skills (upsert by key) ──
    const skillKeyToId = new Map<string, string>();
    for (const key of backup.config.skills) {
      const existing = await tx.skill.findUnique({ where: { key } });
      if (existing) {
        skillKeyToId.set(key, existing.id);
      } else {
        const id = genId();
        await tx.skill.create({ data: { id, key, name: key } });
        skillKeyToId.set(key, id);
      }
    }
    counts.skills = backup.config.skills.length;

    // ── Agents + skill assignments ──
    const agentNameToId = new Map<string, string>();
    for (const agent of backup.config.agents) {
      const agentId = genId();
      agentNameToId.set(agent.name, agentId);
      await tx.agent.create({
        data: {
          id: agentId,
          name: agent.name,
          role: agent.role,
          description: agent.description,
          model: agent.model,
          soul: agent.soul ?? null,
          agentConfig: agent.agentConfig ?? null,
          identity: agent.identity ?? null,
          status: "idle",
          workspaceId: wsId,
        },
      });
      for (const sk of agent.skillKeys) {
        const skillId = skillKeyToId.get(sk);
        if (skillId) {
          await tx.agentSkill.create({ data: { agentId, skillId } }).catch(() => {});
        }
      }
    }
    counts.agents = backup.config.agents.length;

    // ── Task Templates ──
    for (const tpl of backup.config.taskTemplates) {
      // Avoid duplicate keys
      const exists = await tx.taskTemplate.findUnique({ where: { key: tpl.key } });
      if (!exists) {
        await tx.taskTemplate.create({
          data: {
            key: tpl.key,
            name: tpl.name,
            category: tpl.category ?? "operations",
            description: tpl.description ?? "",
            suggestedAgentRoles: JSON.stringify(tpl.suggestedAgentRoles ?? []),
            defaultTitle: tpl.defaultTitle ?? "",
            defaultDescription: tpl.defaultDescription ?? "",
            defaultTags: JSON.stringify(tpl.defaultTags ?? []),
            defaultPriority: tpl.defaultPriority ?? "medium",
            workspaceId: wsId,
          },
        });
      }
    }
    counts.taskTemplates = backup.config.taskTemplates.length;

    // ── Data section (full restore only) ──
    if (!backup.data) return;
    const data = backup.data;

    // Clients (needed for task/ledger/note references)
    const clientNameToId = new Map<string, string>();
    for (const c of data.clients) {
      const cid = remap(c.id);
      clientNameToId.set(c.name, cid);
      await tx.client.create({
        data: {
          id: cid,
          workspaceId: wsId,
          name: c.name,
          company: c.company ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          website: c.website ?? null,
          address: c.address ?? null,
          notes: c.notes ?? null,
          status: c.status ?? "active",
        },
      });
    }
    counts.clients = data.clients.length;

    // Task groups
    for (const g of data.taskGroups) {
      await tx.taskGroup.create({
        data: {
          id: remap(g.id),
          title: g.title,
          description: g.description,
          type: g.type,
          sourceTaskId: null,
          workspaceId: wsId,
        },
      });
    }
    counts.taskGroups = data.taskGroups.length;

    // Tasks (first pass — no cross-references)
    for (const t of data.tasks) {
      const agentId = agentNameToId.get(t.agentName);
      if (!agentId) continue; // skip tasks for unknown agents
      await tx.task.create({
        data: {
          id: remap(t.id),
          title: t.title,
          description: t.description,
          taskType: t.taskType,
          agentId,
          status: t.status,
          priority: t.priority,
          progress: t.progress,
          reviewStatus: t.reviewStatus ?? null,
          reviewedAt: toDate(t.reviewedAt),
          reviewNotes: t.reviewNotes ?? null,
          resultSummary: t.resultSummary ?? null,
          resultContent: t.resultContent ?? null,
          sourceTaskId: null,
          plannedDate: toDate(t.plannedDate),
          isFocus: t.isFocus ?? false,
          taskGroupId: t.taskGroupId ? remapNullable(t.taskGroupId) : null,
          waitingReason: t.waitingReason ?? null,
          blockedByTaskId: null,
          executionMode: t.executionMode ?? "single",
          orchestratorAgentId: t.orchestratorAgentName ? (agentNameToId.get(t.orchestratorAgentName) ?? null) : null,
          clientId: t.clientName ? (clientNameToId.get(t.clientName) ?? null) : null,
          workspaceId: wsId,
          finishedAt: toDate(t.finishedAt),
        },
      });
    }
    counts.tasks = data.tasks.length;

    // Patch task cross-references
    for (const t of data.tasks) {
      const patches: Record<string, string | null> = {};
      if (t.sourceTaskId) patches.sourceTaskId = remap(t.sourceTaskId);
      if (t.blockedByTaskId) patches.blockedByTaskId = remap(t.blockedByTaskId);
      if (Object.keys(patches).length > 0) {
        await tx.task.update({ where: { id: remap(t.id) }, data: patches }).catch(() => {});
      }
    }

    // Patch task group sourceTaskId
    for (const g of data.taskGroups) {
      if (g.sourceTaskId) {
        await tx.taskGroup.update({
          where: { id: remap(g.id) },
          data: { sourceTaskId: remap(g.sourceTaskId) },
        }).catch(() => {});
      }
    }

    // Execution steps
    for (const s of data.taskExecutionSteps) {
      await tx.taskExecutionStep.create({
        data: {
          id: remap(s.id),
          taskId: remap(s.taskId),
          stepOrder: s.stepOrder,
          agentId: null,
          agentName: s.agentName ?? null,
          roleLabel: s.roleLabel ?? null,
          title: s.title ?? null,
          instruction: s.instruction ?? null,
          status: s.status,
          outputSummary: s.outputSummary ?? null,
          outputContent: s.outputContent ?? null,
          startedAt: toDate(s.startedAt),
          finishedAt: toDate(s.finishedAt),
        },
      }).catch(() => {});
    }
    counts.taskExecutionSteps = data.taskExecutionSteps.length;

    // Task logs
    for (const l of data.taskLogs) {
      await tx.taskLog.create({
        data: {
          id: remap(l.id),
          taskId: remap(l.taskId),
          level: l.level,
          message: l.message,
          createdAt: toDate(l.createdAt) ?? new Date(),
        },
      }).catch(() => {});
    }
    counts.taskLogs = data.taskLogs.length;

    // Ledger entries
    for (const e of data.ledgerEntries) {
      await tx.ledgerEntry.create({
        data: {
          id: remap(e.id),
          workspaceId: wsId,
          type: e.type,
          amount: e.amount,
          currency: e.currency ?? "USD",
          clientId: e.clientName ? (clientNameToId.get(e.clientName) ?? null) : null,
          taskId: e.taskId ? remapNullable(e.taskId) : null,
          category: e.category ?? null,
          description: e.description,
          attachmentType: e.attachmentType ?? null,
          attachmentUrl: e.attachmentUrl ?? null,
          notes: e.notes ?? null,
          entryDate: toDate(e.entryDate) ?? new Date(),
        },
      }).catch(() => {});
    }
    counts.ledgerEntries = data.ledgerEntries.length;

    // Recurring rules
    for (const r of data.recurringRules) {
      await tx.recurringRule.create({
        data: {
          id: remap(r.id),
          workspaceId: wsId,
          title: r.title,
          frequency: r.frequency,
          interval: r.interval ?? 1,
          dayOfWeek: r.dayOfWeek ?? null,
          dayOfMonth: r.dayOfMonth ?? null,
          hour: r.hour ?? null,
          minute: r.minute ?? null,
          startDate: toDate(r.startDate),
          nextRunAt: toDate(r.nextRunAt) ?? new Date(),
          lastRunAt: toDate(r.lastRunAt),
          isActive: r.isActive ?? true,
          agentId: r.agentName ? (agentNameToId.get(r.agentName) ?? null) : null,
          clientId: r.clientName ? (clientNameToId.get(r.clientName) ?? null) : null,
          presetData: r.presetData ?? null,
        },
      }).catch(() => {});
    }
    counts.recurringRules = data.recurringRules.length;

    // Inbox items
    for (const i of data.inboxItems) {
      await tx.inboxItem.create({
        data: {
          id: remap(i.id),
          content: i.content,
          status: i.status ?? "inbox",
          kind: i.kind ?? null,
          source: i.source ?? "manual",
          snoozedUntil: toDate(i.snoozedUntil),
          workspaceId: wsId,
          emailMessageId: i.emailMessageId ?? null,
          emailFrom: i.emailFrom ?? null,
          emailTo: i.emailTo ?? null,
          emailSubject: i.emailSubject ?? null,
          emailDate: toDate(i.emailDate),
          emailThreadId: i.emailThreadId ?? null,
          emailInReplyTo: i.emailInReplyTo ?? null,
          emailLabels: i.emailLabels ?? null,
          emailIsRead: i.emailIsRead ?? false,
          aiSummary: i.aiSummary ?? null,
          aiUrgency: i.aiUrgency ?? null,
          aiSuggestedAction: i.aiSuggestedAction ?? null,
          aiDraftReply: i.aiDraftReply ?? null,
          actionTaken: i.actionTaken ?? null,
          actionAgentId: i.actionAgentId ?? null,
          linkedClientId: i.linkedClientId ?? null,
        },
      }).catch(() => {});
    }
    counts.inboxItems = data.inboxItems.length;

    // Notes
    for (const n of data.notes) {
      await tx.note.create({
        data: {
          id: remap(n.id),
          workspaceId: wsId,
          title: n.title,
          contentMarkdown: n.contentMarkdown ?? "",
          clientId: n.clientName ? (clientNameToId.get(n.clientName) ?? null) : null,
          isArchived: n.isArchived ?? false,
        },
      }).catch(() => {});
    }
    counts.notes = data.notes.length;
  });

  log.info("Workspace restore completed", { workspaceId: wsId, mode, counts });

  // ── Post-restore: sync agents to disk and provision Docker containers ──
  // This runs after the DB transaction so all records exist.
  try {
    // Sync each agent's workspace files (SOUL.md, AGENTS.md, etc.) to disk
    const restoredAgents = await prisma.agent.findMany({
      where: { workspaceId: wsId, deletedAt: null },
    });
    for (const agent of restoredAgents) {
      await syncAgentToWorkspace(wsId, {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        model: agent.model,
        soul: agent.soul,
        agentConfig: agent.agentConfig,
        identity: agent.identity,
        isSystem: agent.isSystem,
        status: agent.status,
      });
    }

    // Sync AI provider API keys to agent auth-profiles.json
    const ws = await prisma.workspace.findUnique({ where: { id: wsId } });
    if (ws?.settingsJson) {
      try {
        const aiSettings = JSON.parse(ws.settingsJson) as WorkspaceAISettings;
        const providers = (aiSettings.providers ?? [])
          .filter((p) => p.apiKey)
          .map((p) => ({ id: p.id, apiKey: p.apiKey }));
        await syncAuthProfilesToWorkspace(wsId, providers);
      } catch {
        log.warn("Could not sync AI provider keys after restore", { workspaceId: wsId });
      }
    }

    // Provision Docker containers in the background, then install skills
    const skillKeys = backup.config.skills;
    const { workspaceService } = await import("../../workspace/WorkspaceService.js");
    workspaceService.create(wsId, {}).then(
      async () => {
        log.info("Docker containers provisioned for restored workspace", { workspaceId: wsId });
        // Install OpenClaw skills (requires running gateway)
        if (skillKeys.length > 0) {
          const { installSkillBySlug, invalidateCapabilitiesCache } = await import("../openclaw-capabilities/service.js");
          for (const sk of skillKeys) {
            try {
              await installSkillBySlug(wsId, sk);
            } catch {
              log.warn(`Could not install skill "${sk}" during restore`, { workspaceId: wsId });
            }
          }
          invalidateCapabilitiesCache(wsId);
          log.info("Installed skills for restored workspace", { workspaceId: wsId, count: skillKeys.length });
        }
      },
      (err: unknown) => log.warn("Docker provisioning failed for restored workspace", {
        workspaceId: wsId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  } catch (err) {
    log.warn("Post-restore provisioning failed (workspace is still usable)", {
      workspaceId: wsId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { workspaceId: wsId, mode, counts };
}
