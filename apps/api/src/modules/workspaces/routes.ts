import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth } from "../../middleware/auth.js";
import { provisionWorkspace } from "./provisioner.js";
import { exportWorkspace } from "./export-import.js";
import { backupWorkspace, restoreWorkspace, backupSchema, type WorkspaceBackup } from "./backup-restore.js";
import { syncAuthProfilesToWorkspace } from "../agents/workspace-sync.js";
import { getRuntime } from "../../runtime/workspace-runtime.js";
import type { WorkspaceAISettings } from "@opcify/core";
import { workspaceService } from "../../workspace/WorkspaceService.js";
import {
  getDataDir,
  generateToken,
  loadWorkspaceFromDisk,
  syncCustomProvidersToOpenclawJson,
  patchOpcifyApiKeyInOpenclawJson,
  writeOpcifyApiKeyToDisk,
} from "../../workspace/WorkspaceConfig.js";
import { rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  let attempt = 0;
  while (true) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
    const existing = await prisma.workspace.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    attempt++;
  }
}

const createBody = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(48).optional(),
  description: z.string().max(500).optional(),
  type: z.string().max(100).optional(),
  templateId: z.string().optional(),
  settingsJson: z.string().max(50000).optional(),
});

const updateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(["draft", "provisioning", "ready", "failed", "archived"]).optional(),
  settingsJson: z.string().max(50000).nullable().optional(),
});

const provisionBody = z.object({
  templateId: z.string().optional(),
  defaultModel: z.string().max(50).optional(),
  agents: z
    .array(
      z.object({
        name: z.string(),
        role: z.string(),
        description: z.string(),
        model: z.string().optional(),
        skillKeys: z.array(z.string()).optional(),
        soul: z.string().optional(),
        agentConfig: z.string().optional(),
        identity: z.string().optional(),
        user: z.string().optional(),
        tools: z.string().optional(),
        heartbeat: z.string().optional(),
        bootstrap: z.string().optional(),
      }),
    )
    .optional(),
  skillKeys: z.array(z.string()).optional(),
  managedSkillKeys: z.array(z.string()).optional(),
  taskTemplateKeys: z.array(z.string()).optional(),
  enableDemoData: z.boolean().optional(),
  dockerConfig: z.object({
    model: z.string().optional(),
    modelFallbacks: z.array(z.string()).optional(),
    browser: z.object({
      enabled: z.boolean(),
      headless: z.boolean().optional(),
      enableNoVNC: z.boolean().optional(),
      memory: z.number().optional(),
      cpu: z.number().optional(),
    }).optional(),
    gateway: z.object({
      memory: z.number().optional(),
      cpu: z.number().optional(),
    }).optional(),
    tools: z.object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    }).optional(),
    env: z.record(z.string()).optional(),
    // Wizard memory step — see WorkspaceMemoryConfig in workspace/types.ts.
    // Discriminated on `mode`; Zod's union handles the common fields on
    // each branch so provider-only fields don't leak across modes.
    memory: z
      .discriminatedUnion("mode", [
        z.object({
          mode: z.literal("local"),
          sessionsEnabled: z.boolean(),
          dreamingEnabled: z.boolean(),
          vectorWeight: z.number().min(0).max(1),
          textWeight: z.number().min(0).max(1),
        }),
        z.object({
          mode: z.literal("remote"),
          sessionsEnabled: z.boolean(),
          dreamingEnabled: z.boolean(),
          vectorWeight: z.number().min(0).max(1),
          textWeight: z.number().min(0).max(1),
          provider: z.enum([
            "openai",
            "voyage",
            "bedrock",
            "gemini",
            "mistral",
            "ollama",
            "github-copilot",
          ]),
          // Optional embedding model ID — lands at memorySearch.model
          // top-level, alongside provider. Empty strings are stripped
          // client-side so we can reject them outright here.
          model: z.string().min(1).max(120).optional(),
          baseUrl: z.string().url().optional(),
          apiKey: z.string().min(1).optional(),
          headers: z.record(z.string()).optional(),
        }),
        z.object({
          mode: z.literal("disabled"),
          sessionsEnabled: z.boolean(),
          dreamingEnabled: z.boolean(),
          vectorWeight: z.number().min(0).max(1),
          textWeight: z.number().min(0).max(1),
        }),
      ])
      .optional(),
  }).optional(),
});

