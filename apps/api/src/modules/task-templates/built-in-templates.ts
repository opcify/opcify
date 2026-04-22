import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TaskTemplate, TaskTemplateCategory } from "@opcify/core";
import { parseFrontmatter, readMd, findProjectRoot } from "../../lib/frontmatter.js";

const TASK_CATEGORIES: readonly TaskTemplateCategory[] = [
  "research",
  "reporting",
  "content",
  "operations",
  "sales",
];

function coerceTaskCategory(raw: unknown): TaskTemplateCategory {
  if (typeof raw === "string" && (TASK_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as TaskTemplateCategory;
  }
  return "operations";
}

function loadTaskTemplate(dir: string): TaskTemplate {
  const key = dir.split("/").pop()!;
  const raw = readMd(join(dir, "template.md"));
  const { meta } = parseFrontmatter(raw);

  return {
    id: (meta.id as string) || key,
    key,
    name: meta.name as string,
    category: coerceTaskCategory(meta.category),
    description: (meta.description as string) || "",
    suggestedAgentRoles: (meta.suggestedAgentRoles as string[]) || [],
    defaultTitle: (meta.defaultTitle as string) || "",
    defaultDescription: (meta.defaultDescription as string) || "",
    defaultTags: (meta.defaultTags as string[]) || [],
    isBuiltIn: true,
  };
}

const TEMPLATES_DIR = join(
  findProjectRoot(),
  "templates",
  "tasks",
);

const templateDirs = readdirSync(TEMPLATES_DIR).filter((name) =>
  statSync(join(TEMPLATES_DIR, name)).isDirectory(),
);

export const builtInTaskTemplates: TaskTemplate[] = templateDirs.map((name) =>
  loadTaskTemplate(join(TEMPLATES_DIR, name)),
);
