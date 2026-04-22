import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { agentRoutes } from "./routes.js";
import { PrismaAdapter } from "../openclaw-adapter/prisma-adapter.js";
import { getDataDir } from "../../workspace/WorkspaceConfig.js";
import { agentSlug } from "./workspace-sync.js";

let app: FastifyInstance;
let adapter: PrismaAdapter;
let userId: string;
let token: string;
let workspaceId: string;
let auth: () => { authorization: string };
let base: () => string;

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest("userId", null);
  adapter = new PrismaAdapter();

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "Validation failed",
        issues: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    return reply.status(500).send({ error: "Internal server error" });
  });

  await agentRoutes(app, adapter);
  await app.ready();

  const user = await prisma.user.create({
    data: { email: "agents-owner@example.test", name: "Agents Owner" },
  });
  userId = user.id;
  token = signJwt({ sub: userId, email: user.email, name: user.name });

  const ws = await prisma.workspace.create({
    data: {
      name: "Agents Test WS",
      slug: "agents-test-ws",
      status: "ready",
      userId,
    },
  });
  workspaceId = ws.id;

  // Create a minimal openclaw.json so the sync can read/write it
  const { mkdir, writeFile } = await import("node:fs/promises");
  const wsDir = getDataDir(workspaceId);
  await mkdir(wsDir, { recursive: true });
  await writeFile(
    join(wsDir, "openclaw.json"),
    JSON.stringify({ gateway: { port: 18790 } }, null, 2),
  );

  auth = () => ({ authorization: `Bearer ${token}` });
  base = () => `/workspaces/${workspaceId}/agents`;
});

