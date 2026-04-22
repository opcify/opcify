import { PrismaClient } from "@prisma/client";
import { builtInWorkspaceTemplates } from "./seed-data/workspace-templates.js";

const prisma = new PrismaClient();

async function main() {
  await prisma.recurringRule.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.taskExecutionStep.deleteMany();
  await prisma.taskLog.deleteMany();
  await prisma.task.deleteMany();
  await prisma.taskGroup.deleteMany();
  await prisma.agentSkill.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.client.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.workspaceTemplate.deleteMany();

  // Re-seed built-in workspace templates
  for (const t of builtInWorkspaceTemplates) {
    await prisma.workspaceTemplate.create({
      data: {
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

  console.log(
    "Database reset complete — all tables cleared, built-in templates re-seeded.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
