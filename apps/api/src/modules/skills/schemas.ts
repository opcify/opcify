import { z } from "zod";

export const agentIdParam = z.object({
  id: z.string().min(1),
});

export const workspaceAgentParams = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
});

export const workspaceAgentSkillParams = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
  skillId: z.string().min(1),
});

export const installSkillSchema = z.object({
  skillId: z.string().min(1),
});
