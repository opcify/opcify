import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { clientRoutes } from "./routes.js";

let app: FastifyInstance;
let userId: string;
let token: string;
let workspaceId: string;
let otherUserId: string;
let otherToken: string;

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest("userId", null);

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

  await clientRoutes(app);
  await app.ready();

  const user = await prisma.user.create({
    data: { email: "clients-owner@example.test", name: "Clients Owner" },
  });
  userId = user.id;
  token = signJwt({ sub: userId, email: user.email, name: user.name });

  const other = await prisma.user.create({
    data: { email: "clients-other@example.test", name: "Other" },
  });
  otherUserId = other.id;
  otherToken = signJwt({ sub: otherUserId, email: other.email, name: other.name });

  const ws = await prisma.workspace.create({
    data: {
      name: "Clients Test Workspace",
      slug: "test-workspace-clients",
      status: "ready",
      userId,
    },
  });
  workspaceId = ws.id;
});

afterAll(async () => {
  await prisma.client.deleteMany({ where: { workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId } });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.client.deleteMany({ where: { workspaceId } });
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe("POST /workspaces/:workspaceId/clients", () => {
  it("should create a client", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/clients`,
      headers: auth(),
      payload: {
        name: "Acme Corp",
        company: "Acme",
        email: "hello@acme.com",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Acme Corp");
    expect(body.company).toBe("Acme");
    expect(body.email).toBe("hello@acme.com");
    expect(body.status).toBe("active");
    expect(body.workspaceId).toBe(workspaceId);
  });

  it("should require name", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/clients`,
      headers: auth(),
      payload: { company: "No Name Co" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("should validate email format", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/clients`,
      headers: auth(),
      payload: {
        name: "Bad Email",
        email: "not-an-email",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("should 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/clients`,
      payload: { name: "Nobody" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("should 403 with a bearer for another user's workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/clients`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { name: "Cross" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /workspaces/:workspaceId/clients", () => {
  it("should list clients scoped by workspace", async () => {
    await prisma.client.createMany({
      data: [
        { name: "Client A", workspaceId, status: "active" },
        { name: "Client B", workspaceId, status: "active" },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/clients`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(2);
  });

  it("should filter by status", async () => {
    await prisma.client.createMany({
      data: [
        { name: "Active One", workspaceId, status: "active" },
        { name: "Archived One", workspaceId, status: "archived" },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/clients?status=active`,
      headers: auth(),
    });

    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("Active One");
  });

  it("should search by name/company/email", async () => {
    await prisma.client.createMany({
      data: [
        { name: "Acme Corp", company: "Acme", workspaceId },
        { name: "Beta Inc", company: "Beta", email: "info@beta.com", workspaceId },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/clients?q=Acme`,
      headers: auth(),
    });

    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("Acme Corp");
  });
});

describe("PATCH /workspaces/:workspaceId/clients/:id", () => {
  it("should update a client", async () => {
    const client = await prisma.client.create({
      data: { name: "Old Name", workspaceId },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/workspaces/${workspaceId}/clients/${client.id}`,
      headers: auth(),
      payload: {
        name: "New Name",
        phone: "+1-555-0100",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("New Name");
    expect(body.phone).toBe("+1-555-0100");
  });

  it("should return 404 for non-existent client", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/workspaces/${workspaceId}/clients/nonexistent-id`,
      headers: auth(),
      payload: { name: "Whatever" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /workspaces/:workspaceId/clients/:id (archive)", () => {
  it("should archive a client (soft delete)", async () => {
    const client = await prisma.client.create({
      data: { name: "To Archive", workspaceId, status: "active" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/workspaces/${workspaceId}/clients/${client.id}`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("archived");

    const updated = await prisma.client.findUnique({ where: { id: client.id } });
    expect(updated?.status).toBe("archived");
  });
});

describe("GET /workspaces/:workspaceId/clients/:id", () => {
  it("should return client detail with task count", async () => {
    const client = await prisma.client.create({
      data: {
        name: "Detail Client",
        company: "Detail Co",
        email: "detail@example.com",
        workspaceId,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/clients/${client.id}`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Detail Client");
    expect(body._count.tasks).toBe(0);
    expect(body.recentTasks).toEqual([]);
  });

  it("should return 404 for non-existent client", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/clients/nonexistent-id`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /workspaces/:workspaceId/clients/:id/tasks", () => {
  it("should return tasks linked to client", async () => {
    const client = await prisma.client.create({
      data: { name: "Tasked Client", workspaceId },
    });

    const agent = await prisma.agent.create({
      data: { name: "Test Agent", role: "tester", workspaceId },
    });

    await prisma.task.create({
      data: {
        title: "Client Task 1",
        agentId: agent.id,
        clientId: client.id,
        workspaceId,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/clients/${client.id}/tasks`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Client Task 1");

    await prisma.task.deleteMany({ where: { agentId: agent.id } });
    await prisma.agent.delete({ where: { id: agent.id } });
  });
});
