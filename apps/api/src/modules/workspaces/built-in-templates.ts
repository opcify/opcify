import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  WorkspaceTemplateConfig,
  WorkspaceTemplateAgent,
} from "@opcify/core";
import { parseFrontmatter, readMd, findProjectRoot } from "../../lib/frontmatter.js";

export interface BuiltInWorkspaceTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  config: WorkspaceTemplateConfig;
}

// ---------------------------------------------------------------------------
// Load a single template from its directory
// ---------------------------------------------------------------------------

function loadTemplate(templateDir: string): BuiltInWorkspaceTemplate {
  const key = templateDir.split("/").pop()!;
  const workspaceMd = readMd(join(templateDir, "workspace.md"));
  const ws = parseFrontmatter(workspaceMd);

  // Load agents from agents/ subdirectories
  const agentsDir = join(templateDir, "agents");
  const agentDirs = readdirSync(agentsDir).filter((name) =>
    statSync(join(agentsDir, name)).isDirectory(),
  );

  const agents: WorkspaceTemplateAgent[] = agentDirs.map((dirName) => {
    const dir = join(agentsDir, dirName);
    const identityRaw = readMd(join(dir, "IDENTITY.md"));
    const identity = parseFrontmatter(identityRaw);

    return {
      name: identity.meta.name as string,
      role: identity.meta.role as string,
      description: identity.meta.description as string,
      model: (identity.meta.model as string) || undefined,
      skillKeys: (identity.meta.skillKeys as string[]) || undefined,
      soul: readMd(join(dir, "SOUL.md")),
      agentConfig: readMd(join(dir, "AGENTS.md")),
      identity: identity.content,
      user: readMd(join(dir, "USER.md")),
      tools: readMd(join(dir, "TOOLS.md")),
      heartbeat: readMd(join(dir, "HEARTBEAT.md")),
      bootstrap: readMd(join(dir, "BOOTSTRAP.md")),
    };
  });

  return {
    key,
    name: ws.meta.name as string,
    description: ws.meta.description as string,
    category: (ws.meta.category as string) || "general",
    icon: (ws.meta.icon as string) || "layout-dashboard",
    config: {
      agents,
      skills: (ws.meta.skills as string[]) || [],
      taskTemplates: (ws.meta.taskTemplates as string[]) || [],
      demoData: ws.meta.demoData === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Discover and load all templates
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = join(
  findProjectRoot(),
  "templates",
  "workspaces",
);

const templateDirs = readdirSync(TEMPLATES_DIR).filter((name) =>
  statSync(join(TEMPLATES_DIR, name)).isDirectory(),
);

export const builtInWorkspaceTemplates: BuiltInWorkspaceTemplate[] =
  templateDirs.map((name) => loadTemplate(join(TEMPLATES_DIR, name)));
