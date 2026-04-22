import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentTemplate, AgentTemplateCategory } from "@opcify/core";
import { parseFrontmatter, readMd, findProjectRoot } from "../../lib/frontmatter.js";

const AGENT_CATEGORIES: readonly AgentTemplateCategory[] = [
  "research",
  "content",
  "assistant",
  "operations",
  "support",
  "sales",
];

function coerceAgentCategory(raw: unknown): AgentTemplateCategory {
  if (typeof raw === "string" && (AGENT_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as AgentTemplateCategory;
  }
  return "operations"; // sensible default — must be a member of the union
}

function loadAgentTemplate(dir: string): AgentTemplate {
  const key = dir.split("/").pop()!;
  const raw = readMd(join(dir, "template.md"));
  const { meta } = parseFrontmatter(raw);

  return {
    id: (meta.id as string) || key,
    key,
    name: meta.name as string,
    role: meta.role as string,
    category: coerceAgentCategory(meta.category),
    description: meta.description as string,
    defaultModel: (meta.defaultModel as string) || "gpt-5.4",
    responsibilitiesSummary: (meta.responsibilitiesSummary as string) || "",
    suggestedSkillKeys: (meta.suggestedSkillKeys as string[]) || [],
    isBuiltIn: true,
    defaultSoul: readMd(join(dir, "SOUL.md")),
    defaultAgentConfig: readMd(join(dir, "AGENTS.md")),
    defaultIdentity: readMd(join(dir, "IDENTITY.md")),
    defaultTools: readMd(join(dir, "TOOLS.md")),
    defaultUser: readMd(join(dir, "USER.md")),
    defaultHeartbeat: readMd(join(dir, "HEARTBEAT.md")),
    defaultBootstrap: readMd(join(dir, "BOOTSTRAP.md")),
  };
}

const TEMPLATES_DIR = join(
  findProjectRoot(),
  "templates",
  "agents",
);

const templateDirs = readdirSync(TEMPLATES_DIR).filter((name) =>
  statSync(join(TEMPLATES_DIR, name)).isDirectory(),
);

export const builtInTemplates: AgentTemplate[] = templateDirs.map((name) =>
  loadAgentTemplate(join(TEMPLATES_DIR, name)),
);
