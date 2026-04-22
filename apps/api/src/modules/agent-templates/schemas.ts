import { z } from "zod";

export const templateIdParam = z.object({
  id: z.string().min(1),
});

export const createAgentFromTemplateBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  model: z.string().min(1).max(50).optional(),
  skillIds: z.array(z.string()).optional(),
  responsibilitiesSummary: z.string().max(2000).optional(),
  workspaceId: z.string().min(1).optional(),
  soul: z.string().max(10000).optional(),
  agentConfig: z.string().max(10000).optional(),
  identity: z.string().max(10000).optional(),
  tools: z.string().max(10000).optional(),
  user: z.string().max(10000).optional(),
  heartbeat: z.string().max(10000).optional(),
  bootstrap: z.string().max(10000).optional(),
});

export const templateFiltersQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
});
