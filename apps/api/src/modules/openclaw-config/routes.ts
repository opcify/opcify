import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  readOpenClawConfig,
  patchTelegramConfig,
  patchBindings,
  deleteTelegramAccount,
  runOpenClawCommand,
  getPairingList,
  approvePairing,
} from "./service.js";
import type { TelegramAccountConfig, TelegramChannelConfig, BindingEntry } from "./service.js";
import { createLogger } from "../../logger.js";
import { prisma } from "../../db.js";
import { agentSlug } from "../agents/workspace-sync.js";
import { workspaceService } from "../../workspace/WorkspaceService.js";
import { requireWorkspaceAuth } from "../../middleware/workspace.js";

const log = createLogger("openclaw-config-routes");

// ─── Schemas ────────────────────────────────────────────────────────

const workspaceParams = z.object({
  workspaceId: z.string().min(1),
});

const workspaceAccountParams = z.object({
  workspaceId: z.string().min(1),
  accountId: z.string().min(1),
});

const telegramAccountSchema = z.object({
  accountId: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, "Account ID must be alphanumeric with hyphens/underscores"),
  botToken: z.string().min(1),
  enabled: z.boolean().default(true),
  requireMention: z.boolean().default(true),
  dmPolicy: z.string().default("pairing"),
  groupPolicy: z.string().default("allowlist"),
  streaming: z.string().default("partial"),
});

const saveTelegramConfigSchema = z.object({
  accounts: z.array(telegramAccountSchema).min(1, "At least one account is required"),
  enabled: z.boolean().default(true),
  dmPolicy: z.string().default("pairing"),
  groupPolicy: z.string().default("allowlist"),
  streaming: z.string().default("partial"),
});

const bindingsSchema = z.object({
  bindings: z.array(z.object({
    agentId: z.string().min(1),
    accountId: z.string().min(1),
  })).min(1),
});

// ─── Routes ─────────────────────────────────────────────────────────

