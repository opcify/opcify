import type { Skill, SkillAdvice, MissingSkill } from "@opcify/core";
import { getExpectedSkills } from "./role-map.js";

export function analyzeSkills(
  role: string,
  installedSkills: Skill[],
  catalogSkills: Skill[],
): SkillAdvice {
  const expected = getExpectedSkills(role);
  const installedKeys = new Set(installedSkills.map((s) => s.key));
  const catalogByKey = new Map(catalogSkills.map((s) => [s.key, s]));

  const recommendedSkills: Skill[] = [];
  const missingSkills: MissingSkill[] = [];

  for (const exp of expected) {
    if (installedKeys.has(exp.key)) continue;

    const catalogEntry = catalogByKey.get(exp.key);
    if (catalogEntry) {
      recommendedSkills.push(catalogEntry);
    } else {
      missingSkills.push({
        key: exp.key,
        name: exp.name,
        description: exp.description,
      });
    }
  }

  return { installedSkills, recommendedSkills, missingSkills };
}
