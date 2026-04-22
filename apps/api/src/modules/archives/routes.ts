import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listArchives,
  createFolder,
  saveFiles,
  deleteArchiveItem,
  moveArchiveItem,
  syncToCloud,
  generateShareLink,
  getFileStream,
  ensureArchivesDir,
  PathTraversalError,
} from "./service.js";
import { requireWorkspaceAuth } from "../../middleware/workspace.js";

// ─── Schemas ──────────────────────────────────────────────────────────

const workspaceParams = z.object({
  workspaceId: z.string().min(1),
});

const listQuery = z.object({
  path: z.string().default(""),
});

const downloadQuery = z.object({
  path: z.string().min(1),
  inline: z.string().optional(),
});

const deleteQuery = z.object({
  path: z.string().min(1),
});

const uploadBody = z.object({
  path: z.string().default(""),
  files: z
    .array(
      z.object({
        fileName: z.string().min(1),
        data: z.string().min(1),
      }),
    )
    .min(1)
    .max(20),
});

const folderBody = z.object({
  path: z.string().min(1),
});

const moveBody = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

const shareBody = z.object({
  path: z.string().min(1),
  expirySeconds: z.number().int().min(60).max(604800).default(604800),
});

// ─── Routes ───────────────────────────────────────────────────────────

export async function archiveRoutes(app: FastifyInstance): Promise<void> {
  const preHandler = requireWorkspaceAuth;

  // ── List files/folders at a path ────────────────────────────────
  app.get(
    "/workspaces/:workspaceId/archives",
    { preHandler },
    async (req, _reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const { path } = listQuery.parse(req.query);
      await ensureArchivesDir(workspaceId);
      const items = await listArchives(workspaceId, path);
      return { items, path };
    },
  );

  // ── Download / preview a file ────────────────────────────────────
  app.get(
    "/workspaces/:workspaceId/archives/download",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const { path, inline: inlineFlag } = downloadQuery.parse(req.query);
      try {
        const { stream, size, name } = await getFileStream(workspaceId, path);

        if (inlineFlag === "1") {
          const ext = name.split(".").pop()?.toLowerCase() || "";
          const mimeMap: Record<string, string> = {
            pdf: "application/pdf",
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
            bmp: "image/bmp",
            ico: "image/x-icon",
            txt: "text/plain",
            md: "text/plain",
            json: "application/json",
            csv: "text/csv",
            xml: "text/xml",
            html: "text/html",
            htm: "text/html",
            css: "text/css",
            js: "text/javascript",
            ts: "text/plain",
            py: "text/plain",
            sh: "text/plain",
            yaml: "text/plain",
            yml: "text/plain",
            toml: "text/plain",
            log: "text/plain",
          };
          const contentType = mimeMap[ext] || "application/octet-stream";
          reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(name)}"`);
          reply.header("Content-Length", size);
          reply.type(contentType);
        } else {
          reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
          reply.header("Content-Length", size);
          reply.type("application/octet-stream");
        }

        return reply.send(stream);
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return reply.status(400).send({ error: err.message });
        }
        return reply.status(404).send({ error: "File not found" });
      }
    },
  );

  // ── Upload files ────────────────────────────────────────────────
  app.post(
    "/workspaces/:workspaceId/archives/upload",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const body = uploadBody.parse(req.body);
      try {
        const paths = await saveFiles(workspaceId, body.path, body.files);
        return reply.status(201).send({ paths });
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ── Create folder ───────────────────────────────────────────────
  app.post(
    "/workspaces/:workspaceId/archives/folder",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const body = folderBody.parse(req.body);
      try {
        await createFolder(workspaceId, body.path);
        return reply.status(201).send({ path: body.path });
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ── Delete file or folder ───────────────────────────────────────
  app.delete(
    "/workspaces/:workspaceId/archives",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const { path } = deleteQuery.parse(req.query);
      try {
        await deleteArchiveItem(workspaceId, path);
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ── Share (generate signed URL) ──────────────────────────────────
  app.post(
    "/workspaces/:workspaceId/archives/share",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const body = shareBody.parse(req.body);
      try {
        const result = await generateShareLink(workspaceId, body.path, body.expirySeconds);
        if ("error" in result) {
          return reply.status(400).send({ error: result.error });
        }
        return result;
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ── Sync to cloud ────────────────────────────────────────────────
  app.post(
    "/workspaces/:workspaceId/archives/sync",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const body = folderBody.parse(req.body);
      try {
        const result = await syncToCloud(workspaceId, body.path);
        if (!result.hasCloud) {
          return reply.status(400).send({ error: "No cloud storage skill installed" });
        }
        return { synced: result.synced, path: body.path };
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ── Move / rename ───────────────────────────────────────────────
  app.patch(
    "/workspaces/:workspaceId/archives/move",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const body = moveBody.parse(req.body);
      try {
        await moveArchiveItem(workspaceId, body.from, body.to);
        return { from: body.from, to: body.to };
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