export async function openclawConfigRoutes(app: FastifyInstance) {
  const preHandler = requireWorkspaceAuth;

  // GET /openclaw/config — read current config
  app.get(
    "/workspaces/:workspaceId/openclaw/config",
    { preHandler },
    async (req, reply) => {
      try {
        const { workspaceId } = workspaceParams.parse(req.params);
        const config = await readOpenClawConfig(workspaceId);
        return reply.send(config);
      } catch (err) {
        log.error(`Failed to read config: ${(err as Error).message}`);
        return reply.status(500).send({ error: "Failed to read OpenClaw config" });
      }
    },
  );

  // GET /openclaw/config/telegram — get Telegram channel config
  app.get(
    "/workspaces/:workspaceId/openclaw/config/telegram",
    { preHandler },
    async (req, reply) => {
      try {
        const { workspaceId } = workspaceParams.parse(req.params);
        const config = await readOpenClawConfig(workspaceId);
        const telegram = config.channels?.telegram || null;
        return reply.send({ telegram, bindings: (config.bindings || []).filter(b => b.match.channel === "telegram") });
      } catch (err) {
        log.error(`Failed to read telegram config: ${(err as Error).message}`);
        return reply.status(500).send({ error: "Failed to read Telegram config" });
      }
    },
  );

  // POST /openclaw/config/telegram — save Telegram channel config
  app.post(
    "/workspaces/:workspaceId/openclaw/config/telegram",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const parsed = saveTelegramConfigSchema.parse(req.body);

      const accounts: Record<string, TelegramAccountConfig> = {};
      for (const acc of parsed.accounts) {
        accounts[acc.accountId] = {
          enabled: acc.enabled,
          dmPolicy: acc.dmPolicy,
          botToken: acc.botToken,
          groups: { "*": { requireMention: acc.requireMention } },
          groupPolicy: acc.groupPolicy,
          streaming: acc.streaming,
        };
      }

      const telegramConfig: TelegramChannelConfig = {
        enabled: parsed.enabled,
        dmPolicy: parsed.dmPolicy,
        groupPolicy: parsed.groupPolicy,
        streaming: parsed.streaming,
        accounts,
      };

      try {
        const merged = await patchTelegramConfig(telegramConfig, workspaceId);
        return reply.status(200).send({ ok: true, config: merged });
      } catch (err) {
        log.error(`Failed to save telegram config: ${(err as Error).message}`);
        return reply.status(500).send({ error: "Failed to save Telegram config" });
      }
    },
  );

  // POST /openclaw/gateway/start — start the gateway
  app.post(
    "/workspaces/:workspaceId/openclaw/gateway/start",
    { preHandler },
    async (req, reply) => {
      try {
        const { workspaceId } = workspaceParams.parse(req.params);
        const result = await runOpenClawCommand("gateway", [], workspaceId);
        // The `openclaw gateway` command may restart the gateway process,
        // which can kill the TCP proxy. Ensure it's alive afterward.
        await workspaceService.ensureContainers(workspaceId);
        return reply.send(result);
      } catch (err) {
        log.error(`Failed to start gateway: ${(err as Error).message}`);
        return reply.status(500).send({ error: "Failed to start gateway" });
      }
    },
  );

  // GET /openclaw/pairing/telegram — list pairing requests
  app.get(
    "/workspaces/:workspaceId/openclaw/pairing/telegram",
    { preHandler },
    async (req, reply) => {
      try {
        const { workspaceId } = workspaceParams.parse(req.params);
        const result = await getPairingList("telegram", workspaceId);
        return reply.send(result);
      } catch (err) {
        log.error(`Failed to get pairing list: ${(err as Error).message}`);
        return reply.status(500).send({ error: "Failed to get pairing list" });
      }
    },
  );

  // POST /openclaw/pairing/telegram/approve — approve a pairing code
  app.post(
    "/workspaces/:workspaceId/openclaw/pairing/telegram/approve",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const body = z
        .object({
          code: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, "Invalid pairing code format"),
        })
        .parse(req.body);
      try {
        const result = await approvePairing("telegram", body.code, workspaceId);
        return reply.send(result);
      } catch (err) {
        log.error(`Failed to approve pairing: ${(err as Error).message}`);
        return reply.status(500).send({ error: "Failed to approve pairing" });
      }
    },
  );

  // POST /openclaw/bindings/telegram — save agent bindings for Telegram
  app.post(
    "/workspaces/:workspaceId/openclaw/bindings/telegram",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const { bindings } = bindingsSchema.parse(req.body);

      // Resolve Prisma agent IDs to openclaw slugs — scoped by workspace so
      // callers can only bind agents they own.
      const agentIds = bindings.map(b => b.agentId);
      const agents = await prisma.agent.findMany({
        where: { id: { in: agentIds }, workspaceId },
        select: { id: true, name: true },
      });
      if (agents.length !== agentIds.length) {
        return reply.status(404).send({ error: "One or more agents not found" });
      }
      const slugById = new Map(agents.map(a => [a.id, agentSlug(a.name)]));

      const bindingEntries: BindingEntry[] = bindings.map(b => ({
        agentId: slugById.get(b.agentId) ?? b.agentId,
        match: {
          channel: "telegram",
          accountId: b.accountId,
        },
      }));

      try {
        const merged = await patchBindings(bindingEntries, workspaceId);
        return reply.status(200).send({ ok: true, config: merged });
      } catch (err) {
        log.error(`Failed to save bindings: ${(err as Error).message}`);
        return reply.status(500).send({ error: "Failed to save bindings" });
      }
    },
  );

  // DELETE /openclaw/config/telegram/:accountId — delete a single Telegram account
  app.delete(
    "/workspaces/:workspaceId/openclaw/config/telegram/:accountId",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, accountId } = workspaceAccountParams.parse(req.params);
      try {
        await deleteTelegramAccount(accountId, workspaceId);
        await runOpenClawCommand("gateway", [], workspaceId);
        await workspaceService.ensureContainers(workspaceId);
        return reply.send({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to delete account";
        log.error(`Failed to delete telegram account "${accountId}": ${msg}`);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // GET /openclaw/status — quick status check
  app.get(
    "/workspaces/:workspaceId/openclaw/status",
    { preHandler },
    async (req, reply) => {
      try {
        const { workspaceId } = workspaceParams.parse(req.params);
        const config = await readOpenClawConfig(workspaceId);
        const telegram = config.channels?.telegram;
        const telegramBindings = (config.bindings || []).filter(b => b.match.channel === "telegram");

        return reply.send({
          configured: !!telegram,
          telegramEnabled: telegram?.enabled ?? false,
          accountCount: telegram ? Object.keys(telegram.accounts || {}).length : 0,
          bindingCount: telegramBindings.length,
        });
      } catch {
        return reply.send({
          configured: false,
          telegramEnabled: false,
          accountCount: 0,
          bindingCount: 0,
        });
      }
    },
  );
}
