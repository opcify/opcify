import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { skillAdvisorRoutes } from "./routes.js";
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

  await skillAdvisorRoutes(app, adapter);
  await app.ready();

  const userA = await prisma.user.create({
    data: { email: "advisor-a@test", name: "Alice" },
  });
  const userB = await prisma.user.create({
    data: { email: "advisor-b@test", name: "Bob" },
  });
  userAId = userA.id;
  userBId = userB.id;
  tokenA = signJwt({ sub: userAId, email: userA.email, name: userA.name });
  authA = { authorization: `Bearer ${tokenA}` };

  const wsA = await prisma.workspace.create({
    data: {
      name: "Advisor WS A",
      slug: "advisor-ws-a",
      status: "ready",
      userId: userAId,
    },
  });
  const wsB = await prisma.workspace.create({
    data: {
      name: "Advisor WS B",
      slug: "advisor-ws-b",
      status: "ready",
      userId: userBId,
    },
  });
  workspaceA = wsA.id;
  workspaceB = wsB.id;

  const aA = await prisma.agent.create({
    data: { name: "AdvisorBotA", role: "researcher", workspaceId: workspaceA },
  });
  const aB = await prisma.agent.create({
    data: { name: "AdvisorBotB", role: "researcher", workspaceId: workspaceB },
  });
  agentA = aA.id;
  agentB = aB.id;
});

afterAll(async () => {
  await prisma.agent.deleteMany({ where: { id: { in: [agentA, agentB] } } });
  await prisma.workspace.deleteMany({
    where: { id: { in: [workspaceA, workspaceB] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await app.close();
  await prisma.$disconnect();
});

describe("GET /workspaces/:workspaceId/agents/:agentId/skills/advice", () => {
  it("returns advice for an owned agent", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/advice`,
      headers: authA,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("installedSkills");
    expect(body).toHaveProperty("recommendedSkills");
    expect(body).toHaveProperty("missingSkills");
  });

  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentA}/skills/advice`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when Alice reaches into Bob's workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceB}/agents/${agentB}/skills/advice`,
      headers: authA,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when Alice requests Bob's agent via her own workspace path", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/agents/${agentB}/skills/advice`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("old /agents/:id/skills/advice route is gone", () => {
  it("returns 404 for the legacy path", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/agents/${agentA}/skills/advice`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });
});
