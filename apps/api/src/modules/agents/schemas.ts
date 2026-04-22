import { z } from "zod";

const MD_MAX = 50000;

export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  model: z.string().min(1).max(50).optional(),
  soul: z.string().max(MD_MAX).optional(),
  agentConfig: z.string().max(MD_MAX).optional(),
  identity: z.string().max(MD_MAX).optional(),
  user: z.string().max(MD_MAX).optional(),
  tools: z.string().max(MD_MAX).optional(),
  heartbeat: z.string().max(MD_MAX).optional(),
  bootstrap: z.string().max(MD_MAX).optional(),
  workspaceId: z.string().min(1).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().min(1).max(50).optional(),
  description: z.string().max(500).optional(),
  model: z.string().min(1).max(50).optional(),
  maxConcurrent: z.number().int().min(1).max(10).optional(),
  soul: z.string().max(MD_MAX).nullable().optional(),
  agentConfig: z.string().max(MD_MAX).nullable().optional(),
  identity: z.string().max(MD_MAX).nullable().optional(),
  user: z.string().max(MD_MAX).nullable().optional(),
  tools: z.string().max(MD_MAX).nullable().optional(),
  heartbeat: z.string().max(MD_MAX).nullable().optional(),
  bootstrap: z.string().max(MD_MAX).nullable().optional(),
});

export const agentIdParam = z.object({
  id: z.string().min(1),
});
