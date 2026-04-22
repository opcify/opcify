import { z } from "zod";

export const taskIdParam = z.object({
  id: z.string().min(1),
});

export const taskFiltersQuery = z.object({
  status: z.enum(["queued", "running", "waiting", "done", "failed", "stopped"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  agentId: z.string().optional(),
  workspaceId: z.string().optional(),
  archived: z.enum(["true"]).optional(),
  q: z.string().optional(),
  sort: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const createTaskBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  taskType: z.enum(["normal", "decomposition"]).optional(),
  agentId: z.string().min(1),
  priority: z.enum(["high", "medium", "low"]).optional(),
  plannedDate: z.string().optional(),
  sourceTaskId: z.string().optional(),
  clientId: z.string().optional(),
  attachments: z.array(z.object({
    type: z.enum(["image", "file"]),
    mediaType: z.string(),
    fileName: z.string().optional(),
    data: z.string(),
  })).max(5).optional(),
});

export const updateTaskBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  agentId: z.string().min(1).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["queued", "running", "waiting", "done", "failed", "stopped"]).optional(),
  plannedDate: z.string().nullable().optional(),
  waitingReason: z.enum([
    "waiting_for_review",
    "waiting_for_input",
    "waiting_for_dependency",
    "waiting_for_retry",
    "waiting_for_external",
  ]).nullable().optional(),
  blockingQuestion: z.string().max(2000).nullable().optional(),
  blockedByTaskId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  recurringRuleId: z.string().nullable().optional(),
});

export const updateTaskStatusBody = z.object({
  status: z.enum(["queued", "running", "waiting", "done", "failed", "stopped"]),
});

export const syncExecutionStepsBody = z
  .object({
    executionMode: z.enum(["single", "manual_workflow", "orchestrated"]).optional(),
    finalTaskStatus: z.enum(["queued", "running", "waiting", "done", "failed", "stopped"]).optional(),
    steps: z.array(
      z
        .object({
          stepOrder: z.number().int().min(1),
          agentId: z.string().optional(),
          agentName: z.string().optional(),
          roleLabel: z.string().optional(),
          title: z.string().optional(),
          instruction: z.string().optional(),
          status: z.enum(["pending", "running", "completed", "failed"]),
          outputSummary: z.string().optional(),
          outputContent: z.string().optional(),
          startedAt: z.string().optional(),
          finishedAt: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.executionMode !== "orchestrated") return;
    data.steps.forEach((step, i) => {
      if (!step.agentName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "agentName"],
          message:
            "agentName is required when executionMode is 'orchestrated' — the kanban shows this while the step runs",
        });
      }
      if (!step.title) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "title"],
          message:
            "title is required when executionMode is 'orchestrated' — the kanban shows this on the step timeline",
        });
      }
    });
  });

export const openClawExecuteCommandSchema = z.object({
  taskId: z.string().min(1),
  executionMode: z.enum(["single", "manual_workflow", "orchestrated"]),
  goal: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]),
  sourceTaskId: z.string().optional(),
  workflowPlan: z.array(z.object({
    stepOrder: z.number().int().min(1),
    agentId: z.string().optional(),
    agentName: z.string().optional(),
    roleLabel: z.string().optional(),
    instruction: z.string().min(1),
  })).optional(),
  context: z.object({
    taskGroupId: z.string().optional(),
    orchestratorAgentId: z.string().optional(),
  }).optional(),
  callbackUrl: z.string().url().optional(),
  callbackToken: z.string().optional(),
  agent: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    role: z.string(),
    model: z.string(),
    skills: z.array(z.string()).optional(),
  }).optional(),
});
