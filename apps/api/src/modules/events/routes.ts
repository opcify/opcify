import type { FastifyInstance } from "fastify";
import type { TaskSSEEvent } from "@opcify/core";
import { eventBroadcaster } from "./broadcaster.js";
import { createLogger } from "../../logger.js";

const log = createLogger("sse-routes");

const HEARTBEAT_INTERVAL_MS = 30_000;

export async function eventRoutes(app: FastifyInstance) {
  app.get("/events/tasks", async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) {
      return reply
        .status(400)
        .send({ error: "workspaceId query parameter required" });
    }

    // Set SSE headers (must include CORS manually since writeHead bypasses Fastify middleware)
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Credentials": "true",
    });

    // Send initial connection event
    reply.raw.write(
      `data: ${JSON.stringify({ type: "connected", workspaceId })}\n\n`,
    );

    // Heartbeat to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, HEARTBEAT_INTERVAL_MS);

    // Event listener — push events to this SSE connection
    const listener = (event: TaskSSEEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBroadcaster.subscribe(workspaceId, listener);

    log.info("SSE connection opened", { workspaceId });

    // Cleanup on client disconnect
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      eventBroadcaster.unsubscribe(workspaceId, listener);
      log.info("SSE connection closed", { workspaceId });
    });
  });
}
