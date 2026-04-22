import { randomUUID } from "node:crypto";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "../../workspace/WorkspaceConfig.js";

export interface EmailAttachmentInput {
  type?: "image" | "file";
  mediaType: string;
  fileName: string;
  data: string; // base64
}

export interface EmailAttachmentMeta {
  path: string;
  fileName: string;
  mediaType: string;
  size: number;
}

function attachmentDir(workspaceId: string, draftId: string): string {
  return join(getDataDir(workspaceId), "data", "email-attachments", draftId);
}

/**
 * Persist a base64-encoded attachment to the per-draft directory and return
 * its metadata. Used by `POST /inbox/drafts/:id/attachments`.
 */
export async function saveDraftAttachment(
  workspaceId: string,
  draftId: string,
  att: EmailAttachmentInput,
): Promise<EmailAttachmentMeta> {
  const dir = attachmentDir(workspaceId, draftId);
  await mkdir(dir, { recursive: true });

  const safeName = att.fileName.replace(/[^\w.-]+/g, "_") || "file";
  const baseName = `${randomUUID().slice(0, 8)}-${safeName}`;
  const buf = Buffer.from(att.data, "base64");
  await writeFile(join(dir, baseName), buf);

  // Path passed to the agent inside the OpenClaw container.
  const containerPath = `/home/node/.openclaw/data/email-attachments/${draftId}/${baseName}`;

  return {
    path: containerPath,
    fileName: att.fileName,
    mediaType: att.mediaType,
    size: buf.byteLength,
  };
}

/**
 * Remove the on-disk directory for a draft's attachments. Best-effort —
 * silently ignores missing dirs so it's safe to call after compose.
 */
export async function removeDraftAttachments(
  workspaceId: string,
  draftId: string,
): Promise<void> {
  const dir = attachmentDir(workspaceId, draftId);
  await rm(dir, { recursive: true, force: true });
}
