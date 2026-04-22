import type { FastifyInstance } from "fastify";
import type { OpenClawAdapter } from "@opcify/core";
import {
  templateIdParam,
  createAgentFromTemplateBody,
  templateFiltersQuery,
} from "./schemas.js";

export async function agentTemplateRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
) {
  app.get("/agent-templates", async (req) => {
    const { q, category } = templateFiltersQuery.parse(req.query);
    let templates = await adapter.listAgentTemplates();
    if (q) {
      const lower = q.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.name.toLowerCase().includes(lower) ||
          t.role.toLowerCase().includes(lower) ||
          t.description.toLowerCase().includes(lower),
      );
    }
    if (category) {
      templates = templates.filter((t) => t.category === category);
    }
    return templates;
  });

  app.get("/agent-templates/:id", async (req, reply) => {
    const { id } = templateIdParam.parse(req.params);
    const template = await adapter.getAgentTemplate(id);
    if (!template)
      return reply.status(404).send({ error: "Template not found" });
    return template;
  });

  app.post("/agent-templates/:id/create-agent", async (req, reply) => {
    const { id } = templateIdParam.parse(req.params);
    const data = createAgentFromTemplateBody.parse(req.body);
    try {
      const agent = await adapter.createAgentFromTemplate({
        templateId: id,
        ...data,
      });
      return reply.status(201).send(agent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create agent";
      if (msg.includes("already exists")) {
        return reply.status(409).send({ error: msg });
      }
      return reply.status(400).send({ error: msg });
    }
  });
}