const idParam = z.object({ id: z.string().min(1) });

export async function workspaceRoutes(app: FastifyInstance) {
  // --- Workspaces ---

  app.get("/workspaces", { preHandler: requireAuth }, async (req) => {
    const workspaces = await prisma.workspace.findMany({
      where: { status: { not: "archived" }, userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            agents: { where: { deletedAt: null } },
            tasks: true,
          },
        },
      },
    });

    return workspaces.map((w) => ({
      ...w,
      agentCount: w._count.agents,
      taskCount: w._count.tasks,
      activeTaskCount: 0, // simplified for now
      _count: undefined,
    }));
  });

  app.get("/workspaces/archived", { preHandler: requireAuth }, async (req) => {
    const workspaces = await prisma.workspace.findMany({
      where: { status: "archived", userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { agents: { where: { deletedAt: null } }, tasks: true },
        },
      },
    });

    return workspaces.map((w) => ({
      ...w,
      agentCount: w._count.agents,
      taskCount: w._count.tasks,
      activeTaskCount: 0,
      _count: undefined,
    }));
  });

  app.get("/workspaces/default", { preHandler: requireAuth }, async (req) => {
    const workspace = await prisma.workspace.findFirst({
      where: { isDefault: true, status: "ready", userId: req.userId },
    });
    return { workspaceId: workspace?.id ?? null };
  });

  app.post("/workspaces/:id/set-default", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace || workspace.userId !== req.userId) return reply.status(404).send({ error: "Workspace not found" });

    // Clear all defaults for this user, then set the target
    await prisma.workspace.updateMany({ where: { isDefault: true, userId: req.userId }, data: { isDefault: false } });
    await prisma.workspace.update({ where: { id }, data: { isDefault: true } });

    return { ok: true };
  });

  app.get("/workspaces/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const workspace = await prisma.workspace.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            agents: { where: { deletedAt: null } },
            tasks: true,
          },
        },
      },
    });
    if (!workspace || workspace.userId !== req.userId) return reply.status(404).send({ error: "Workspace not found" });

    // Lazy restore: ensure Docker containers are running when the workspace
    // is opened. This runs in the background so the API response is fast.
    if (workspace.status === "ready") {
      workspaceService.ensureContainers(id).catch(() => {
        // Best-effort — container may not exist yet or Docker may be unavailable
      });
    }

    return {
      ...workspace,
      agentCount: workspace._count.agents,
      taskCount: workspace._count.tasks,
      activeTaskCount: 0,
      _count: undefined,
    };
  });

  app.post("/workspaces", { preHandler: requireAuth }, async (req, reply) => {
    const data = createBody.parse(req.body);
    const slug = data.slug || (await uniqueSlug(data.name));

    const workspace = await prisma.workspace.create({
      data: {
        name: data.name,
        slug,
        description: data.description || "",
        type: data.type || "blank",
        status: "draft",
        settingsJson: data.settingsJson || null,
        userId: req.userId,
      },
    });
    return reply.status(201).send(workspace);
  });

  app.patch("/workspaces/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const data = updateBody.parse(req.body);
    const existing = await prisma.workspace.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.userId) {
      return reply.status(404).send({ error: "Workspace not found" });
    }
    try {
      const workspace = await prisma.workspace.update({
        where: { id },
        data,
      });

      // Sync API keys to OpenClaw workspace when settingsJson changes.
      // Runs in background: write auth-profiles.json then restart the
      // gateway so it picks up the new keys (it caches auth at boot).
      // We stop the container then call ensureContainers() which handles
      // the full restart including the TCP proxy that exposes the dashboard.
      if (data.settingsJson && workspace.status === "ready") {
        const wsId = id;
        const settingsStr = data.settingsJson;
        Promise.resolve().then(async () => {
          try {
            const parsed = JSON.parse(settingsStr) as WorkspaceAISettings;
            // Auth profiles: API keys for built-in providers (openai,
            // anthropic, google, deepseek). Custom providers with a
            // baseUrl inline their apiKey in models.providers instead.
            const authProviders = (parsed.providers ?? [])
              .filter((p) => p.apiKey && !p.baseUrl)
              .map((p) => ({ id: p.id, apiKey: p.apiKey }));
            await syncAuthProfilesToWorkspace(wsId, authProviders);
            // Custom OpenAI-compatible endpoints get a models.providers
            // entry in openclaw.json so OpenClaw knows where to route
            // `<custom-id>/<model>` agent refs.
            await syncCustomProvidersToOpenclawJson(wsId);
            await getRuntime().stop(wsId, 2);
            await workspaceService.ensureContainers(wsId);
          } catch {
            // Non-critical — gateway will pick up keys on next restart
          }
        });
      }

      return workspace;
    } catch {
      return reply.status(404).send({ error: "Workspace not found" });
    }
  });

  app.post("/workspaces/:id/provision", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = provisionBody.parse(req.body);

    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace || workspace.userId !== req.userId) return reply.status(404).send({ error: "Workspace not found" });

    // Determine template key
    let templateKey: string | undefined;
    if (body.templateId) {
      const dbTemplate = await prisma.workspaceTemplate.findFirst({
        where: { OR: [{ id: body.templateId }, { key: body.templateId }] },
      });
      if (dbTemplate) templateKey = dbTemplate.key;
    }

    try {
      await provisionWorkspace({
        workspaceId: id,
        templateKey,
        agents: body.agents,
        skillKeys: body.skillKeys,
        managedSkillKeys: body.managedSkillKeys,
        enableDemoData: body.enableDemoData,
        dockerConfig: body.dockerConfig,
        defaultModel: body.defaultModel,
      });

      const updated = await prisma.workspace.findUnique({ where: { id } });
      return updated;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: "Provisioning failed" });
    }
  });

  // GET /workspaces/:id/docker-status — check if gateway container is running and healthy
  app.get("/workspaces/:id/docker-status", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    try {
      const health = await workspaceService.health(id);
      return { status: health.gateway === "healthy" ? "running" : health.gateway === "unhealthy" ? "starting" : "not_found" };
    } catch {
      return reply.send({ status: "not_found" });
    }
  });

  app.post("/workspaces/:id/archive", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    try {
      // 1. Update DB status
      const workspace = await prisma.workspace.update({
        where: { id },
        data: { status: "archived" },
      });

      // 2. Stop and remove Docker container (non-blocking, best-effort)
      try {
        await workspaceService.delete(id, true /* keepData */);
      } catch {
        // Container may not exist
      }

      // 3. Rename data folder to {id}.bak
      try {
        const dataDir = getDataDir(id);
        const bakDir = `${dataDir}.bak`;
        await stat(dataDir);
        await rename(dataDir, bakDir);
      } catch {
        // Data directory may not exist
      }

      return workspace;
    } catch {
      return reply.status(404).send({ error: "Workspace not found" });
    }
  });

  app.post("/workspaces/:id/restore-archive", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    try {
      // 1. Verify workspace exists and is archived
      const workspace = await prisma.workspace.findUnique({ where: { id } });
      if (!workspace) return reply.status(404).send({ error: "Workspace not found" });
      if (workspace.status !== "archived") {
        return reply.status(400).send({ error: "Workspace is not archived" });
      }

      // 2. Rename data folder from {id}.bak back to {id}
      try {
        const dataDir = getDataDir(id);
        const bakDir = `${dataDir}.bak`;
        await stat(bakDir);
        await rename(bakDir, dataDir);
      } catch {
        // Backup directory may not exist — workspace will work without Docker
      }

      // 3. Update DB status to ready
      const updated = await prisma.workspace.update({
        where: { id },
        data: { status: "ready" },
      });

      // 4. Recreate Docker container in the background
      workspaceService.ensureContainers(id).then(
        (result) => {
          console.log(`Restored workspace "${id}" Docker containers: ${result.action}`);
        },
        () => {
          // Container creation failed — can be retried manually
        },
      );

      return updated;
    } catch {
      return reply.status(500).send({ error: "Restore failed" });
    }
  });

  app.get("/workspaces/:id/export", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    try {
      const manifest = await exportWorkspace(id);
      return manifest;
    } catch {
      return reply.status(404).send({ error: "Workspace not found" });
    }
  });

  const saveAsTemplateBody = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    category: z.string().max(50).optional(),
    icon: z.string().max(50).optional(),
  });

  app.post("/workspaces/:id/save-as-template", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = saveAsTemplateBody.parse(req.body);

    const ws = await prisma.workspace.findUnique({ where: { id } });
    if (!ws || ws.userId !== req.userId) return reply.status(404).send({ error: "Workspace not found" });

    try {
      const manifest = await exportWorkspace(id);

      const agents = manifest.agents.map((a) => ({
        name: a.name,
        role: a.role,
        description: a.description,
        model: a.model,
        skillKeys: a.skillKeys,
        ...(a.soul ? { soul: a.soul } : {}),
        ...(a.agentConfig ? { agentConfig: a.agentConfig } : {}),
        ...(a.identity ? { identity: a.identity } : {}),
      }));

      const config = {
        agents,
        skills: manifest.skills,
        taskTemplates: manifest.taskTemplates.map((t) => t.key),
        demoData: false,
      };

      const key = slugify(body.name) + "-" + Date.now().toString(36);

      const template = await prisma.workspaceTemplate.create({
        data: {
          key,
          name: body.name,
          description: body.description ?? manifest.workspace.description,
          category: body.category ?? manifest.workspace.type ?? "general",
          icon: body.icon ?? "layout-dashboard",
          isBuiltIn: false,
          configJson: JSON.stringify(config),
        },
      });

      return reply.status(201).send({
        ...template,
        config,
      });
    } catch {
      return reply.status(404).send({ error: "Workspace not found" });
    }
  });

  // --- Full Backup / Restore ---

  app.get("/workspaces/:id/backup", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    try {
      const backup = await backupWorkspace(id);
      return backup;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Backup failed";
      if (message === "Workspace not found") return reply.status(404).send({ error: message });
      app.log.error(err);
      return reply.status(500).send({ error: message });
    }
  });

  // Export a copy of the SQLite database file for full system backup
  // Supports both Bearer header and ?token= query param (for direct browser downloads)
  app.get("/workspaces/:id/backup-db", async (req, reply) => {
    const { id } = idParam.parse(req.params);

    // Auth: try header first, then query param
    let userId: string | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      const { verifyJwt } = await import("../auth/service.js");
      const payload = verifyJwt(auth.slice(7));
      userId = payload?.sub ?? null;
    }
    if (!userId) {
      const token = (req.query as Record<string, string>).token;
      if (token) {
        const { verifyJwt } = await import("../auth/service.js");
        const payload = verifyJwt(token);
        userId = payload?.sub ?? null;
      }
    }
    if (!userId) return reply.status(401).send({ error: "Not authenticated" });

    const ws = await prisma.workspace.findUnique({ where: { id } });
    if (!ws || ws.userId !== userId) return reply.status(404).send({ error: "Workspace not found" });

    try {
      const { resolve } = await import("node:path");
      const { createReadStream, existsSync } = await import("node:fs");

      // Resolve the SQLite DB path — Prisma resolves relative to schema dir
      const dbUrl = process.env.DATABASE_URL ?? "file:./opcify.db";
      const dbFileName = dbUrl.replace(/^file:\.\//, "");
      // Search in known locations: monorepo root prisma/, cwd prisma/, cwd
      const candidates = [
        resolve(process.cwd(), "../../prisma", dbFileName), // apps/api -> root/prisma
        resolve(process.cwd(), "prisma", dbFileName),
        resolve(process.cwd(), dbFileName),
      ];
      const dbPath = candidates.find((p) => existsSync(p)) ?? candidates[0];

      if (!existsSync(dbPath)) {
        return reply.status(404).send({ error: "Database file not found" });
      }

      const stream = createReadStream(dbPath);
      return reply
        .header("Content-Type", "application/x-sqlite3")
        .header("Content-Disposition", `attachment; filename="workspace-backup-${new Date().toISOString().slice(0, 10)}.db"`)
        .send(stream);
    } catch (err) {
      const message = err instanceof Error ? err.message : "DB export failed";
      app.log.error(err);
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/workspaces/restore", { preHandler: requireAuth, bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    try {
      const backup = req.body as WorkspaceBackup;
      const { name } = req.query as { name?: string };

      // Validate shape
      const validation = backupSchema.safeParse(backup);
      if (!validation.success) {
        return reply.status(400).send({
          error: "Invalid backup format",
          issues: validation.error.issues.slice(0, 5).map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }

      const result = await restoreWorkspace(backup, name, req.userId ?? undefined);
      return reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Restore failed";
      app.log.error(err);
      return reply.status(500).send({ error: message });
    }
  });

  // Restore database file — replaces the SQLite DB with an uploaded backup
  app.post("/workspaces/restore-db", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { resolve } = await import("node:path");
      const { writeFile, copyFile } = await import("node:fs/promises");
      const { existsSync } = await import("node:fs");

      const dbUrl = process.env.DATABASE_URL ?? "file:./opcify.db";
      const dbFileName = dbUrl.replace(/^file:\.\//, "");
      const candidates = [
        resolve(process.cwd(), "../../prisma", dbFileName),
        resolve(process.cwd(), "prisma", dbFileName),
        resolve(process.cwd(), dbFileName),
      ];
      const dbPath = candidates.find((p) => existsSync(p)) ?? candidates[0];

      // Accept raw binary body
      const body = req.body as Buffer;
      if (!body || body.length < 100) {
        return reply.status(400).send({ error: "Invalid database file" });
      }

      // Verify SQLite header ("SQLite format 3\0")
      const header = body.subarray(0, 16).toString("ascii");
      if (!header.startsWith("SQLite format 3")) {
        return reply.status(400).send({ error: "Not a valid SQLite database file" });
      }

      // Backup current DB before replacing
      const backupPath = `${dbPath}.bak-${Date.now()}`;
      await copyFile(dbPath, backupPath).catch(() => {});

      // Write the uploaded DB
      await writeFile(dbPath, body);

      // Disconnect and reconnect Prisma to pick up the new DB
      await prisma.$disconnect();
      // Prisma will reconnect on next query

      return reply.send({ ok: true, message: "Database restored. Server may need restart for full effect." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "DB restore failed";
      app.log.error(err);
      return reply.status(500).send({ error: message });
    }
  });

  // --- Workspace API Key (for opcify skill callback auth) ---

  app.get("/workspaces/:id/api-key", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const meta = await loadWorkspaceFromDisk(id);
    if (!meta) {
      return reply.status(404).send({ error: "Workspace metadata not found" });
    }
    return { apiKey: meta.opcifyApiKey ?? null };
  });

  app.post("/workspaces/:id/api-key/regenerate", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const meta = await loadWorkspaceFromDisk(id);
    if (!meta) {
      return reply.status(404).send({ error: "Workspace metadata not found" });
    }

    const newKey = generateToken();
    await writeOpcifyApiKeyToDisk(id, newKey);
    await patchOpcifyApiKeyInOpenclawJson(id, newKey);

    return { apiKey: newKey };
  });

  // --- Workspace Templates ---

  app.get("/workspace-templates", async () => {
    const templates = await prisma.workspaceTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });
    return templates.map((t) => ({
      ...t,
      config: JSON.parse(t.configJson),
    }));
  });

  app.get("/workspace-templates/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);

    const template = await prisma.workspaceTemplate.findFirst({
      where: { OR: [{ id }, { key: id }] },
    });
    if (!template) return reply.status(404).send({ error: "Template not found" });

    return {
      ...template,
      config: JSON.parse(template.configJson),
    };
  });
}
