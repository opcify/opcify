import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CreateSkillDraftInput, CreateSkillDraftOutput } from "@opcify/core";
import { getSkillsSourceDir } from "../../workspace/WorkspaceConfig.js";

export async function scaffoldSkill(
  input: CreateSkillDraftInput,
): Promise<CreateSkillDraftOutput> {
  const skillDir = join(getSkillsSourceDir(), input.key);
  await mkdir(skillDir, { recursive: true });

  const inputs = input.inputs?.length ? input.inputs : ["input"];
  const outputs = input.outputs?.length ? input.outputs : ["success"];

  const skillJson = {
    key: input.key,
    name: input.name,
    description: input.description,
    inputs,
    outputs,
  };

  const handlerTs = `export async function handler(input: Record<string, unknown>) {
  // TODO: implement ${input.name} logic
  // Agent role: ${input.agentRole}
  //
  // Expected inputs: ${inputs.join(", ")}
  // Expected outputs: ${outputs.join(", ")}

  return { ${outputs.map((o) => `${o}: true`).join(", ")} };
}
`;

  const readmeMd = `# ${input.name}

${input.description}

## Agent Role

Designed for **${input.agentRole}** agents.

## Inputs

${inputs.map((i) => `- \`${i}\``).join("\n")}

## Outputs

${outputs.map((o) => `- \`${o}\``).join("\n")}

## Implementation

1. Open \`handler.ts\` and implement the skill logic
2. Update \`skill.json\` if inputs/outputs change
3. Test the handler locally
4. Install the skill to your agent via Opcify
`;

  await Promise.all([
    writeFile(join(skillDir, "skill.json"), JSON.stringify(skillJson, null, 2) + "\n"),
    writeFile(join(skillDir, "handler.ts"), handlerTs),
    writeFile(join(skillDir, "README.md"), readmeMd),
  ]);

  const relativePath = `templates/skills/${input.key}`;
  return {
    success: true,
    skillPath: relativePath,
    files: ["skill.json", "handler.ts", "README.md"],
  };
}
