import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { inboxRoutes } from "./routes.js";

let app: FastifyInstance;
let userId: string;
let token: string;
let workspaceId: string;

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

  await inboxRoutes(app);
  await app.ready();

  const user = await prisma.user.create({
    data: { email: "inbox-owner@example.test", name: "Inbox Owner" },
  });
  userId = user.id;
  token = signJwt({ sub: userId, email: user.email, name: user.name });

  const ws = await prisma.workspace.create({
    data: {
      name: "Test Workspace Inbox Compose",
      slug: "test-workspace-inbox-compose",
      status: "ready",
      userId,
    },
  });
  workspaceId = ws.id;
});

afterAll(async () => {
  await prisma.inboxItem.deleteMany({ where: { workspaceId } });
  await prisma.agent.deleteMany({ where: { workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId } });
  await prisma.user.delete({ where: { id: userId } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.inboxItem.deleteMany({ where: { workspaceId } });
  await prisma.agent.deleteMany({ where: { workspaceId } });
});

const auth = () => ({ authorization: `Bearer ${token}` });
const base = () => `/workspaces/${workspaceId}/inbox`;

// ─── Draft CRUD ─────────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/inbox/drafts", () => {
  it("creates an empty draft", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${base()}/drafts`,
      headers: auth(),
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("draft");
    expect(body.kind).toBe("email");
    expect(body.source).toBe("compose");
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.emailTo).toBeNull();
    expect(body.emailSubject).toBeNull();
    expect(body.content).toBe("");
  });

  it("creates a draft with initial fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${base()}/drafts`,
      headers: auth(),
      payload: {
        to: ["alice@example.com", "bob@example.com"],
        cc: ["carol@example.com"],
        subject: "Q2 update",
        body: "Hello team",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.emailTo).toBe("alice@example.com, bob@example.com");
    expect(body.emailCc).toBe("carol@example.com");
    expect(body.emailSubject).toBe("Q2 update");
    expect(body.content).toBe("Hello team");
  });
});

describe("PATCH /workspaces/:workspaceId/inbox/drafts/:id", () => {
  it("updates a draft", async () => {
    const created = await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "draft",
        kind: "email",
        source: "compose",
        content: "",
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `${base()}/drafts/${created.id}`,
      headers: auth(),
      payload: {
        to: ["new@example.com"],
        bcc: ["secret@example.com"],
        subject: "Hello",
        body: "Body text",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.emailTo).toBe("new@example.com");
    expect(body.emailBcc).toBe("secret@example.com");
    expect(body.emailSubject).toBe("Hello");
    expect(body.content).toBe("Body text");
  });

  it("refuses to patch a non-draft item", async () => {
    const sent = await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        kind: "email",
        source: "email",
        content: "old",
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `${base()}/drafts/${sent.id}`,
      headers: auth(),
      payload: { subject: "Hijack" },
    });

    expect(res.statusCode).toBe(409);
  });
});

