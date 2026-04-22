import type { FastifyInstance, FastifyReply } from "fastify";
import type { OpenClawAdapter } from "@opcify/core";
import { requireAuth } from "../../middleware/auth.js";
import {
  requireWorkspaceAuth,
  assertAgentInWorkspace,
  WorkspaceScopeError,
} from "../../middleware/workspace.js";
import {
  workspaceAgentParams,
  workspaceAgentSkillParams,
  installSkillSchema,
} from "./schemas.js";

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

export async function skillRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
) {
  // Global catalog — any authenticated user may browse. Skills are a shared,
  // workspace-agnostic catalog (no `workspaceId` on the Skill model).
  app.get(
    "/skills",
    { preHandler: requireAuth },
    async () => adapter.listSkills(),
  );

  const preHandler = requireWorkspaceAuth;

  app.get(
    "/workspaces/:workspaceId/agents/:agentId/skills",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId } = workspaceAgentParams.parse(req.params);
      if (!(await guardAgentInWorkspace(agentId, workspaceId, reply))) return;
      return adapter.getAgentSkills(agentId);
    },
  );

  app.get(
    "/workspaces/:workspaceId/agents/:agentId/skills/recommendations",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId } = workspaceAgentParams.parse(req.params);
      if (!(await guardAgentInWorkspace(agentId, workspaceId, reply))) return;
      return adapter.getSkillRecommendations(agentId);
    },
  );

  app.post(
    "/workspaces/:workspaceId/agents/:agentId/skills/install",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId } = workspaceAgentParams.parse(req.params);
      const { skillId } = installSkillSchema.parse(req.body);
      if (!(await guardAgentInWorkspace(agentId, workspaceId, reply))) return;
      try {
        const result = await adapter.installSkill(agentId, skillId);
        return reply.status(201).send(result);
      } catch {
        return reply.status(409).send({ error: "Skill already installed or not found" });
      }
    },
  );

  app.delete(
    "/workspaces/:workspaceId/agents/:agentId/skills/:skillId",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId, skillId } = workspaceAgentSkillParams.parse(req.params);
      if (!(await guardAgentInWorkspace(agentId, workspaceId, reply))) return;
      try {
        await adapter.uninstallSkill(agentId, skillId);
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: "Skill not found or not installed" });
      }
    },
  );
}
