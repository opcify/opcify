import { z } from "zod";

export const taskTemplateIdParam = z.object({
  id: z.string().min(1),
});

export const taskIdParam = z.object({
  taskId: z.string().min(1),
});

export const taskTemplateFiltersQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
});

export const createTaskFromTemplateBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  agentId: z.string().min(1).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  plannedDate: z.string().optional(),
  attachments: z.array(z.object({
    type: z.enum(["image", "file"]),
    mediaType: z.string(),
    fileName: z.string().optional(),
    data: z.string(),
  })).max(5).optional(),
});

export const saveTaskTemplateBody = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(["research", "reporting", "content", "operations", "sales"]),
  description: z.string().min(1).max(500),
  suggestedAgentRoles: z.array(z.string()).default([]),
  defaultTitle: z.string().min(1).max(200),
  defaultDescription: z.string().max(2000).default(""),
  defaultTags: z.array(z.string()).default([]),
  defaultAgentId: z.string().optional(),
  defaultPriority: z.enum(["high", "medium", "low"]).optional(),
});

export const saveTemplateFromTaskBody = z.object({
  name: z.string().min(1).max(100).optional(),
});
