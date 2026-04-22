import type { FastifyInstance } from "fastify";
import type { OpenClawAdapter } from "@opcify/core";
import { z } from "zod";
import { validateWorkspaceBearer } from "../../middleware/workspace.js";

const summaryQuery = z.object({
  workspaceId: z.string().min(1),
});

export async function dashboardRoutes(
  app: FastifyInstance,
  adapter: OpenClawAdapter,
) {
  // Kept at /dashboard/summary (not under /workspaces/:id) because the
  // web /dashboard page is the workspace-picker — this endpoint is the
  // one resource summary that's addressed by query param, not path.
  app.get("/dashboard/summary", async (req, reply) => {
    const { workspaceId } = summaryQuery.parse(req.query);
    const result = await validateWorkspaceBearer(req, workspaceId);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return adapter.getDashboardSummary(workspaceId);
  });
}
