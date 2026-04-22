import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { taskTemplateRoutes } from "./routes.js";
import { PrismaAdapter } from "../openclaw-adapter/prisma-adapter.js";

let app: FastifyInstance;
let adapter: PrismaAdapter;
let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;
let workspaceA: string;
let workspaceB: string;
let agentA: string;
let agentB: string;
let taskInA: string;
let authA: { authorization: string };
let authB: { authorization: string };

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

  await taskTemplateRoutes(app, adapter);
  await app.ready();

  const userA = await prisma.user.create({
    data: { email: "tt-a@test", name: "Alice" },
  });
  const userB = await prisma.user.create({
    data: { email: "tt-b@test", name: "Bob" },
  });
  userAId = userA.id;
  userBId = userB.id;
  tokenA = signJwt({ sub: userAId, email: userA.email, name: userA.name });
  tokenB = signJwt({ sub: userBId, email: userB.email, name: userB.name });
  authA = { authorization: `Bearer ${tokenA}` };
  authB = { authorization: `Bearer ${tokenB}` };

  const wsA = await prisma.workspace.create({
    data: {
      name: "Tmpl WS A",
      slug: "tmpl-ws-a",
      status: "ready",
      userId: userAId,
    },
  });
  const wsB = await prisma.workspace.create({
    data: {
      name: "Tmpl WS B",
      slug: "tmpl-ws-b",
      status: "ready",
      userId: userBId,
    },
  });
  workspaceA = wsA.id;
  workspaceB = wsB.id;

  const aA = await prisma.agent.create({
    data: { name: "TmplBotA", role: "worker", workspaceId: workspaceA },
  });
  const aB = await prisma.agent.create({
    data: { name: "TmplBotB", role: "worker", workspaceId: workspaceB },
  });
  agentA = aA.id;
  agentB = aB.id;

  const tA = await prisma.task.create({
    data: {
      title: "Source A",
      description: "for template",
      agentId: agentA,
      workspaceId: workspaceA,
    },
  });
  taskInA = tA.id;
});

afterAll(async () => {
  await prisma.taskTemplate.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
  await prisma.task.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
  await prisma.agent.deleteMany({ where: { id: { in: [agentA, agentB] } } });
  await prisma.workspace.deleteMany({
    where: { id: { in: [workspaceA, workspaceB] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.taskTemplate.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
});

// ─── Happy path ────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/task-templates", () => {
  it("creates a workspace-scoped template", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/task-templates`,
      headers: authA,
      payload: {
        name: "Alice Template",
        category: "operations",
        description: "A test",
        suggestedAgentRoles: [],
        defaultTitle: "Task from template",
        defaultDescription: "",
        defaultTags: [],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Alice Template");
    expect(body.workspaceId).toBe(workspaceA);
  });
});

describe("GET /workspaces/:workspaceId/task-templates", () => {
  it("returns built-ins + workspace templates", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/task-templates`,
      headers: authA,
      payload: {
        name: "Alice's own",
        category: "operations",
        description: "A test template",
        suggestedAgentRoles: [],
        defaultTitle: "T",
        defaultDescription: "",
        defaultTags: [],
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/task-templates`,
      headers: authA,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // at least built-ins + the one we just made
    expect(body.some((t: { name: string }) => t.name === "Alice's own")).toBe(true);
    // built-ins (isBuiltIn: true) should still be visible
    expect(body.some((t: { isBuiltIn: boolean }) => t.isBuiltIn)).toBe(true);
  });

  it("does NOT return another workspace's templates in the list", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/task-templates`,
      headers: authA,
      payload: {
        name: "Alice only",
        category: "operations",
        description: "A test template",
        suggestedAgentRoles: [],
        defaultTitle: "T",
        defaultDescription: "",
        defaultTags: [],
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceB}/task-templates`,
      headers: authB,
    });
    const body = res.json();
    expect(body.some((t: { name: string }) => t.name === "Alice only")).toBe(false);
  });
});

describe("POST /workspaces/:workspaceId/task-templates/from-task/:taskId", () => {
  it("saves a template from a task in the caller's workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/task-templates/from-task/${taskInA}`,
      headers: authA,
      payload: { name: "From Task A" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("From Task A");
  });

  it("refuses when the task belongs to a different workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceB}/task-templates/from-task/${taskInA}`,
      headers: authB,
      payload: { name: "Hijack" },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Cross-workspace isolation ─────────────────────────────────

describe("workspace isolation", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/task-templates`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when Alice reaches into Bob's workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceB}/task-templates`,
      headers: authA,
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses to GET a foreign template by id", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceB}/task-templates`,
      headers: authB,
      payload: {
        name: "Bob only",
        category: "operations",
        description: "A test template",
        suggestedAgentRoles: [],
        defaultTitle: "T",
        defaultDescription: "",
        defaultTags: [],
      },
    });
    const id = create.json().id;

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/task-templates/${id}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses to DELETE a foreign template", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceB}/task-templates`,
      headers: authB,
      payload: {
        name: "Bob's to delete",
        category: "operations",
        description: "A test template",
        suggestedAgentRoles: [],
        defaultTitle: "T",
        defaultDescription: "",
        defaultTags: [],
      },
    });
    const id = create.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/workspaces/${workspaceA}/task-templates/${id}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);

    const still = await prisma.taskTemplate.findUnique({ where: { id } });
    expect(still).not.toBeNull();
  });

  it("old /task-templates route is gone", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/task-templates",
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Built-in templates (hardcoded, workspace-agnostic) ───────────

describe("built-in task templates", () => {
  it("GETs a built-in template by id from any workspace", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/task-templates`,
      headers: authA,
    });
    const builtIn = list
      .json()
      .find((t: { isBuiltIn: boolean }) => t.isBuiltIn) as
      | { id: string }
      | undefined;
    expect(builtIn).toBeDefined();

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/task-templates/${builtIn!.id}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(builtIn!.id);
  });

  it("creates a task from a built-in template (ttpl-* id)", async () => {
    // Regression: guardTemplateReadable used to fall through to a DB
    // lookup that always missed for built-ins, so POST /create-task
    // returned 404 for any ttpl-* id.
    const list = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/task-templates`,
      headers: authA,
    });
    const builtIn = list
      .json()
      .find((t: { isBuiltIn: boolean; id: string }) =>
        t.isBuiltIn && t.id.startsWith("ttpl-"),
      ) as { id: string } | undefined;
    expect(builtIn).toBeDefined();

    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/task-templates/${builtIn!.id}/create-task`,
      headers: authA,
      payload: {
        title: "Task from built-in",
        description: "via regression test",
        agentId: agentA,
      },
    });
    expect(res.statusCode).toBe(201);
    const task = res.json();
    expect(task.title).toBe("Task from built-in");
    expect(task.workspaceId).toBe(workspaceA);

    await prisma.task.delete({ where: { id: task.id } });
  });
});
