import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listInstalledSkills,
  listCapabilities,
  invalidateCapabilitiesCache,
  installSkillBySlug,
  uninstallSkillBySlug,
  updateAllSkills,
  toggleSkill,
  updateSkillConfig,
  getSkillConfig,
  listManagedSkills,
  listManagedSkillsCatalog,
} from "./service.js";
import { createLogger } from "../../logger.js";

const log = createLogger("openclaw-capabilities-routes");

// ─── Schemas ────────────────────────────────────────────────────────

const workspaceIdParam = z.object({
  workspaceId: z.string().min(1),
});

const installSkillSchema = z.object({
  slug: z.string().min(1).max(200).regex(/^[@a-zA-Z0-9._/:+-]+$/, "Invalid skill slug"),
  agentIds: z.array(z.string().min(1)).optional(),
});

const skillNameParam = z.object({
  workspaceId: z.string().min(1),
  skillName: z.string().min(1).max(200),
});

const toggleSkillSchema = z.object({
  enabled: z.boolean(),
});

const skillConfigSchema = z.object({
  enabled: z.boolean().optional(),
  env: z.record(z.string()).optional(),
  apiKey: z.union([z.string(), z.object({ source: z.string(), provider: z.string(), id: z.string() })]).optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────

export async function openclawCapabilitiesRoutes(app: FastifyInstance) {

  // GET /workspaces/:workspaceId/openclaw/capabilities — skills listing (cached)
  app.get("/workspaces/:workspaceId/openclaw/capabilities", async (req, reply) => {
    const { workspaceId } = workspaceIdParam.parse(req.params);
    try {
      const result = await listCapabilities(workspaceId);
      return reply.send(result);
    } catch (err) {
      log.error(`Failed to list capabilities: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to list capabilities" });
    }
  });

  // GET /workspaces/:workspaceId/openclaw/managed-skills — per-workspace listing
  // (includes the `installed` flag from openclaw.json).
  app.get("/workspaces/:workspaceId/openclaw/managed-skills", async (req, reply) => {
    const { workspaceId } = workspaceIdParam.parse(req.params);
    try {
      const skills = await listManagedSkills(workspaceId);
      return reply.send({ skills });
    } catch (err) {
      log.error(`Failed to list managed skills: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to list managed skills" });
    }
  });

  // GET /managed-skills/catalog — workspace-agnostic catalog used by the
  // setup wizard. Loaded from each templates/skills/<slug>/_meta.json `managed`
  // block; no hardcoded list anywhere. Adding a new skill is purely a matter
  // of dropping a new folder + _meta.json and restarting the API.
  app.get("/managed-skills/catalog", async (_req, reply) => {
    try {
      const skills = await listManagedSkillsCatalog();
      return reply.send({ skills });
    } catch (err) {
      log.error(`Failed to list managed skills catalog: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to list managed skills catalog" });
    }
  });

  // GET /workspaces/:workspaceId/openclaw/skills — list installed skills
  app.get("/workspaces/:workspaceId/openclaw/skills", async (req, reply) => {
    const { workspaceId } = workspaceIdParam.parse(req.params);
    try {
      const { skills, raw } = await listInstalledSkills(workspaceId);
      return reply.send({ skills, command: raw.command, success: raw.success, stderr: raw.stderr });
    } catch (err) {
      log.error(`Failed to list skills: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to list installed skills" });
    }
  });

  // POST /workspaces/:workspaceId/openclaw/skills/install — install a skill by slug
  // Optional agentId in body to install for a specific agent only
  app.post("/workspaces/:workspaceId/openclaw/skills/install", async (req, reply) => {
    const { workspaceId } = workspaceIdParam.parse(req.params);
    const { slug, agentIds } = installSkillSchema.parse(req.body);
    try {
      const result = await installSkillBySlug(workspaceId, slug, agentIds);
      if (result.success) invalidateCapabilitiesCache(workspaceId);
      return reply.status(result.success ? 200 : 422).send(result);
    } catch (err) {
      log.error(`Failed to install skill: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to install skill" });
    }
  });

  // POST /workspaces/:workspaceId/openclaw/skills/uninstall — uninstall a skill by slug
  app.post("/workspaces/:workspaceId/openclaw/skills/uninstall", async (req, reply) => {
    const { workspaceId } = workspaceIdParam.parse(req.params);
    const { slug } = installSkillSchema.parse(req.body);
    try {
      const result = await uninstallSkillBySlug(workspaceId, slug);
      if (result.success) invalidateCapabilitiesCache(workspaceId);
      return reply.status(result.success ? 200 : 422).send(result);
    } catch (err) {
      log.error(`Failed to uninstall skill: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to uninstall skill" });
    }
  });

  // POST /workspaces/:workspaceId/openclaw/skills/update-all — update all skills
  app.post("/workspaces/:workspaceId/openclaw/skills/update-all", async (req, reply) => {
    const { workspaceId } = workspaceIdParam.parse(req.params);
    try {
      const result = await updateAllSkills(workspaceId);
      invalidateCapabilitiesCache(workspaceId);
      return reply.send(result);
    } catch (err) {
      log.error(`Failed to update skills: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to update skills" });
    }
  });

  // ─── Skill config (enable/disable, env, apiKey) ───

  // POST /workspaces/:workspaceId/openclaw/skills/:skillName/toggle
  app.post("/workspaces/:workspaceId/openclaw/skills/:skillName/toggle", async (req, reply) => {
    const { workspaceId, skillName } = skillNameParam.parse(req.params);
    const { enabled } = toggleSkillSchema.parse(req.body);
    try {
      await toggleSkill(workspaceId, skillName, enabled);
      invalidateCapabilitiesCache(workspaceId);
      return reply.send({ ok: true, skillName, enabled });
    } catch (err) {
      log.error(`Failed to toggle skill: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to toggle skill" });
    }
  });

  // GET /workspaces/:workspaceId/openclaw/skills/:skillName/config
  app.get("/workspaces/:workspaceId/openclaw/skills/:skillName/config", async (req, reply) => {
    const { workspaceId, skillName } = skillNameParam.parse(req.params);
    try {
      const config = await getSkillConfig(workspaceId, skillName);
      return reply.send(config);
    } catch (err) {
      log.error(`Failed to get skill config: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to get skill config" });
    }
  });

  // PATCH /workspaces/:workspaceId/openclaw/skills/:skillName/config
  app.patch("/workspaces/:workspaceId/openclaw/skills/:skillName/config", async (req, reply) => {
    const { workspaceId, skillName } = skillNameParam.parse(req.params);
    const data = skillConfigSchema.parse(req.body);
    try {
      await updateSkillConfig(workspaceId, skillName, data);
      return reply.send({ ok: true });
    } catch (err) {
      log.error(`Failed to update skill config: ${(err as Error).message}`);
      return reply.status(500).send({ error: "Failed to update skill config" });
    }
  });

  // ─── Legacy routes (no workspace context, kept for backward compat) ───
  // These try to find a single active workspace as a fallback.

  app.get("/openclaw/skills", async (_req, reply) => {
    return reply.status(400).send({ error: "Use /workspaces/:workspaceId/openclaw/skills" });
  });

  app.post("/openclaw/skills/install", async (_req, reply) => {
    return reply.status(400).send({ error: "Use /workspaces/:workspaceId/openclaw/skills/install" });
  });

  app.post("/openclaw/skills/update-all", async (_req, reply) => {
    return reply.status(400).send({ error: "Use /workspaces/:workspaceId/openclaw/skills/update-all" });
  });
}
