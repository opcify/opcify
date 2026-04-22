import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createLogger } from "../../logger.js";
import {
  exchangeGoogleLoginCode,
  findOrCreateUser,
  getUserById,
  signJwt,
  verifyJwt,
  registerWithEmail,
  loginWithEmail,
  updateUserProfile,
} from "./service.js";
import {
  exchangeGmailCode,
  getGmailAddress,
  storeGmailTokens,
  removeGmailTokens,
  getGmailStatus,
  configureAndVerifyGmail,
} from "./gmail-service.js";

const log = createLogger("auth-routes");

export async function authRoutes(app: FastifyInstance) {
  // ─── POST /auth/google — exchange OAuth code, mint our JWT ───────
  app.post<{
    Body: { code: string; redirectUri: string; timezone?: string };
  }>("/auth/google", async (req, reply) => {
    const { code, redirectUri, timezone } = req.body as {
      code?: string;
      redirectUri?: string;
      timezone?: string;
    };

    if (!code) {
      return reply.status(400).send({ error: "Missing authorization code" });
    }
    if (!redirectUri) {
      return reply.status(400).send({ error: "Missing redirect URI" });
    }

    try {
      const googleUser = await exchangeGoogleLoginCode(code, redirectUri);
      const user = await findOrCreateUser(googleUser, timezone);
      const token = signJwt({
        sub: user.id,
        email: user.email,
        name: user.name,
      });

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          timezone: user.timezone,
        },
      };
    } catch (err) {
      log.error(`Google auth error: ${(err as Error).message}`);
      return reply.status(401).send({
        error: (err as Error).message || "Google authentication failed",
      });
    }
  });

  // ─── POST /auth/register — email/password signup ─────────────────
  app.post<{ Body: { name: string; email: string; password: string; timezone?: string } }>(
    "/auth/register",
    async (req, reply) => {
      const { name, email, password, timezone } = req.body as {
        name?: string;
        email?: string;
        password?: string;
        timezone?: string;
      };

      if (!name || !email || !password) {
        return reply.status(400).send({ error: "Name, email, and password are required" });
      }
      if (password.length < 6) {
        return reply.status(400).send({ error: "Password must be at least 6 characters" });
      }

      try {
        const user = await registerWithEmail(name, email, password, timezone);
        const token = signJwt({ sub: user.id, email: user.email, name: user.name });
        return {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            timezone: user.timezone,
          },
        };
      } catch (err) {
        const msg = (err as Error).message;
        const status = msg.includes("already exists") ? 409 : 500;
        return reply.status(status).send({ error: msg });
      }
    },
  );

  // ─── POST /auth/login — email/password login ───────────────────
  app.post<{ Body: { email: string; password: string; timezone?: string } }>(
    "/auth/login",
    async (req, reply) => {
      const { email, password, timezone } = req.body as {
        email?: string;
        password?: string;
        timezone?: string;
      };

      if (!email || !password) {
        return reply.status(400).send({ error: "Email and password are required" });
      }

      try {
        const user = await loginWithEmail(email, password, timezone);
        const token = signJwt({ sub: user.id, email: user.email, name: user.name });
        return {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            timezone: user.timezone,
          },
        };
      } catch (err) {
        return reply.status(401).send({ error: (err as Error).message });
      }
    },
  );

  // ─── GET /auth/me — return current user from Bearer token ───────
  app.get("/auth/me", async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const payload = verifyJwt(auth.slice(7));
    if (!payload) {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    const user = await getUserById(payload.sub);
    if (!user) {
      return reply.status(401).send({ error: "User not found" });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
    };
  });

  // ─── PATCH /auth/me — update current user profile ─────────────
  app.patch("/auth/me", async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const payload = verifyJwt(auth.slice(7));
    if (!payload) {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    const { name, timezone } = req.body as { name?: string; timezone?: string };

    // Validate timezone if provided
    if (timezone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch {
        return reply.status(400).send({ error: "Invalid timezone" });
      }
    }

    const user = await updateUserProfile(payload.sub, {
      ...(name ? { name } : {}),
      ...(timezone ? { timezone } : {}),
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
    };
  });

  // ─── POST /auth/logout — client-side only, just acknowledge ─────
  app.post("/auth/logout", async () => {
    return { ok: true };
  });

  // ─── Gmail OAuth endpoints ──────────────────────────────────────

  // POST /auth/gmail/connect — exchange Gmail code, store tokens
  app.post("/auth/gmail/connect", async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    const payload = verifyJwt(auth.slice(7));
    if (!payload) {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    const { code, workspaceId } = z
      .object({ code: z.string().min(1), workspaceId: z.string().min(1) })
      .parse(req.body);

    try {
      const tokens = await exchangeGmailCode(code);
      const email = await getGmailAddress(tokens.access_token);
      await storeGmailTokens(workspaceId, {
        email,
        refreshToken: tokens.refresh_token!,
      });

      // Configure himalaya inside the Docker container and verify
      const verification = await configureAndVerifyGmail(workspaceId);
      log.info("Gmail verification result", {
        workspaceId,
        success: verification.success,
      });

      return {
        connected: true,
        email,
        verified: verification.success,
        verificationOutput: verification.output,
      };
    } catch (err) {
      log.error(`Gmail connect failed: ${(err as Error).message}`);
      return reply
        .status(400)
        .send({ error: (err as Error).message });
    }
  });

  // GET /auth/gmail/status — check if Gmail is connected
  app.get("/auth/gmail/status", async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    const payload = verifyJwt(auth.slice(7));
    if (!payload) {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    const { workspaceId } = z
      .object({ workspaceId: z.string().min(1) })
      .parse(req.query);

    return getGmailStatus(workspaceId);
  });

  // POST /auth/gmail/disconnect — remove Gmail tokens
  app.post("/auth/gmail/disconnect", async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    const payload = verifyJwt(auth.slice(7));
    if (!payload) {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    const { workspaceId } = z
      .object({ workspaceId: z.string().min(1) })
      .parse(req.body);

    await removeGmailTokens(workspaceId);
    return { connected: false };
  });
}
