import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { signJwt } from "../modules/auth/service.js";
import { requireWorkspaceAuth, validateWorkspaceBearer } from "./workspace.js";

let app: FastifyInstance;
let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;
let workspaceA: string;
let workspaceB: string;

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest("userId", null);

  const userA = await prisma.user.create({
    data: { email: "ws-mw-a@test", name: "Alice" },
  });
  const userB = await prisma.user.create({
    data: { email: "ws-mw-b@test", name: "Bob" },
  });
  userAId = userA.id;
  userBId = userB.id;
  tokenA = signJwt({ sub: userAId, email: userA.email, name: userA.name });
  tokenB = signJwt({ sub: userBId, email: userB.email, name: userB.name });

  const wsA = await prisma.workspace.create({
    data: {
      name: "WS A",
      slug: "ws-mw-a",
      status: "ready",
      userId: userAId,
    },
  });
  const wsB = await prisma.workspace.create({
    data: {
      name: "WS B",
      slug: "ws-mw-b",
      status: "ready",
      userId: userBId,
    },
  });
  workspaceA = wsA.id;
  workspaceB = wsB.id;

  // A minimal route that just reports success after requireWorkspaceAuth.
  app.get(
    "/workspaces/:workspaceId/ping",
    { preHandler: requireWorkspaceAuth },
    async (req) => ({ ok: true, workspaceId: req.workspaceId }),
  );
  // A handler-level inline auth route to confirm dashboard-style usage.
  app.get("/dashboard/probe", async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: "missing" });
    const result = await validateWorkspaceBearer(req, workspaceId);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return { ok: true };
  });

  await app.ready();
});

afterAll(async () => {
  await prisma.workspace.deleteMany({
    where: { id: { in: [workspaceA, workspaceB] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await app.close();
  await prisma.$disconnect();
});

describe("validateWorkspaceBearer / requireWorkspaceAuth", () => {
  it("returns 401 when no bearer is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/ping`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 when the workspace id does not exist (JWT valid)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/ws_unknown/ping`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when caller is not the owner of an existing workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceB}/ping`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when bearer is unrecognized but workspace exists", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/ping`,
      headers: { authorization: "Bearer nonsense" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when bearer is unrecognized and workspace does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/ws_unknown/ping`,
      headers: { authorization: "Bearer nonsense" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("succeeds when bearer is a valid JWT for the workspace owner", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/ping`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workspaceId).toBe(workspaceA);
  });

  it("both users can reach their own workspace with the same middleware", async () => {
    const resA = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/ping`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(resA.statusCode).toBe(200);
    const resB = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceB}/ping`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(resB.statusCode).toBe(200);
  });

  it("propagates 403/404 correctly via handler-level inline call", async () => {
    // Cross-workspace → 403
    const cross = await app.inject({
      method: "GET",
      url: `/dashboard/probe?workspaceId=${workspaceB}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(cross.statusCode).toBe(403);

    // Unknown → 404
    const unknown = await app.inject({
      method: "GET",
      url: `/dashboard/probe?workspaceId=ws_unknown`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(unknown.statusCode).toBe(404);

    // Owned → 200
    const owned = await app.inject({
      method: "GET",
      url: `/dashboard/probe?workspaceId=${workspaceA}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(owned.statusCode).toBe(200);
  });
});
