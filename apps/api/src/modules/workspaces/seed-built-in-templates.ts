import { builtInWorkspaceTemplates } from "./built-in-templates.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";

const log = createLogger("seed_templates");

export async function seedBuiltInWorkspaceTemplates(): Promise<void> {
  for (const t of builtInWorkspaceTemplates) {
    await prisma.workspaceTemplate.upsert({
      where: { key: t.key },
      update: {
        name: t.name,
        description: t.description,
        category: t.category,
        icon: t.icon,
        isBuiltIn: true,
        configJson: JSON.stringify(t.config),
      },
      create: {
        key: t.key,
        name: t.name,
        description: t.description,
        category: t.category,
        icon: t.icon,
        isBuiltIn: true,
        configJson: JSON.stringify(t.config),
      },
    });
  }
  log.info("Seeded built-in workspace templates", {
    count: builtInWorkspaceTemplates.length,
  });
}
