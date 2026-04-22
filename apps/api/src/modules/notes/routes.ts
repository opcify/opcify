import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import {
  requireWorkspaceAuth,
  assertNoteInWorkspace,
  WorkspaceScopeError,
} from "../../middleware/workspace.js";

// ─── Wiki-link helpers ──────────────────────────────────────────────

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

export function parseWikiLinks(markdown: string): string[] {
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKI_LINK_RE.exec(markdown)) !== null) {
    links.push(m[1].trim());
  }
  return [...new Set(links)];
}

// ─── Note templates (hardcoded) ─────────────────────────────────────

const NOTE_TEMPLATES: Record<string, { title: string; content: string }> = {
  brainstorm: {
    title: "Brainstorm",
    content: `# Brainstorm

## Problem / Opportunity


## Ideas
-

## Evaluation
| Idea | Effort | Impact |
|------|--------|--------|
|      |        |        |

## Next Steps
-
`,
  },
  client_notes: {
    title: "Client Notes",
    content: `# Client Notes

## Client


## Meeting Date


## Key Points
-

## Action Items
- [ ]

## Follow-up
`,
  },
  sop_draft: {
    title: "SOP Draft",
    content: `# SOP: [Process Name]

## Purpose


## Scope


## Steps
1.
2.
3.

## Notes
`,
  },
  content_idea: {
    title: "Content Idea",
    content: `# Content Idea

## Topic


## Target Audience


## Key Points
-

## Outline
1.
2.
3.

## References
-
`,
  },
  quotation_draft: {
    title: "Quotation Draft",
    content: `# Quotation Draft

## Client


## Project Description


## Scope of Work
-

## Deliverables
-

## Timeline


## Pricing
| Item | Amount |
|------|--------|
|      |        |

## Terms & Conditions
`,
  },
  daily_note: {
    title: "",
    content: `## Plan
-

## Notes
-

## End of Day
-
`,
  },
};

// ─── Zod schemas ────────────────────────────────────────────────────

const workspaceOnlyParams = z.object({
  workspaceId: z.string().min(1),
});

const workspaceNoteParams = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const listQuery = z.object({
  q: z.string().optional(),
  includeArchived: z.string().optional(),
});

const createBody = z.object({
  title: z.string().min(1),
  contentMarkdown: z.string().optional(),
  clientId: z.string().optional(),
});

const updateBody = z.object({
  title: z.string().min(1).optional(),
  contentMarkdown: z.string().optional(),
  clientId: z.string().nullable().optional(),
  isArchived: z.boolean().optional(),
});

const dailyNoteQuery = z.object({
  date: z.string().optional(),
});

const fromTemplateBody = z.object({
  templateKey: z.string().min(1),
  title: z.string().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────

async function guardNoteInWorkspace(
  id: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    await assertNoteInWorkspace(id, workspaceId);
    return true;
  } catch (err) {
    if (err instanceof WorkspaceScopeError) {
      reply.status(404).send({ error: "Note not found" });
      return false;
    }
    throw err;
  }
}

async function validateClientInWorkspace(
  clientId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true },
  });
  if (!client) {
    reply.status(400).send({ error: "Client not found in this workspace" });
    return false;
  }
  return true;
}

// ─── Routes ─────────────────────────────────────────────────────────

