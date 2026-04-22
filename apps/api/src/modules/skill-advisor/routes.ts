import type { FastifyInstance, FastifyReply } from "fastify";
import type { OpenClawAdapter } from "@opcify/core";
import { z } from "zod";
import {
  requireWorkspaceAuth,
  assertAgentInWorkspace,
  WorkspaceScopeError,
} from "../../middleware/workspace.js";
import { analyzeSkills } from "./analyzer.js";
import { scaffoldSkill } from "./scaffold.js";
import { createDraftSchema } from "./schemas.js";

const workspaceAgentParams = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
});

const workspaceOnlyParams = z.object({
  workspaceId: z.string().min(1),
});

async function guardAgentInWorkspace(
  agentId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    await assertAgentInWorkspace(agentId, workspaceId);
    return true;
  } catch (err) {
    if (err instanceof WorkspaceScopeError) {
      reply.status(404).send({ error: "Agent not found" });
      return false;
    }
    throw err;
  }
}

export async function skillAdvisorRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
) {
  const preHandler = requireWorkspaceAuth;

  app.get(
    "/workspaces/:workspaceId/agents/:agentId/skills/advice",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId } = workspaceAgentParams.parse(req.params);
      if (!(await guardAgentInWorkspace(agentId, workspaceId, reply))) return;

      const agent = await adapter.getAgent(agentId);
      if (!agent) return reply.status(404).send({ error: "Agent not found" });

      const catalogSkills = await adapter.listSkills();
      return analyzeSkills(agent.role, agent.skills, catalogSkills);
    },
  );

  app.post(
    "/workspaces/:workspaceId/skills/create-draft",
    { preHandler },
    async (req) => {
      workspaceOnlyParams.parse(req.params);
      const input = createDraftSchema.parse(req.body);
      return scaffoldSkill(input);
    },
  );
}
