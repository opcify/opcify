/**
 * Workspace Import/Export Foundation
 *
 * This module provides the service boundaries and manifest shape
 * for future workspace import/export functionality.
 *
 * Current status: Foundation only — not fully implemented.
 * The shapes and interfaces are defined to guide future development.
 */

import { prisma } from "../../db.js";
import { builtInTaskTemplates } from "../task-templates/built-in-templates.js";
import { listCapabilities } from "../openclaw-capabilities/service.js";

// --- Manifest Shape ---

export interface WorkspaceManifest {
  version: string;
  exportedAt: string;
  workspace: {
    name: string;
    slug: string;
    description: string;
    type: string;
    settingsJson: string | null;
  };
  agents: WorkspaceAgentExport[];
  skills: string[]; // skill keys
  taskTemplates: WorkspaceTaskTemplateExport[];
  taskGroups: WorkspaceTaskGroupExport[];
}

export interface WorkspaceAgentExport {
  name: string;
  role: string;
  description: string;
  model: string;
  skillKeys: string[];
  soul?: string | null;
  agentConfig?: string | null;
  identity?: string | null;
}

export interface WorkspaceTaskTemplateExport {
  key: string;
  name: string;
  category: string;
  description: string;
  defaultTitle: string;
  defaultDescription: string;
}

export interface WorkspaceTaskGroupExport {
  title: string;
  description: string;
  type: string;
}

// --- Export Service ---

export async function exportWorkspace(workspaceId: string): Promise<WorkspaceManifest> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      agents: {
        where: { deletedAt: null },
        include: {
          skills: {
            include: { skill: true },
          },
        },
      },
      taskGroups: true,
    },
  });

  if (!workspace) throw new Error("Workspace not found");

  const agents: WorkspaceAgentExport[] = workspace.agents.map((a) => ({
    name: a.name,
    role: a.role,
    description: a.description,
    model: a.model,
    skillKeys: a.skills.map((s) => s.skill.key),
    soul: a.soul,
    agentConfig: a.agentConfig,
    identity: a.identity,
  }));

  // Collect skills from DB (agentSkill records)
  const allSkillKeys = new Set<string>();
  for (const agent of workspace.agents) {
    for (const as of agent.skills) {
      allSkillKeys.add(as.skill.key);
    }
  }

  // Also collect non-bundled skills from OpenClaw capabilities (installed on disk)
  try {
    const caps = await listCapabilities(workspaceId);
    for (const s of caps.skills) {
      if (!s.bundled) {
        allSkillKeys.add(s.slug);
      }
    }
  } catch {
    // OpenClaw may not be running — use DB skills only
  }

  const taskGroups: WorkspaceTaskGroupExport[] = workspace.taskGroups.map((g) => ({
    title: g.title,
    description: g.description,
    type: g.type,
  }));

  return {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    workspace: {
      name: workspace.name,
      slug: workspace.slug,
      description: workspace.description,
      type: workspace.type,
      settingsJson: workspace.settingsJson,
    },
    agents,
    skills: Array.from(allSkillKeys),
    taskTemplates: builtInTaskTemplates.map((t) => ({
      key: t.key,
      name: t.name,
      category: t.category,
      description: t.description,
      defaultTitle: t.defaultTitle,
      defaultDescription: t.defaultDescription,
    })),
    taskGroups,
  };
}

// --- Import Service (placeholder) ---

export async function importWorkspace(
  _manifest: WorkspaceManifest,
): Promise<string> {
  // TODO: implement workspace import
  // Steps:
  // 1. Create workspace from manifest.workspace
  // 2. Resolve skill references
  // 3. Create agents with skill assignments
  // 4. Create task templates
  // 5. Create task groups
  // 6. Set workspace status to ready
  throw new Error("Workspace import not yet implemented");
}