export async function notesRoutes(app: FastifyInstance) {
  const preHandler = requireWorkspaceAuth;

  // ── Static routes first (before parametric /:id) ─────────────────

  // List notes
  app.get(
    "/workspaces/:workspaceId/notes",
    { preHandler },
    async (req) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      const { q, includeArchived } = listQuery.parse(req.query);

      const where: Record<string, unknown> = { workspaceId };

      if (includeArchived !== "true") {
        where.isArchived = false;
      }

      if (q) {
        where.OR = [
          { title: { contains: q } },
          { contentMarkdown: { contains: q } },
        ];
      }

      return prisma.note.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          workspaceId: true,
          title: true,
          contentMarkdown: true,
          clientId: true,
          isArchived: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    },
  );

  // Create note
  app.post(
    "/workspaces/:workspaceId/notes",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      const body = createBody.parse(req.body);

      if (body.clientId) {
        if (!(await validateClientInWorkspace(body.clientId, workspaceId, reply))) {
          return;
        }
      }

      const note = await prisma.note.create({
        data: {
          title: body.title,
          contentMarkdown: body.contentMarkdown ?? "",
          clientId: body.clientId || null,
          workspaceId,
        },
      });

      return reply.status(201).send(note);
    },
  );

  // Note templates list
  app.get(
    "/workspaces/:workspaceId/notes/templates",
    { preHandler },
    async () => {
      return Object.entries(NOTE_TEMPLATES).map(([key, val]) => ({
        key,
        title: val.title || key,
        content: val.content,
      }));
    },
  );

  // Daily note — get or create
  app.post(
    "/workspaces/:workspaceId/notes/daily",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      const { date } = dailyNoteQuery.parse(req.query);

      const targetDate = date || new Date().toISOString().slice(0, 10);
      const title = targetDate; // e.g. "2026-03-27"

      const existing = await prisma.note.findFirst({
        where: { workspaceId, title },
      });

      if (existing) {
        return existing;
      }

      const template = NOTE_TEMPLATES.daily_note;
      const note = await prisma.note.create({
        data: {
          title,
          contentMarkdown: `# ${title}\n\n${template.content}`,
          workspaceId,
        },
      });

      return reply.status(201).send(note);
    },
  );

  // Create note from template
  app.post(
    "/workspaces/:workspaceId/notes/from-template",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceOnlyParams.parse(req.params);
      const { templateKey, title } = fromTemplateBody.parse(req.body);

      const template = NOTE_TEMPLATES[templateKey];
      if (!template) {
        return reply.status(400).send({ error: `Unknown template: ${templateKey}` });
      }

      const noteTitle = title || template.title || templateKey;

      const note = await prisma.note.create({
        data: {
          title: noteTitle,
          contentMarkdown: template.content,
          workspaceId,
        },
      });

      return reply.status(201).send(note);
    },
  );

  // ── Parametric routes ─────────────────────────────────────────────

  // Get single note with links
  app.get(
    "/workspaces/:workspaceId/notes/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceNoteParams.parse(req.params);

      if (!(await guardNoteInWorkspace(id, workspaceId, reply))) return;

      const note = await prisma.note.findUnique({
        where: { id },
        include: {
          client: { select: { id: true, name: true } },
        },
      });

      if (!note) {
        return reply.status(404).send({ error: "Note not found" });
      }

      const outgoingLinks = parseWikiLinks(note.contentMarkdown);

      const allNotes = await prisma.note.findMany({
        where: { workspaceId, id: { not: id }, isArchived: false },
        select: { id: true, title: true, contentMarkdown: true },
      });

      const backlinks = allNotes
        .filter((n) => n.contentMarkdown.includes(`[[${note.title}]]`))
        .map((n) => ({ id: n.id, title: n.title }));

      return {
        ...note,
        outgoingLinks,
        backlinks,
      };
    },
  );

  // Update note
  app.patch(
    "/workspaces/:workspaceId/notes/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceNoteParams.parse(req.params);
      const data = updateBody.parse(req.body);

      if (!(await guardNoteInWorkspace(id, workspaceId, reply))) return;

      if (data.clientId) {
        if (!(await validateClientInWorkspace(data.clientId, workspaceId, reply))) {
          return;
        }
      }

      const updateData: Record<string, unknown> = {};
      if (data.title !== undefined) updateData.title = data.title;
      if (data.contentMarkdown !== undefined) updateData.contentMarkdown = data.contentMarkdown;
      if (data.clientId !== undefined) updateData.clientId = data.clientId;
      if (data.isArchived !== undefined) updateData.isArchived = data.isArchived;

      try {
        const note = await prisma.note.update({
          where: { id },
          data: updateData,
        });
        return note;
      } catch {
        return reply.status(404).send({ error: "Note not found" });
      }
    },
  );

  // Delete note
  app.delete(
    "/workspaces/:workspaceId/notes/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceNoteParams.parse(req.params);

      if (!(await guardNoteInWorkspace(id, workspaceId, reply))) return;

      try {
        await prisma.note.delete({ where: { id } });
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: "Note not found" });
      }
    },
  );

  // Backlinks for a note
  app.get(
    "/workspaces/:workspaceId/notes/:id/backlinks",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceNoteParams.parse(req.params);

      if (!(await guardNoteInWorkspace(id, workspaceId, reply))) return;

      const note = await prisma.note.findUnique({
        where: { id },
        select: { title: true },
      });
      if (!note) {
        return reply.status(404).send({ error: "Note not found" });
      }

      const allNotes = await prisma.note.findMany({
        where: { workspaceId, id: { not: id }, isArchived: false },
        select: { id: true, title: true, contentMarkdown: true },
      });

      const backlinks = allNotes
        .filter((n) => n.contentMarkdown.includes(`[[${note.title}]]`))
        .map((n) => ({ id: n.id, title: n.title }));

      return backlinks;
    },
  );
}
