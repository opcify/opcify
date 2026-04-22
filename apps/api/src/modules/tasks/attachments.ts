import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "../../workspace/WorkspaceConfig.js";

interface Attachment {
  type: "image" | "file";
  mediaType: string;
  fileName?: string;
  data: string;
}

/**
 * Save attachments to the workspace data dir and return the updated description
 * with file path references appended.
 */
export async function processAttachments(
  attachments: Attachment[],
  workspaceId: string,
  description?: string,
): Promise<string> {
  const uploadDir = join(getDataDir(workspaceId), "data", "task-uploads");
  await mkdir(uploadDir, { recursive: true });

  const filePaths: string[] = [];
  for (const att of attachments) {
    const ext =
      att.fileName?.split(".").pop() ||
      att.mediaType.split("/")[1] ||
      "bin";
    const baseName = att.fileName
      ? `${randomUUID().slice(0, 8)}-${att.fileName}`
      : `${randomUUID().slice(0, 8)}.${ext}`;
    await writeFile(join(uploadDir, baseName), Buffer.from(att.data, "base64"));
    filePaths.push(`/home/node/.openclaw/data/task-uploads/${baseName}`);
  }

  const fileBlock = [
    "",
    "---ATTACHED FILES---",
    ...filePaths.map((p) => `File path: ${p}`),
    "IMPORTANT: Read each file above using cat before starting this task.",
    "---END ATTACHED FILES---",
  ].join("\n");

  return description ? `${description}\n${fileBlock}` : fileBlock;
}
