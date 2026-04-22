import { z } from "zod";

export const taskGroupIdParam = z.object({
  id: z.string().min(1),
});

export const taskIdParam = z.object({
  taskId: z.string().min(1),
});

export const createTaskGroupFromDecompositionBody = z.object({
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      agentId: z.string().min(1),
    }),
  ).min(1),
});