describe("DELETE /workspaces/:workspaceId/inbox/drafts/:id", () => {
  it("discards a draft", async () => {
    const created = await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "draft",
        kind: "email",
        source: "compose",
        content: "",
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `${base()}/drafts/${created.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);

    const after = await prisma.inboxItem.findUnique({
      where: { id: created.id },
    });
    expect(after).toBeNull();
  });

  it("refuses to delete a non-draft via the drafts endpoint", async () => {
    const sent = await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        kind: "email",
        source: "email",
        content: "old",
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `${base()}/drafts/${sent.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(409);
  });
});

// ─── Compose validation ─────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/inbox/compose", () => {
  it("rejects when `to` is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${base()}/compose`,
      headers: auth(),
      payload: {
        agentId: "nonexistent",
        to: [],
        subject: "Hi",
        body: "Body",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when the agent does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${base()}/compose`,
      headers: auth(),
      payload: {
        agentId: "nonexistent-agent-id",
        to: ["alice@example.com"],
        subject: "Hi",
        body: "Body",
      },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toMatch(/agent/i);
  });
});

// ─── Sent-mail placeholder upgrade ──────────────────────────────────

describe("POST /workspaces/:workspaceId/inbox placeholder upgrade", () => {
  it("upgrades a recent placeholder instead of inserting a duplicate", async () => {
    const placeholder = await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        kind: "email",
        source: "email",
        actionTaken: "replied",
        emailFrom: "andrewq25133@gmail.com",
        emailTo: "techsiderau@gmail.com",
        emailSubject: "Meeting Request – Next Monday at 1pm",
        emailDate: new Date(),
        emailIsRead: true,
        content: "Hi Yang,\n\nLet's meet at 1pm.",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        content: "Hi Yang,\n\nLet's meet at 1pm.",
        kind: "email",
        source: "email",
        emailMessageId: "<real-msg-id-123@mail.gmail.com>",
        emailFrom: "Andrew <andrewq25133@gmail.com>",
        emailTo: "techsiderau@gmail.com",
        emailSubject: "Meeting Request – Next Monday at 1pm",
        emailDate: new Date().toISOString(),
        emailThreadId: "gmail-thread-abc",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(placeholder.id);
    expect(body.emailMessageId).toBe("<real-msg-id-123@mail.gmail.com>");
    expect(body.emailThreadId).toBe("gmail-thread-abc");

    const allRows = await prisma.inboxItem.findMany({
      where: { workspaceId, kind: "email" },
    });
    expect(allRows.length).toBe(1);
  });

  it("matches the placeholder even when watcher emailFrom is in 'Name <addr>' form", async () => {
    const placeholder = await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        kind: "email",
        source: "email",
        emailFrom: "andrewq25133@gmail.com",
        emailTo: "yang@example.com, other@example.com",
        emailSubject: "Re: Status update",
        emailDate: new Date(),
        content: "All good.",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        content: "All good.",
        kind: "email",
        source: "email",
        emailMessageId: "<msg-2@mail.gmail.com>",
        emailFrom: "\"Andrew Q\" <ANDREWQ25133@gmail.com>",
        emailTo: "Yang <yang@example.com>",
        emailSubject: "RE: Status update",
        emailDate: new Date().toISOString(),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(placeholder.id);
    expect(body.emailMessageId).toBe("<msg-2@mail.gmail.com>");
  });

  it("creates a new row when no placeholder matches", async () => {
    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        content: "Hello there",
        kind: "email",
        source: "email",
        emailMessageId: "<unrelated@mail.gmail.com>",
        emailFrom: "stranger@example.com",
        emailTo: "andrewq25133@gmail.com",
        emailSubject: "A brand new thread",
        emailDate: new Date().toISOString(),
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.emailMessageId).toBe("<unrelated@mail.gmail.com>");
  });

  it("does NOT upgrade a placeholder older than the 30-min match window", async () => {
    const oldDate = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        kind: "email",
        source: "email",
        emailFrom: "andrewq25133@gmail.com",
        emailTo: "stale@example.com",
        emailSubject: "Old subject",
        emailDate: oldDate,
        createdAt: oldDate,
        content: "Old body",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: base(),
      headers: auth(),
      payload: {
        content: "Old body",
        kind: "email",
        source: "email",
        emailMessageId: "<old-msg@mail.gmail.com>",
        emailFrom: "andrewq25133@gmail.com",
        emailTo: "stale@example.com",
        emailSubject: "Old subject",
        emailDate: new Date().toISOString(),
      },
    });

    expect(res.statusCode).toBe(201);

    const rows = await prisma.inboxItem.findMany({
      where: { workspaceId, kind: "email", emailSubject: "Old subject" },
    });
    expect(rows.length).toBe(2);
  });
});

// ─── Empty-row filtering and cleanup ────────────────────────────────

describe("GET /workspaces/:workspaceId/inbox empty-row filter", () => {
  it("hides email rows that have no from, no to, no subject and no body", async () => {
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "draft",
        kind: "email",
        source: "compose",
        content: "",
      },
    });
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "inbox",
        kind: "email",
        source: "email",
        emailFrom: "alice@example.com",
        emailTo: "andrew@example.com",
        emailSubject: "Real one",
        content: "actual body",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: base(),
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].emailSubject).toBe("Real one");
  });

  it("does NOT drop a non-email row even if it looks empty", async () => {
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "inbox",
        kind: "idea",
        source: "manual",
        content: "Brainstorm later",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: base(),
      headers: auth(),
    });
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].kind).toBe("idea");
  });
});

describe("POST /workspaces/:workspaceId/inbox/cleanup-empty-drafts", () => {
  it("deletes empty draft rows and returns the count", async () => {
    for (let i = 0; i < 3; i++) {
      await prisma.inboxItem.create({
        data: {
          workspaceId,
          status: "draft",
          kind: "email",
          source: "compose",
          content: "",
        },
      });
    }
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "draft",
        kind: "email",
        source: "compose",
        emailSubject: "WIP idea",
        content: "draft body",
      },
    });
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        kind: "email",
        source: "email",
        emailFrom: "andrew@example.com",
        emailTo: "yang@example.com",
        emailSubject: "Real",
        content: "Real body",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `${base()}/cleanup-empty-drafts`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 3 });

    const remaining = await prisma.inboxItem.findMany({
      where: { workspaceId },
    });
    expect(remaining.length).toBe(2);
    const subjects = remaining.map((r) => r.emailSubject).sort();
    expect(subjects).toEqual(["Real", "WIP idea"]);
  });

  it("returns deleted: 0 when there is nothing to clean", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${base()}/cleanup-empty-drafts`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 0 });
  });
});

