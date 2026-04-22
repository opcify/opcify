import type { FastifyInstance, FastifyReply } from "fastify";
import type { OpenClawAdapter } from "@opcify/core";
import { z } from "zod";
import {
  requireWorkspaceAuth,
  assertAgentInWorkspace,
  WorkspaceScopeError,
} from "../../middleware/workspace.js";
import { createAgentSchema, updateAgentSchema } from "./schemas.js";

const workspaceParams = z.object({
  workspaceId: z.string().min(1),
});

const workspaceIdParams = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

async function guardAgentInWorkspace(
  id: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    await assertAgentInWorkspace(id, workspaceId);
    return true;
  } catch (err) {
    if (err instanceof WorkspaceScopeError) {
      reply.status(404).send({ error: "Agent not found" });
      return false;
    }
    throw err;
  }
}

export async function agentRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
) {
  const preHandler = requireWorkspaceAuth;

  app.get("/workspaces/:workspaceId/agents", { preHandler }, async (req) => {
    const { workspaceId } = workspaceParams.parse(req.params);
    return adapter.listAgents(workspaceId);
  });

  app.get(
    "/workspaces/:workspaceId/agents/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      if (!(await guardAgentInWorkspace(id, workspaceId, reply))) return;
      const agent = await adapter.getAgent(id);
      if (!agent) return reply.status(404).send({ error: "Agent not found" });
      return agent;
    },
  );

  app.post(
    "/workspaces/:workspaceId/agents",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const data = createAgentSchema.parse(req.body);
      try {
        const agent = await adapter.createAgent({ ...data, workspaceId });
        return reply.status(201).send(agent);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to create agent";
        if (msg.includes("already exists")) {
          return reply.status(409).send({ error: msg });
        }
        return reply.status(500).send({ error: msg });
      }
    },
  );

  app.patch(
    "/workspaces/:workspaceId/agents/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      const data = updateAgentSchema.parse(req.body);
      if (!(await guardAgentInWorkspace(id, workspaceId, reply))) return;
      try {
        return await adapter.updateAgent(id, data);
      } catch {
        return reply.status(404).send({ error: "Agent not found" });
      }
    },
  );

  app.delete(
    "/workspaces/:workspaceId/agents/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      if (!(await guardAgentInWorkspace(id, workspaceId, reply))) return;
      try {
        await adapter.deleteAgent(id);
        return reply.status(204).send();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Agent not found";
        if (msg === "Cannot delete a system agent") {
          return reply.status(403).send({ error: msg });
        }
        return reply.status(404).send({ error: msg });
      }
    },
  );

  app.post(
    "/workspaces/:workspaceId/agents/:id/restore",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      if (!(await guardAgentInWorkspace(id, workspaceId, reply))) return;
      try {
        const agent = await adapter.restoreAgent(id);
        return reply.status(200).send(agent);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Agent not found";
        if (msg === "Agent is not deleted") {
          return reply.status(400).send({ error: msg });
        }
        return reply.status(404).send({ error: msg });
      }
    },
  );

  app.post(
    "/workspaces/:workspaceId/agents/:id/enable",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      if (!(await guardAgentInWorkspace(id, workspaceId, reply))) return;
      try {
        return await adapter.enableAgent(id);
      } catch {
        return reply.status(404).send({ error: "Agent not found" });
      }
    },
  );

  app.post(
    "/workspaces/:workspaceId/agents/:id/disable",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      if (!(await guardAgentInWorkspace(id, workspaceId, reply))) return;
      try {
        return await adapter.disableAgent(id);
      } catch {
        return reply.status(404).send({ error: "Agent not found" });
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/agents/:id/token-usage",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      if (!(await guardAgentInWorkspace(id, workspaceId, reply))) return;
      return adapter.getAgentTokenUsage(id);
    },
  );
}
