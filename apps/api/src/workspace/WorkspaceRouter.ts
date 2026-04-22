import type { FastifyInstance } from "fastify";
import { workspaceService } from "./WorkspaceService.js";
import { createLogger } from "../logger.js";

const log = createLogger("workspace-router");

export async function dockerWorkspaceRoutes(
  app: FastifyInstance,
): Promise<void> {
  // POST /docker-workspaces — create a new workspace
  app.post("/docker-workspaces", async (req, reply) => {
    const body = req.body as { id?: string; config?: unknown };

    if (!body?.id || typeof body.id !== "string") {
      return reply.status(400).send({
        error: { code: "BAD_REQUEST", message: "Missing required field: id" },
      });
    }

    try {
      const workspace = await workspaceService.create(
        body.id,
        (body.config as Record<string, unknown>) ?? {},
      );
      return reply.status(201).send(workspace);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /docker-workspaces/:id/ensure — ensure containers are running
  app.post("/docker-workspaces/:id/ensure", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await workspaceService.ensureContainers(id);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /docker-workspaces/:id/start — start a workspace
  app.post("/docker-workspaces/:id/start", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await workspaceService.start(id);
      return reply.status(200).send({ status: "started" });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /docker-workspaces/:id/stop — stop a workspace
  app.post("/docker-workspaces/:id/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await workspaceService.stop(id);
      return reply.status(200).send({ status: "stopped" });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // DELETE /docker-workspaces/:id — delete a workspace
  app.delete("/docker-workspaces/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { keepData?: string };
    const keepData = query.keepData === "true";

    try {
      await workspaceService.delete(id, keepData);
      return reply.status(200).send({ status: "deleted" });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // GET /docker-workspaces/:id/health — workspace health check
  app.get("/docker-workspaces/:id/health", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const health = await workspaceService.health(id);
      const isHealthy =
        health.gateway === "healthy" &&
        (health.browser === "healthy" || health.browser === "unreachable");
      return reply.status(isHealthy ? 200 : 503).send(health);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  log.info("Docker workspace routes registered");
}

// ─── Error handler ──────────────────────────────────────────────────

function handleError(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  err: unknown,
) {
  const error = err as Error & { statusCode?: number };
  const statusCode = error.statusCode ?? 500;
  return reply.status(statusCode).send({
    error: {
      code: statusCode === 409 ? "CONFLICT" : "INTERNAL_ERROR",
      message: error.message ?? "Unknown error",
    },
  });
}
