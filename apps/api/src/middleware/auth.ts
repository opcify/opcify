import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyJwt } from "../modules/auth/service.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string | null;
  }
}

/**
 * Auth preHandler — requires a valid Bearer token.
 * Sets `request.userId` on success, returns 401 on failure.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const payload = verifyJwt(auth.slice(7));
  if (!payload) {
    return reply.status(401).send({ error: "Invalid or expired token" });
  }

  req.userId = payload.sub;
}

/**
 * Optional auth preHandler — sets `request.userId` if a valid token
 * is present, but does not block unauthenticated requests.
 */
export async function optionalAuth(req: FastifyRequest) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    req.userId = null;
    return;
  }

  const payload = verifyJwt(auth.slice(7));
  req.userId = payload?.sub ?? null;
}
