import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db.js";
import { signJwt } from "../auth/service.js";
import { notesRoutes, parseWikiLinks } from "./routes.js";

let app: FastifyInstance;
let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;
let workspaceA: string;
let workspaceB: string;
let authA: { authorization: string };
let authB: { authorization: string };

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

  await notesRoutes(app);
  await app.ready();

  const userA = await prisma.user.create({
    data: { email: "notes-a@test", name: "Alice" },
  });
  const userB = await prisma.user.create({
    data: { email: "notes-b@test", name: "Bob" },
  });
  userAId = userA.id;
  userBId = userB.id;
  tokenA = signJwt({ sub: userAId, email: userA.email, name: userA.name });
  tokenB = signJwt({ sub: userBId, email: userB.email, name: userB.name });
  authA = { authorization: `Bearer ${tokenA}` };
  authB = { authorization: `Bearer ${tokenB}` };

  const wsA = await prisma.workspace.create({
    data: {
      name: "Test Notes A",
      slug: "test-notes-a",
      status: "ready",
      userId: userAId,
    },
  });
  const wsB = await prisma.workspace.create({
    data: {
      name: "Test Notes B",
      slug: "test-notes-b",
      status: "ready",
      userId: userBId,
    },
  });
  workspaceA = wsA.id;
  workspaceB = wsB.id;
});

