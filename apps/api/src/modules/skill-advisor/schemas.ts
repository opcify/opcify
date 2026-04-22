import { z } from "zod";

export const agentIdParam = z.object({
  id: z.string().min(1),
});

export const createDraftSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  agentRole: z.string().min(1).max(50),
  inputs: z.array(z.string().min(1)).max(20).optional(),
  outputs: z.array(z.string().min(1)).max(20).optional(),
});