// ─── All filter excludes archived ───────────────────────────────────

describe("GET /workspaces/:workspaceId/inbox (no status filter)", () => {
  it("excludes archived items so they only appear in the Archived tab", async () => {
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        actionTaken: "archived",
        kind: "email",
        source: "email",
        emailFrom: "alice@example.com",
        emailTo: "andrew@example.com",
        emailSubject: "Old archived chat",
        content: "archived body",
      },
    });
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "inbox",
        kind: "email",
        source: "email",
        emailFrom: "bob@example.com",
        emailTo: "andrew@example.com",
        emailSubject: "Live thread",
        content: "live body",
      },
    });
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        actionTaken: "replied",
        kind: "email",
        source: "email",
        emailFrom: "carol@example.com",
        emailTo: "andrew@example.com",
        emailSubject: "Replied chat",
        content: "replied body",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: base(),
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const subjects = body.map((b: { emailSubject: string }) => b.emailSubject).sort();
    expect(subjects).toEqual(["Live thread", "Replied chat"]);
  });
});

// ─── Archived virtual filter ────────────────────────────────────────

describe("GET /workspaces/:workspaceId/inbox?status=archived", () => {
  it("returns only items archived via the action endpoint", async () => {
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        actionTaken: "archived",
        kind: "email",
        source: "email",
        emailFrom: "alice@example.com",
        emailTo: "andrew@example.com",
        emailSubject: "Old chat",
        content: "archived body",
      },
    });
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "processed",
        actionTaken: "replied",
        kind: "email",
        source: "email",
        emailFrom: "bob@example.com",
        emailTo: "andrew@example.com",
        emailSubject: "Replied chat",
        content: "replied body",
      },
    });
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "inbox",
        kind: "email",
        source: "email",
        emailFrom: "carol@example.com",
        emailTo: "andrew@example.com",
        emailSubject: "Live thread",
        content: "live body",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `${base()}?status=archived`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].emailSubject).toBe("Old chat");
    expect(body[0].status).toBe("processed");
    expect(body[0].actionTaken).toBe("archived");
  });
});

// ─── Drafts list filter ─────────────────────────────────────────────

describe("GET /workspaces/:workspaceId/inbox?status=draft", () => {
  it("returns drafts when filtered", async () => {
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "draft",
        kind: "email",
        source: "compose",
        content: "draft body",
        emailSubject: "Draft 1",
      },
    });
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        status: "inbox",
        kind: "email",
        source: "email",
        content: "incoming",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `${base()}?status=draft`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].status).toBe("draft");
    expect(body[0].emailSubject).toBe("Draft 1");
  });
});

describe("auth", () => {
  it("401 when no bearer token is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: base(),
    });
    expect(res.statusCode).toBe(401);
  });
});
