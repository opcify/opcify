import type { FastifyInstance } from "fastify";
import type { ChatStreamEvent } from "@opcify/core";
import { z } from "zod";
import { chatService } from "./service.js";
import { chatSendBody, chatSessionBody } from "./types.js";
import { prisma } from "../../db.js";
import { agentSlug } from "../agents/workspace-sync.js";
import { requireWorkspaceAuth } from "../../middleware/workspace.js";
import { createLogger } from "../../logger.js";

const log = createLogger("chat-routes");

const HEARTBEAT_INTERVAL_MS = 30_000;

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
});

const sessionQuery = z.object({
  sessionKey: z.string().min(1).max(100).optional(),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  const preHandler = requireWorkspaceAuth;

  // ── Send message ────────────────────────────────────────────────
  app.post(
    "/workspaces/:workspaceId/chat/:agentId/send",
    { preHandler, bodyLimit: 20 * 1024 * 1024 },
    async (req, reply) => {
      const { workspaceId, agentId } = paramsSchema.parse(req.params);
      const body = chatSendBody.parse(req.body);

      const agent = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId, deletedAt: null },
      });
      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      const slug = agentSlug(agent.name);
      try {
        const result = await chatService.send(workspaceId, slug, {
          message: body.message,
          sessionKey: body.sessionKey,
          attachments: body.attachments,
        });
        return reply.send({ ok: true, sessionKey: result.sessionKey });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to send message";
        log.error("chat.send failed", { agentId, error: msg });
        return reply.status(502).send({ error: msg });
      }
    },
  );

  // ── SSE stream ──────────────────────────────────────────────────
  // The middleware accepts `?_token=<bearer>` on this route because
  // EventSource cannot set an Authorization header.
  app.get(
    "/workspaces/:workspaceId/chat/:agentId/stream",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId } = paramsSchema.parse(req.params);
      const query = sessionQuery.parse(req.query);

      const agent = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId, deletedAt: null },
      });
      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      // Default to "main" so the subscribe key matches what resolveSessionKey
      // emits for gateway events with scope "main". Both sides speak "main" as
      // the canonical default — do NOT subscribe by slug here.
      const sessionKey = query.sessionKey || "main";

      const origin = req.headers.origin || "*";
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      });

      reply.raw.write(
        `data: ${JSON.stringify({ type: "connected", sessionKey })}\n\n`,
      );

      const heartbeat = setInterval(() => {
        reply.raw.write(": heartbeat\n\n");
      }, HEARTBEAT_INTERVAL_MS);

      const listener = (event: ChatStreamEvent) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const slug = agentSlug(agent.name);
      chatService.subscribe(workspaceId, slug, sessionKey, listener);

      log.info("Chat SSE connection opened", {
        workspaceId,
        agentId,
        sessionKey,
      });

      chatService.getClient(workspaceId).catch((err) => {
        const msg = err instanceof Error ? err.message : "Gateway connection failed";
        log.warn("Failed to connect gateway for SSE", {
          workspaceId,
          error: msg,
        });
        reply.raw.write(
          `data: ${JSON.stringify({ type: "chat:error", error: msg, sessionKey })}\n\n`,
        );
      });

      req.raw.on("close", () => {
        clearInterval(heartbeat);
        chatService.unsubscribe(workspaceId, slug, sessionKey, listener);
        log.info("Chat SSE connection closed", {
          workspaceId,
          agentId,
          sessionKey,
        });
      });
    },
  );

  // ── Get history ─────────────────────────────────────────────────
  app.get(
    "/workspaces/:workspaceId/chat/:agentId/history",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId } = paramsSchema.parse(req.params);
      const query = sessionQuery.parse(req.query);

      const agent = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId, deletedAt: null },
      });
      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      const slug = agentSlug(agent.name);
      try {
        const result = await chatService.history(
          workspaceId,
          slug,
          query.sessionKey,
        );
        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load history";
        log.error("chat.history failed", { agentId, error: msg });
        return reply.status(502).send({ error: msg });
      }
    },
  );

  // ── Abort generation ────────────────────────────────────────────
  app.post(
    "/workspaces/:workspaceId/chat/:agentId/abort",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId } = paramsSchema.parse(req.params);
      const body = chatSessionBody.parse(req.body ?? {});

      const agent = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId, deletedAt: null },
      });
      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      const slug = agentSlug(agent.name);
      try {
        await chatService.abort(workspaceId, slug, body.sessionKey);
        return reply.send({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to abort";
        return reply.status(502).send({ error: msg });
      }
    },
  );

  // ── List sessions ───────────────────────────────────────────────
  app.get(
    "/workspaces/:workspaceId/chat/:agentId/sessions",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId } = paramsSchema.parse(req.params);

      const agent = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId, deletedAt: null },
      });
      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      const slug = agentSlug(agent.name);
      try {
        const result = await chatService.listSessions(workspaceId, slug);
        return reply.send(result);
      } catch (err) {
        // Degrade gracefully: a listing failure shouldn't break the chat page.
        // Fall back to main-only so the dropdown can still render.
        log.warn("chat.listSessions failed", {
          agentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return reply.send({
          sessions: [
            { sessionKey: "main", totalTokens: 0, inputTokens: 0, outputTokens: 0 },
          ],
        });
      }
    },
  );

  // ── Reset session ───────────────────────────────────────────────
  app.post(
    "/workspaces/:workspaceId/chat/:agentId/reset",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, agentId } = paramsSchema.parse(req.params);
      const body = chatSessionBody.parse(req.body ?? {});

      const agent = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId, deletedAt: null },
      });
      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      const slug = agentSlug(agent.name);
      try {
        await chatService.reset(workspaceId, slug, body.sessionKey);
        return reply.send({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to reset session";
        return reply.status(502).send({ error: msg });
      }
    },
  );
}
