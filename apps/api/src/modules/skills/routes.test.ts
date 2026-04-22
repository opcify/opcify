import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { skillRoutes } from "./routes.js";
import { PrismaAdapter } from "../openclaw-adapter/prisma-adapter.js";

let app: FastifyInstance;
let adapter: PrismaAdapter;
let userAId: string;
let userBId: string;
let tokenA: string;
let workspaceA: string;
let workspaceB: string;
let agentA: string;
let agentB: string;
let skillId: string;
let authA: { authorization: string };

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

  await skillRoutes(app, adapter);
  await app.ready();

  const userA = await prisma.user.create({
    data: { email: "skills-a@test", name: "Alice" },
  });
  const userB = await prisma.user.create({
    data: { email: "skills-b@test", name: "Bob" },
  });
  userAId = userA.id;
  userBId = userB.id;
  tokenA = signJwt({ sub: userAId, email: userA.email, name: userA.name });
  authA = { authorization: `Bearer ${tokenA}` };

  const wsA = await prisma.workspace.create({
    data: {
      name: "Skills WS A",
      slug: "skills-ws-a",
      status: "ready",
      userId: userAId,
    },
  });
  const wsB = await prisma.workspace.create({
    data: {
      name: "Skills WS B",
      slug: "skills-ws-b",
      status: "ready",
      userId: userBId,
    },
  });
  workspaceA = wsA.id;
  workspaceB = wsB.id;

  const aA = await prisma.agent.create({
    data: { name: "SkillTestBotA", role: "tester", workspaceId: workspaceA },
  });
  const aB = await prisma.agent.create({
    data: { name: "SkillTestBotB", role: "tester", workspaceId: workspaceB },
  });
  agentA = aA.id;
  agentB = aB.id;

  const skill = await prisma.skill.create({
    data: {
      key: "test-skill-ws",
      name: "Test Skill Ws",
      description: "A test skill",
      category: "general",
    },
  });
  skillId = skill.id;
});

afterAll(async () => {
  await prisma.agentSkill.deleteMany({
    where: { agentId: { in: [agentA, agentB] } },
  });
  await prisma.agent.deleteMany({
    where: { id: { in: [agentA, agentB] } },
  });
  await prisma.skill.deleteMany({ where: { id: skillId } });
  await prisma.workspace.deleteMany({
    where: { id: { in: [workspaceA, workspaceB] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.agentSkill.deleteMany({
    where: { agentId: { in: [agentA, agentB] } },
  });
});

// ─── Global catalog ─────────────────────────────────────────────

describe("GET /skills", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({ method: "GET", url: "/skills" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the catalog when authenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/skills",
      headers: authA,
    });
    expect(res.statusCode).toBe(200);
    const skills = res.json();
    expect(skills.find((s: { key: string }) => s.key === "test-skill-ws")).toBeDefined();
  });
});

// ─── Workspace-scoped agent-skill routes ────────────────────────

describe("POST /workspaces/:workspaceId/agents/:agentId/skills/install", () => {
  it("installs a skill (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/install`,
      headers: authA,
      payload: { skillId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.agentId).toBe(agentA);
    expect(body.skillId).toBe(skillId);
  });

  it("rejects duplicate install (409)", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/install`,
      headers: authA,
      payload: { skillId },
    });
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/install`,
      headers: authA,
      payload: { skillId },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects non-existent skill (409)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/install`,
      headers: authA,
      payload: { skillId: "nonexistent" },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("GET /workspaces/:workspaceId/agents/:agentId/skills", () => {
  it("returns installed skills for an agent", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/install`,
      headers: authA,
      payload: { skillId },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills`,
      headers: authA,
    });
    expect(res.statusCode).toBe(200);
    const skills = res.json();
    expect(skills.length).toBe(1);
    expect(skills[0].skill.key).toBe("test-skill-ws");
  });

  it("returns empty array for agent with no skills", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills`,
      headers: authA,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("DELETE /workspaces/:workspaceId/agents/:agentId/skills/:skillId", () => {
  it("uninstalls a skill from an agent (204)", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/install`,
      headers: authA,
      payload: { skillId },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/${skillId}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(204);

    const listRes = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills`,
      headers: authA,
    });
    expect(listRes.json()).toEqual([]);
  });

  it("returns 404 for non-installed skill", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/${skillId}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /workspaces/:workspaceId/agents/:agentId/skills/recommendations", () => {
  it("returns skills not installed on the agent", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/recommendations`,
      headers: authA,
    });
    expect(res.statusCode).toBe(200);
    const recommendations = res.json();
    expect(recommendations.find((s: { id: string }) => s.id === skillId)).toBeDefined();
  });

  it("excludes already installed skills", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/install`,
      headers: authA,
      payload: { skillId },
    });
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/recommendations`,
      headers: authA,
    });
    const recommendations = res.json();
    expect(recommendations.find((s: { id: string }) => s.id === skillId)).toBeUndefined();
  });
});

// ─── Cross-workspace isolation ─────────────────────────────────

describe("workspace isolation", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when Alice reaches into Bob's workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceB}/agents/${agentB}/skills`,
      headers: authA,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when Alice references Bob's agent under her own workspace path", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentB}/skills`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses to install a skill on a foreign agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/agents/${agentB}/skills/install`,
      headers: authA,
      payload: { skillId },
    });
    expect(res.statusCode).toBe(404);
    const count = await prisma.agentSkill.count({ where: { agentId: agentB } });
    expect(count).toBe(0);
  });

  it("refuses to uninstall a skill from a foreign agent", async () => {
    // Set up: install on Bob's agent directly via prisma
    await prisma.agentSkill.create({
      data: { agentId: agentB, skillId },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/workspaces/${workspaceA}/agents/${agentB}/skills/${skillId}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
    const still = await prisma.agentSkill.findFirst({
      where: { agentId: agentB, skillId },
    });
    expect(still).not.toBeNull();
  });

  it("old /agents/:id/skills route is gone", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/agents/${agentA}/skills`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });
});