afterAll(async () => {
  await prisma.agentSkill.deleteMany({ where: { agent: { workspaceId } } });
  await prisma.task.deleteMany({ where: { workspaceId } });
  await prisma.agent.deleteMany({ where: { workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId } });
  await prisma.user.delete({ where: { id: userId } });
  const { rm } = await import("node:fs/promises");
  await rm(getDataDir(workspaceId), { recursive: true, force: true }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.agentSkill.deleteMany({ where: { agent: { workspaceId } } });
  await prisma.task.deleteMany({ where: { workspaceId } });
  await prisma.agent.deleteMany({ where: { workspaceId } });
  // Reset the workspace's openclaw.json so each test starts clean
  const { writeFile, rm } = await import("node:fs/promises");
  await rm(join(getDataDir(workspaceId), "agents"), { recursive: true, force: true }).catch(
    () => {},
  );
  await writeFile(
    join(getDataDir(workspaceId), "openclaw.json"),
    JSON.stringify({ gateway: { port: 18790 } }, null, 2),
  );
});

// ─── Create Agent ──────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/agents — create agent", () => {
  it("creates an agent with required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "TestBot", role: "tester" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe("TestBot");
    expect(body.role).toBe("tester");
    expect(body.description).toBe("");
    expect(body.status).toBe("idle");
    expect(body.isSystem).toBe(false);
    expect(body.deletedAt).toBeNull();
    expect(body.soul).toBeNull();
    expect(body.agentConfig).toBeNull();
    expect(body.identity).toBeNull();
  });

  it("creates an agent with soul, agentConfig, and identity", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        name: "SoulBot",
        role: "assistant",
        description: "A soulful agent",
        soul: "You are helpful and kind.",
        agentConfig: "Always verify facts.",
        identity: "Name: SoulBot\nTone: friendly",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.soul).toBe("You are helpful and kind.");
    expect(body.agentConfig).toBe("Always verify facts.");
    expect(body.identity).toBe("Name: SoulBot\nTone: friendly");
  });

  it("rejects missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "NoRole" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects duplicate agent name (409)", async () => {
    await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "DuplicateBot", role: "worker" },
    });
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "DuplicateBot", role: "assistant" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("already exists");
  });

  it("401 without a bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      payload: { name: "NoAuth", role: "worker" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── Update Agent ──────────────────────────────────────────────

describe("PATCH /workspaces/:workspaceId/agents/:id — update agent", () => {
  it("updates individual fields without overwriting others", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "Original", role: "worker", soul: "Be brave." },
    });
    const agent = create.json();

    const res = await app.inject({
      method: "PATCH",
      url: `${base()}/${agent.id}`,
      headers: auth(),
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Updated");
    expect(body.role).toBe("worker");
    expect(body.soul).toBe("Be brave.");
  });

  it("can set soul/agentConfig/identity to null", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "ClearMe", role: "worker", soul: "Something" },
    });
    const agent = create.json();

    const res = await app.inject({
      method: "PATCH",
      url: `${base()}/${agent.id}`,
      headers: auth(),
      payload: { soul: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().soul).toBeNull();
  });

  it("returns 404 for non-existent agent", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `${base()}/nonexistent`,
      headers: auth(),
      payload: { name: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Delete Agent (soft-delete) ────────────────────────────────

describe("DELETE /workspaces/:workspaceId/agents/:id — soft-delete agent", () => {
  it("soft-deletes an agent (204, no longer in list)", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "Deletable", role: "worker" },
    });
    const agent = create.json();

    const delRes = await app.inject({
      method: "DELETE",
      url: `${base()}/${agent.id}`,
      headers: auth(),
    });
    expect(delRes.statusCode).toBe(204);

    const listRes = await app.inject({
      method: "GET",
      url: base(),
      headers: auth(),
    });
    const agents = listRes.json();
    expect(agents.find((a: { id: string }) => a.id === agent.id)).toBeUndefined();

    const dbAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(dbAgent).not.toBeNull();
    expect(dbAgent!.deletedAt).not.toBeNull();
    expect(dbAgent!.status).toBe("disabled");
  });

  it("blocks deletion of system agents (403)", async () => {
    const sysAgent = await prisma.agent.create({
      data: { name: "SystemBot", role: "system", isSystem: true, workspaceId },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `${base()}/${sysAgent.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Cannot delete a system agent");

    const dbAgent = await prisma.agent.findUnique({ where: { id: sysAgent.id } });
    expect(dbAgent!.deletedAt).toBeNull();
  });

  it("returns 404 for non-existent agent", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `${base()}/nonexistent`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Restore Agent ─────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/agents/:id/restore — restore soft-deleted agent", () => {
  it("restores a soft-deleted agent", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "Restorable", role: "worker" },
    });
    const agent = create.json();

    await app.inject({
      method: "DELETE",
      url: `${base()}/${agent.id}`,
      headers: auth(),
    });

    const restoreRes = await app.inject({
      method: "POST",
      url: `${base()}/${agent.id}/restore`,
      headers: auth(),
    });
    expect(restoreRes.statusCode).toBe(200);
    const restored = restoreRes.json();
    expect(restored.deletedAt).toBeNull();
    expect(restored.status).toBe("idle");

    const listRes = await app.inject({
      method: "GET",
      url: base(),
      headers: auth(),
    });
    const agents = listRes.json();
    expect(agents.find((a: { id: string }) => a.id === agent.id)).toBeDefined();
  });

  it("returns 400 when restoring a non-deleted agent", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "Active", role: "worker" },
    });
    const agent = create.json();

    const res = await app.inject({
      method: "POST",
      url: `${base()}/${agent.id}/restore`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Agent is not deleted");
  });

  it("returns 404 for non-existent agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${base()}/nonexistent/restore`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Enable / Disable ──────────────────────────────────────────

describe("POST /workspaces/:workspaceId/agents/:id/enable and /disable", () => {
  it("disables and enables an agent", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "Toggleable", role: "worker" },
    });
    const agent = create.json();
    expect(agent.status).toBe("idle");

    const disRes = await app.inject({
      method: "POST",
      url: `${base()}/${agent.id}/disable`,
      headers: auth(),
    });
    expect(disRes.statusCode).toBe(200);
    expect(disRes.json().status).toBe("disabled");

    const enRes = await app.inject({
      method: "POST",
      url: `${base()}/${agent.id}/enable`,
      headers: auth(),
    });
    expect(enRes.statusCode).toBe(200);
    expect(enRes.json().status).toBe("idle");
  });
});