afterAll(async () => {
  await prisma.note.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
  await prisma.workspace.deleteMany({
    where: { id: { in: [workspaceA, workspaceB] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.note.deleteMany({
    where: { workspaceId: { in: [workspaceA, workspaceB] } },
  });
});

// ─── CRUD (in-workspace happy path) ────────────────────────────────

describe("POST /workspaces/:workspaceId/notes", () => {
  it("creates a note", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/notes`,
      headers: authA,
      payload: { title: "My Note", contentMarkdown: "# Hello" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe("My Note");
    expect(body.contentMarkdown).toBe("# Hello");
    expect(body.workspaceId).toBe(workspaceA);
    expect(body.isArchived).toBe(false);
  });

  it("requires title", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/notes`,
      headers: authA,
      payload: { contentMarkdown: "no title" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /workspaces/:workspaceId/notes", () => {
  it("lists notes scoped by workspace", async () => {
    await prisma.note.createMany({
      data: [
        { title: "Note A", workspaceId: workspaceA },
        { title: "Note B", workspaceId: workspaceA },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes`,
      headers: authA,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(2);
  });

  it("excludes archived notes by default", async () => {
    await prisma.note.createMany({
      data: [
        { title: "Active", workspaceId: workspaceA, isArchived: false },
        { title: "Archived", workspaceId: workspaceA, isArchived: true },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes`,
      headers: authA,
    });

    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Active");
  });
});

describe("PATCH /workspaces/:workspaceId/notes/:id", () => {
  it("updates note content", async () => {
    const note = await prisma.note.create({
      data: { title: "Original", contentMarkdown: "old", workspaceId: workspaceA },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/workspaces/${workspaceA}/notes/${note.id}`,
      headers: authA,
      payload: { contentMarkdown: "new content" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().contentMarkdown).toBe("new content");
  });

  it("returns 404 for a non-existent note", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/workspaces/${workspaceA}/notes/nonexistent-id`,
      headers: authA,
      payload: { title: "Whatever" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /workspaces/:workspaceId/notes/:id", () => {
  it("deletes a note", async () => {
    const note = await prisma.note.create({
      data: { title: "To Delete", workspaceId: workspaceA },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/workspaces/${workspaceA}/notes/${note.id}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(204);

    const deleted = await prisma.note.findUnique({ where: { id: note.id } });
    expect(deleted).toBeNull();
  });
});

// ─── Search ─────────────────────────────────────────────────────────

describe("GET /workspaces/:workspaceId/notes (search)", () => {
  it("searches by title", async () => {
    await prisma.note.createMany({
      data: [
        { title: "Strategy Plan", workspaceId: workspaceA },
        { title: "Meeting Notes", workspaceId: workspaceA },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes?q=Strategy`,
      headers: authA,
    });

    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Strategy Plan");
  });

  it("searches by content", async () => {
    await prisma.note.createMany({
      data: [
        {
          title: "Note 1",
          contentMarkdown: "important deadline tomorrow",
          workspaceId: workspaceA,
        },
        {
          title: "Note 2",
          contentMarkdown: "nothing special",
          workspaceId: workspaceA,
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes?q=deadline`,
      headers: authA,
    });

    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Note 1");
  });
});

// ─── Wiki Links ─────────────────────────────────────────────────────

describe("parseWikiLinks", () => {
  it("extracts wiki links from markdown", () => {
    const md = "See [[Strategy Plan]] and also [[Meeting Notes]].";
    expect(parseWikiLinks(md)).toEqual(["Strategy Plan", "Meeting Notes"]);
  });

  it("deduplicates links", () => {
    const md = "See [[Plan]] and again [[Plan]].";
    expect(parseWikiLinks(md)).toEqual(["Plan"]);
  });

  it("returns empty for no links", () => {
    expect(parseWikiLinks("No links here")).toEqual([]);
  });
});

// ─── Backlinks ──────────────────────────────────────────────────────

describe("GET /workspaces/:workspaceId/notes/:id (backlinks)", () => {
  it("resolves backlinks", async () => {
    const noteA = await prisma.note.create({
      data: {
        title: "Note A",
        contentMarkdown: "Links to [[Note B]]",
        workspaceId: workspaceA,
      },
    });
    const noteB = await prisma.note.create({
      data: {
        title: "Note B",
        contentMarkdown: "No links here",
        workspaceId: workspaceA,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes/${noteB.id}`,
      headers: authA,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.backlinks.length).toBe(1);
    expect(body.backlinks[0].id).toBe(noteA.id);
    expect(body.backlinks[0].title).toBe("Note A");
  });

  it("shows outgoing links", async () => {
    const note = await prisma.note.create({
      data: {
        title: "Linker",
        contentMarkdown: "See [[Target A]] and [[Target B]]",
        workspaceId: workspaceA,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes/${note.id}`,
      headers: authA,
    });

    expect(res.json().outgoingLinks).toEqual(["Target A", "Target B"]);
  });
});

// ─── Daily Note ─────────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/notes/daily", () => {
  it("creates a daily note", async () => {
    const today = new Date().toISOString().slice(0, 10);

    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/notes/daily`,
      headers: authA,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe(today);
    expect(body.contentMarkdown).toContain("## Plan");
  });

  it("returns the existing daily note on a second call", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/notes/daily`,
      headers: authA,
    });
    const res2 = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/notes/daily`,
      headers: authA,
    });
    expect(res1.json().id).toBe(res2.json().id);
  });
});

// ─── Templates ──────────────────────────────────────────────────────

describe("POST /workspaces/:workspaceId/notes/from-template", () => {
  it("creates a note from a template", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/notes/from-template`,
      headers: authA,
      payload: { templateKey: "brainstorm" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe("Brainstorm");
    expect(body.contentMarkdown).toContain("## Ideas");
  });

  it("rejects an unknown template", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceA}/notes/from-template`,
      headers: authA,
      payload: { templateKey: "nonexistent" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /workspaces/:workspaceId/notes/templates", () => {
  it("lists available templates", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes/templates`,
      headers: authA,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(5);
    expect(body.find((t: { key: string }) => t.key === "brainstorm")).toBeTruthy();
  });
});

// ─── Cross-workspace isolation ─────────────────────────────────────

describe("workspace isolation", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when Alice tries to list Bob's notes", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceB}/notes`,
      headers: authA,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when Alice requests a foreign note via her own workspace path", async () => {
    const noteInB = await prisma.note.create({
      data: { title: "Bob's note", workspaceId: workspaceB },
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes/${noteInB.id}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses to PATCH a foreign note", async () => {
    const noteInB = await prisma.note.create({
      data: { title: "Bob's note", workspaceId: workspaceB },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/workspaces/${workspaceA}/notes/${noteInB.id}`,
      headers: authA,
      payload: { title: "Hijacked" },
    });
    expect(res.statusCode).toBe(404);

    const after = await prisma.note.findUnique({ where: { id: noteInB.id } });
    expect(after?.title).toBe("Bob's note");
  });

  it("refuses to DELETE a foreign note", async () => {
    const noteInB = await prisma.note.create({
      data: { title: "Bob's note", workspaceId: workspaceB },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/workspaces/${workspaceA}/notes/${noteInB.id}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);

    const after = await prisma.note.findUnique({ where: { id: noteInB.id } });
    expect(after).not.toBeNull();
  });

  it("Bob cannot reach Alice's notes either — asymmetric check", async () => {
    await prisma.note.create({
      data: { title: "Alice only", workspaceId: workspaceA },
    });
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceA}/notes`,
      headers: authB,
    });
    expect(res.statusCode).toBe(403);
  });

  it("old /notes route is gone", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/notes?workspaceId=${workspaceA}`,
      headers: authA,
    });
    expect(res.statusCode).toBe(404);
  });
});