// ─── Edge Cases ────────────────────────────────────────────────

describe("edge cases", () => {
  it("deleted agent is still fetchable by id", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "StillGetable", role: "worker" },
    });
    const agent = create.json();
    await app.inject({
      method: "DELETE",
      url: `${base()}/${agent.id}`,
      headers: auth(),
    });

    const getRes = await app.inject({
      method: "GET",
      url: `${base()}/${agent.id}`,
      headers: auth(),
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().deletedAt).not.toBeNull();
  });

  it("restoring agent preserves soul/agentConfig/identity", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        name: "DataAgent",
        role: "worker",
        soul: "Be precise.",
        agentConfig: "Check twice.",
        identity: "Name: DataAgent",
      },
    });
    const agent = create.json();

    await app.inject({
      method: "DELETE",
      url: `${base()}/${agent.id}`,
      headers: auth(),
    });
    const restoreRes = await app.inject({
      method: "POST",
      url: `${base()}/${agent.id}/restore`,
      headers: auth(),
    });
    const restored = restoreRes.json();
    expect(restored.soul).toBe("Be precise.");
    expect(restored.agentConfig).toBe("Check twice.");
    expect(restored.identity).toBe("Name: DataAgent");
  });

  it("double delete is idempotent (already soft-deleted)", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "DoubleDelete", role: "worker" },
    });
    const agent = create.json();

    await app.inject({
      method: "DELETE",
      url: `${base()}/${agent.id}`,
      headers: auth(),
    });
    const res = await app.inject({
      method: "DELETE",
      url: `${base()}/${agent.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);
  });
});

// ─── Workspace Sync ────────────────────────────────────────────

describe("workspace filesystem sync", () => {
  it("creates agent directory and updates openclaw.json on create", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        name: "SyncAgent",
        role: "syncer",
        soul: "Be synced.",
      },
    });
    expect(res.statusCode).toBe(201);
    const agent = res.json();

    const agentDir = join(
      getDataDir(workspaceId),
      "agents",
      agentSlug(agent.name),
      "agent",
    );
    expect(existsSync(agentDir)).toBe(true);
    expect(existsSync(join(agentDir, "SOUL.md"))).toBe(true);

    const soul = readFileSync(join(agentDir, "SOUL.md"), "utf-8");
    expect(soul).toBe("Be synced.");

    const config = JSON.parse(
      readFileSync(join(getDataDir(workspaceId), "openclaw.json"), "utf-8"),
    );
    expect(config.agents?.list).toBeDefined();
    const entry = config.agents.list.find(
      (e: { id: string }) => e.id === agentSlug("SyncAgent"),
    );
    expect(entry).toBeDefined();
    expect(entry.name).toBe("SyncAgent");
  });

  it("updates agent files and config on PATCH", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "Updatable", role: "worker" },
    });
    const agent = create.json();

    await app.inject({
      method: "PATCH",
      url: `${base()}/${agent.id}`,
      headers: auth(),
      payload: { soul: "New soul content.", name: "UpdatedName" },
    });

    const agentDir = join(
      getDataDir(workspaceId),
      "agents",
      agentSlug("UpdatedName"),
      "agent",
    );
    const soul = readFileSync(join(agentDir, "SOUL.md"), "utf-8");
    expect(soul).toBe("New soul content.");

    const config = JSON.parse(
      readFileSync(join(getDataDir(workspaceId), "openclaw.json"), "utf-8"),
    );
    const entry = config.agents.list.find(
      (e: { id: string }) => e.id === agentSlug("UpdatedName"),
    );
    expect(entry.name).toBe("UpdatedName");
  });

  it("removes agent directory and config entry on delete", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "ToBeRemoved", role: "worker" },
    });
    const agent = create.json();

    const slug = agentSlug("ToBeRemoved");
    const agentRoot = join(getDataDir(workspaceId), "agents", slug);
    expect(existsSync(agentRoot)).toBe(true);

    await app.inject({
      method: "DELETE",
      url: `${base()}/${agent.id}`,
      headers: auth(),
    });
    expect(existsSync(agentRoot)).toBe(false);

    const config = JSON.parse(
      readFileSync(join(getDataDir(workspaceId), "openclaw.json"), "utf-8"),
    );
    const entry = (config.agents?.list ?? []).find(
      (e: { id: string }) => e.id === slug,
    );
    expect(entry).toBeUndefined();
  });

  it("restores agent directory and config on restore", async () => {
    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "Restorable", role: "worker", soul: "Persist me." },
    });
    const agent = create.json();
    const slug = agentSlug("Restorable");
    const agentRoot = join(getDataDir(workspaceId), "agents", slug);

    await app.inject({
      method: "DELETE",
      url: `${base()}/${agent.id}`,
      headers: auth(),
    });
    expect(existsSync(agentRoot)).toBe(false);

    await app.inject({
      method: "POST",
      url: `${base()}/${agent.id}/restore`,
      headers: auth(),
    });
    const agentDir = join(agentRoot, "agent");
    expect(existsSync(agentDir)).toBe(true);
    expect(existsSync(join(agentDir, "SOUL.md"))).toBe(true);

    const soul = readFileSync(join(agentDir, "SOUL.md"), "utf-8");
    expect(soul).toBe("Persist me.");

    const config = JSON.parse(
      readFileSync(join(getDataDir(workspaceId), "openclaw.json"), "utf-8"),
    );
    const entry = config.agents.list.find(
      (e: { id: string }) => e.id === slug,
    );
    expect(entry).toBeDefined();
  });

  it("writes auth-profiles.json when workspace has AI provider keys", async () => {
    const settings = JSON.stringify({
      providers: [
        { id: "anthropic", apiKey: "sk-ant-test-key-123" },
        { id: "openai", apiKey: "sk-test-openai-456" },
      ],
      defaultModel: "gpt-5.4",
    });
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { settingsJson: settings },
    });

    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "AuthAgent", role: "assistant" },
    });
    expect(res.statusCode).toBe(201);

    const agentDir = join(
      getDataDir(workspaceId),
      "agents",
      agentSlug("AuthAgent"),
      "agent",
    );
    const authPath = join(agentDir, "auth-profiles.json");
    expect(existsSync(authPath)).toBe(true);

    const authContent = JSON.parse(readFileSync(authPath, "utf-8"));
    expect(authContent.profiles["anthropic:default"]).toEqual({
      type: "api_key",
      key: "sk-ant-test-key-123",
      provider: "anthropic",
    });
    expect(authContent.profiles["openai:default"]).toEqual({
      type: "api_key",
      key: "sk-test-openai-456",
      provider: "openai",
    });
  });

  it("updates auth-profiles.json when agent model is changed", async () => {
    const settings = JSON.stringify({
      providers: [{ id: "anthropic", apiKey: "sk-ant-updated-key" }],
      defaultModel: "gpt-5.4",
    });
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { settingsJson: settings },
    });

    const create = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: { name: "ModelChange", role: "worker" },
    });
    const agent = create.json();

    await app.inject({
      method: "PATCH",
      url: `${base()}/${agent.id}`,
      headers: auth(),
      payload: { model: "claude-sonnet-4" },
    });

    const agentDir = join(
      getDataDir(workspaceId),
      "agents",
      agentSlug("ModelChange"),
      "agent",
    );
    const authContent = JSON.parse(
      readFileSync(join(agentDir, "auth-profiles.json"), "utf-8"),
    );
    expect(authContent.profiles["anthropic:default"].key).toBe("sk-ant-updated-key");
  });
});
