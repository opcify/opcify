/**
 * Archives service — hybrid local + cloud file listing.
 *
 * The archives folder is a real directory on the workspace volume that both
 * the Opcify API and the OpenClaw agents read/write directly. When a cloud
 * storage provider (GCS/S3/R2) is configured, the service also queries the
 * cloud bucket and merges the results so the Archives page shows both local
 * and cloud-only files.
 *
 * Host path:      ~/.opcify/workspaces/{workspaceId}/data/archives/
 * Container path: /home/node/.openclaw/data/archives/
 */

import { readdir, stat, mkdir, rm, rename, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { getExecutor } from "../../runtime/executor.js";
import { getDataDir } from "../../workspace/WorkspaceConfig.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";

const log = createLogger("archives");

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function archivesRoot(workspaceId: string): string {
  return join(getDataDir(workspaceId), "data", "archives");
}

export function safePath(workspaceId: string, userPath: string): string {
  const root = archivesRoot(workspaceId);
  const clean = userPath.replace(/^\/+/, "");
  const resolved = resolve(root, clean);
  if (!resolved.startsWith(root)) {
    throw new PathTraversalError(userPath);
  }
  return resolved;
}

export class PathTraversalError extends Error {
  constructor(path: string) {
    super(`Path traversal blocked: ${path}`);
    this.name = "PathTraversalError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchiveItem {
  name: string;
  type: "file" | "folder";
  size: number | null;
  mtime: string;
  path: string;
  /** Where the file lives: local-only, cloud-only, or synced (both). */
  source: "local" | "cloud" | "synced";
}

interface CloudStorageConfig {
  provider: "gcs" | "s3" | "r2";
  // GCS
  gcsBucketName?: string;
  gcsCredentialsJson?: string;
  gcsPrefix?: string;
  // S3
  s3BucketName?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  s3Prefix?: string;
  // R2
  r2BucketName?: string;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2Prefix?: string;
  r2PublicDomain?: string;
}

// ---------------------------------------------------------------------------
// Cloud storage config from DB
// ---------------------------------------------------------------------------

export async function getCloudStorageConfig(
  workspaceId: string,
): Promise<CloudStorageConfig | null> {
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settingsJson: true },
    });
    if (!ws?.settingsJson) return null;
    const settings = JSON.parse(ws.settingsJson);
    const cs = settings.cloudStorage;
    if (!cs || cs.provider === "none") return null;
    return cs as CloudStorageConfig;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Container exec helper — runs commands inside the workspace gateway container
// via the runtime executor (docker exec or k8s exec). Provider-agnostic: any
// cloud storage skill the user installs has its Python packages + env vars
// already set up inside the container.
// ---------------------------------------------------------------------------

/**
 * Run a command inside the workspace's gateway container and return stdout.
 * Returns null if the container isn't reachable or the command exits non-zero.
 */
async function execInContainer(
  workspaceId: string,
  cmd: string[],
): Promise<string | null> {
  try {
    const { stdout, stderr, exitCode } = await getExecutor().exec(workspaceId, cmd);
    if (exitCode !== 0) {
      log.warn("Container exec non-zero exit", {
        workspaceId,
        cmd: cmd.join(" "),
        exitCode,
        output: (stderr || stdout).slice(0, 500),
      });
      return null;
    }
    return stdout;
  } catch (err) {
    log.warn("Container exec failed", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Detect which cloud storage skill is installed in the workspace container
 * by checking which skill directories exist at /home/node/.openclaw/skills/.
 * Returns the slug of the first cloud storage skill found, or null.
 */
const CLOUD_SKILL_SLUGS = ["google-cloud-storage", "amazon-s3-storage", "cloudflare-r2-storage"];

async function detectCloudSkill(workspaceId: string): Promise<string | null> {
  const output = await execInContainer(workspaceId, [
    "ls", "/home/node/.openclaw/skills/",
  ]);
  if (!output) return null;
  const dirs = output.trim().split(/\s+/);
  return CLOUD_SKILL_SLUGS.find((slug) => dirs.includes(slug)) || null;
}

// ---------------------------------------------------------------------------
// Cloud listing via docker exec (provider-agnostic)
// ---------------------------------------------------------------------------

/**
 * List objects from the cloud bucket by running the skill's list.py inside
 * the workspace container. Works for any cloud provider — GCS, S3, R2 — as
 * long as the skill is installed and env vars are configured.
 */
async function listCloudArchives(
  workspaceId: string,
  prefix: string,
): Promise<ArchiveItem[]> {
  const skillSlug = await detectCloudSkill(workspaceId);
  if (!skillSlug) return [];

  const scriptPath = `/home/node/.openclaw/skills/${skillSlug}/scripts/list.py`;
  const args = ["python3", scriptPath, "--json", "--limit", "500"];
  if (prefix) args.push("--prefix", prefix);

  const output = await execInContainer(workspaceId, args);
  if (!output) return [];

  try {
    const data = JSON.parse(output.trim());
    if (data.error) {
      log.warn("Cloud list returned error", { skillSlug, error: data.error });
      return [];
    }
    const fileItems = cloudObjectsToItems(data.items || [], prefix);
    // Shallow listing returns folders separately via delimiter. The skill's
    // list.py returns folder names relative to its configured root_prefix (the
    // bucket subpath), not relative to our current listing `prefix`. Strip the
    // listing prefix here so `name` is the leaf (e.g. "cmnysi..." inside
    // "tasks/") instead of the full key ("tasks/cmnysi..."), which otherwise
    // breaks the local+cloud merge in listArchives.
    const normalizedListingPrefix = prefix
      ? prefix.endsWith("/")
        ? prefix
        : `${prefix}/`
      : "";
    const folderItems: ArchiveItem[] = (data.folders || []).map(
      (f: { name: string }) => {
        const stripped = f.name.replace(/\/$/, "");
        const relative =
          normalizedListingPrefix && stripped.startsWith(normalizedListingPrefix)
            ? stripped.slice(normalizedListingPrefix.length)
            : stripped;
        const leaf = relative.split("/")[0] || stripped;
        return {
          name: leaf,
          type: "folder" as const,
          size: null,
          mtime: new Date().toISOString(),
          path: stripped,
          source: "cloud" as const,
        };
      },
    );
    // Dedupe by (type, path) — defensive in case the skill returns the same
    // folder both as a delimiter prefix and as nested file entries.
    const combined = [...folderItems, ...fileItems];
    const seen = new Set<string>();
    return combined.filter((item) => {
      const key = `${item.type}:${item.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (err) {
    log.warn("Cloud list JSON parse failed", {
      skillSlug,
      error: err instanceof Error ? err.message : String(err),
      output: output.slice(0, 300),
    });
    return [];
  }
}

/** Convert flat cloud object list into ArchiveItem[] at the current prefix level. */
function cloudObjectsToItems(
  objects: Array<{ name: string; size?: number | null; updated?: string }>,
  prefix: string,
): ArchiveItem[] {
  const items: ArchiveItem[] = [];
  const seenFolders = new Set<string>();
  const normalizedPrefix = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";

  for (const obj of objects) {
    if (!obj.name || obj.name.endsWith("/")) continue;

    const relativeName = normalizedPrefix && obj.name.startsWith(normalizedPrefix)
      ? obj.name.slice(normalizedPrefix.length)
      : obj.name;
    if (!relativeName) continue;

    const parts = relativeName.split("/");
    if (parts.length === 1) {
      items.push({
        name: parts[0],
        type: "file",
        size: obj.size ?? null,
        mtime: obj.updated || new Date().toISOString(),
        path: obj.name,
        source: "cloud",
      });
    } else if (parts.length > 1) {
      const folderName = parts[0];
      if (!seenFolders.has(folderName)) {
        seenFolders.add(folderName);
        items.push({
          name: folderName,
          type: "folder",
          size: null,
          mtime: obj.updated || new Date().toISOString(),
          path: normalizedPrefix ? `${normalizedPrefix}${folderName}` : folderName,
          source: "cloud",
        });
      }
    }
  }
  return items;
}

/**
 * Download a cloud-only file by running the skill's download.py inside
 * the workspace container, then copying the result out.
 * Returns a local temp file path, or null on failure.
 */
export async function downloadCloudFile(
  workspaceId: string,
  remotePath: string,
): Promise<string | null> {
  const skillSlug = await detectCloudSkill(workspaceId);
  if (!skillSlug) return null;

  // Download to a temp path inside the container
  const containerTmp = `/tmp/opcify-dl-${randomUUID().slice(0, 8)}-${basename(remotePath)}`;
  const scriptPath = `/home/node/.openclaw/skills/${skillSlug}/scripts/download.py`;
  const output = await execInContainer(workspaceId, [
    "python3", scriptPath,
    "--remote-path", remotePath,
    "--local-path", containerTmp,
    "--json",
  ]);
  if (!output) return null;

  // The file now exists inside the container at containerTmp.
  // Copy it to the host via the workspace volume's data dir.
  // Since /home/node/.openclaw/ is bind-mounted from the host's workspace data dir,
  // we can access the file at {dataDir}/{containerTmp path relative to /home/node/.openclaw/}.
  // But /tmp is NOT bind-mounted. So instead, download to a bind-mounted path.

  // Re-download to a path under /home/node/.openclaw/data/ (which IS bind-mounted)
  const bindMountedPath = `/home/node/.openclaw/data/archives/.cloud-downloads/${randomUUID().slice(0, 8)}-${basename(remotePath)}`;
  await execInContainer(workspaceId, [
    "bash", "-c", `mkdir -p /home/node/.openclaw/data/archives/.cloud-downloads && cp ${containerTmp} ${bindMountedPath} && rm -f ${containerTmp}`,
  ]);

  // Map the container path to the host path
  const hostPath = join(getDataDir(workspaceId), "data", "archives", ".cloud-downloads", basename(bindMountedPath));
  try {
    await stat(hostPath);
    return hostPath;
  } catch {
    log.warn("Cloud download file not found on host after docker exec", { hostPath });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local + cloud merge
// ---------------------------------------------------------------------------

/**
 * List local files, then merge with cloud objects if a cloud provider is configured.
 */
export async function listArchives(
  workspaceId: string,
  relativePath: string = "",
): Promise<ArchiveItem[]> {
  // 1. Local listing
  const localItems = await listLocalArchives(workspaceId, relativePath);

  // 2. Cloud listing (auto-detected from installed cloud storage skills)
  const cloudItems = await listCloudArchives(workspaceId, relativePath);
  if (cloudItems.length === 0) {
    return localItems;
  }

  // 3. Merge: match by name + type
  const localByName = new Map(localItems.map((i) => [`${i.type}:${i.name}`, i]));
  const merged: ArchiveItem[] = [];

  // Start with local items, upgrade to "synced" if also in cloud
  for (const local of localItems) {
    const inCloud = cloudItems.some((c) => c.type === local.type && c.name === local.name);
    merged.push({ ...local, source: inCloud ? "synced" : "local" });
  }

  // Add cloud-only items
  for (const cloud of cloudItems) {
    const key = `${cloud.type}:${cloud.name}`;
    if (!localByName.has(key)) {
      merged.push(cloud);
    }
  }

  // Sort: folders first, then alphabetical
  merged.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return merged;
}

// ---------------------------------------------------------------------------
// Pure local operations (unchanged from original)
// ---------------------------------------------------------------------------

async function listLocalArchives(
  workspaceId: string,
  relativePath: string = "",
): Promise<ArchiveItem[]> {
  const dir = safePath(workspaceId, relativePath || ".");
  const root = archivesRoot(workspaceId);

  await mkdir(dir, { recursive: true });

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const items: ArchiveItem[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const fullPath = join(dir, name);
    try {
      const s = await stat(fullPath);
      const relPath = fullPath.slice(root.length + 1);
      items.push({
        name,
        type: s.isDirectory() ? "folder" : "file",
        size: s.isDirectory() ? null : s.size,
        mtime: s.mtime.toISOString(),
        path: relPath,
        source: "local",
      });
    } catch {
      // skip entries we can't stat
    }
  }

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

export async function ensureArchivesDir(workspaceId: string): Promise<void> {
  await mkdir(archivesRoot(workspaceId), { recursive: true });
}

export async function createFolder(
  workspaceId: string,
  relativePath: string,
): Promise<void> {
  const dir = safePath(workspaceId, relativePath);
  await mkdir(dir, { recursive: true });
  log.info("Created archives folder", { workspaceId, path: relativePath });
}

// ---------------------------------------------------------------------------
// Cloud sync helpers (fire-and-forget after local operations succeed)
// ---------------------------------------------------------------------------

async function cloudUpload(
  workspaceId: string,
  localContainerPath: string,
  remotePath: string,
): Promise<void> {
  const skillSlug = await detectCloudSkill(workspaceId);
  if (!skillSlug) return;
  const scriptPath = `/home/node/.openclaw/skills/${skillSlug}/scripts/upload.py`;
  await execInContainer(workspaceId, [
    "python3", scriptPath, localContainerPath, "--remote-path", remotePath, "--json",
  ]);
  log.info("Cloud upload synced", { workspaceId, remotePath, skill: skillSlug });
}

async function cloudDelete(
  workspaceId: string,
  remotePath: string,
): Promise<void> {
  const skillSlug = await detectCloudSkill(workspaceId);
  if (!skillSlug) return;

  const deleteScript = `/home/node/.openclaw/skills/${skillSlug}/scripts/delete.py`;
  const listScript = `/home/node/.openclaw/skills/${skillSlug}/scripts/list.py`;

  // List all objects under this prefix (handles folder deletion — cloud storage
  // is flat, so deleting a "folder" means deleting every object with that prefix).
  const prefix = remotePath.endsWith("/") ? remotePath : `${remotePath}/`;
  const listOutput = await execInContainer(workspaceId, [
    "python3", listScript, "--prefix", prefix, "--limit", "500", "--json",
  ]);

  const objectsToDelete: string[] = [];
  if (listOutput) {
    try {
      const data = JSON.parse(listOutput.trim());
      for (const item of data.items || []) {
        if (item.name) objectsToDelete.push(item.name);
      }
    } catch {
      // parse failed — fall through to single-object delete
    }
  }

  // Also try deleting the exact path (could be a file, or a folder-marker object)
  objectsToDelete.push(remotePath);

  // Deduplicate and delete each object
  const unique = [...new Set(objectsToDelete)];
  for (const obj of unique) {
    await execInContainer(workspaceId, [
      "python3", deleteScript, "--remote-path", obj, "--json",
    ]);
  }

  log.info("Cloud delete synced", {
    workspaceId,
    remotePath,
    objectsDeleted: unique.length,
    skill: skillSlug,
  });
}

async function cloudMove(
  workspaceId: string,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const skillSlug = await detectCloudSkill(workspaceId);
  if (!skillSlug) return;

  const moveScript = `/home/node/.openclaw/skills/${skillSlug}/scripts/move.py`;
  const listScript = `/home/node/.openclaw/skills/${skillSlug}/scripts/list.py`;

  // Check if this is a folder rename — list objects under the fromPath/ prefix.
  // Cloud storage has no real folders, so "rename folder" means moving every
  // object whose key starts with "oldName/" to "newName/".
  const prefix = fromPath.endsWith("/") ? fromPath : `${fromPath}/`;
  const listOutput = await execInContainer(workspaceId, [
    "python3", listScript, "--prefix", prefix, "--limit", "500", "--json",
  ]);

  const children: string[] = [];
  if (listOutput) {
    try {
      const data = JSON.parse(listOutput.trim());
      for (const item of data.items || []) {
        if (item.name) children.push(item.name as string);
      }
    } catch {
      // parse failed — treat as single file
    }
  }

  if (children.length > 0) {
    // Folder rename: move each child from oldPrefix/* to newPrefix/*
    const toPrefix = toPath.endsWith("/") ? toPath : `${toPath}/`;
    for (const child of children) {
      const suffix = child.startsWith(prefix) ? child.slice(prefix.length) : child;
      const newChild = `${toPrefix}${suffix}`;
      await execInContainer(workspaceId, [
        "python3", moveScript, "--from-path", child, "--to-path", newChild, "--json",
      ]);
    }
    log.info("Cloud folder move synced", {
      workspaceId, from: fromPath, to: toPath, objectsMoved: children.length, skill: skillSlug,
    });
  } else {
    // Single file rename
    await execInContainer(workspaceId, [
      "python3", moveScript, "--from-path", fromPath, "--to-path", toPath, "--json",
    ]);
    log.info("Cloud file move synced", { workspaceId, from: fromPath, to: toPath, skill: skillSlug });
  }
}

// ---------------------------------------------------------------------------
// Write operations (local-first, then cloud sync)
// ---------------------------------------------------------------------------

export async function saveFiles(
  workspaceId: string,
  targetDir: string,
  files: Array<{ fileName: string; data: string }>,
): Promise<string[]> {
  const dir = safePath(workspaceId, targetDir || ".");
  await mkdir(dir, { recursive: true });

  const savedPaths: string[] = [];
  const root = archivesRoot(workspaceId);

  for (const file of files) {
    const safeName = basename(file.fileName).replace(/[/\\]/g, "_");
    const uniqueName = `${randomUUID().slice(0, 8)}-${safeName}`;
    const fullPath = join(dir, uniqueName);
    await writeFile(fullPath, Buffer.from(file.data, "base64"));
    const relPath = fullPath.slice(root.length + 1);
    savedPaths.push(relPath);

    // Sync to cloud: the local file is at {dataDir}/data/archives/{relPath}
    // which is bind-mounted inside the container at /home/node/.openclaw/data/archives/{relPath}
    const containerPath = `/home/node/.openclaw/data/archives/${relPath}`;
    cloudUpload(workspaceId, containerPath, relPath).catch((err) => {
      log.warn("Cloud upload sync failed (non-blocking)", {
        workspaceId,
        path: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  log.info("Saved files to archives", { workspaceId, targetDir, count: files.length });
  return savedPaths;
}

export async function deleteArchiveItem(
  workspaceId: string,
  relativePath: string,
): Promise<void> {
  // Delete locally (ignore errors — file may be cloud-only)
  try {
    const fullPath = safePath(workspaceId, relativePath);
    await rm(fullPath, { recursive: true, force: true });
  } catch {
    // cloud-only file — no local copy to delete
  }

  // Delete from cloud too
  cloudDelete(workspaceId, relativePath).catch((err) => {
    log.warn("Cloud delete sync failed (non-blocking)", {
      workspaceId,
      path: relativePath,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  log.info("Deleted archive item", { workspaceId, path: relativePath });
}

export async function moveArchiveItem(
  workspaceId: string,
  fromPath: string,
  toPath: string,
): Promise<void> {
  // Move locally (ignore errors — file may be cloud-only)
  try {
    const src = safePath(workspaceId, fromPath);
    const dest = safePath(workspaceId, toPath);
    await mkdir(dirname(dest), { recursive: true });
    await rename(src, dest);
  } catch {
    // cloud-only file — no local copy to move
  }

  // Move in cloud too
  cloudMove(workspaceId, fromPath, toPath).catch((err) => {
    log.warn("Cloud move sync failed (non-blocking)", {
      workspaceId,
      from: fromPath,
      to: toPath,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  log.info("Moved archive item", { workspaceId, from: fromPath, to: toPath });
}

/**
 * Sync a local file or folder to cloud storage (blocking — waits for completion).
 * For files: uploads the single file. For folders: uploads all files recursively.
 * Returns the number of objects uploaded and whether cloud storage is configured.
 */
export async function syncToCloud(
  workspaceId: string,
  relativePath: string,
): Promise<{ synced: number; hasCloud: boolean }> {
  const skillSlug = await detectCloudSkill(workspaceId);
  if (!skillSlug) return { synced: 0, hasCloud: false };

  const root = archivesRoot(workspaceId);
  const fullPath = safePath(workspaceId, relativePath);
  let synced = 0;

  try {
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      // Recursively upload all files in the folder
      const files = await collectLocalFiles(fullPath, root);
      for (const relPath of files) {
        const containerPath = `/home/node/.openclaw/data/archives/${relPath}`;
        await cloudUpload(workspaceId, containerPath, relPath);
        synced++;
      }
    } else {
      const containerPath = `/home/node/.openclaw/data/archives/${relativePath}`;
      await cloudUpload(workspaceId, containerPath, relativePath);
      synced = 1;
    }
  } catch (err) {
    log.warn("Sync to cloud failed", {
      workspaceId,
      path: relativePath,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { synced, hasCloud: true };
}

/**
 * Generate a time-limited shareable URL for a cloud-stored file.
 * Runs the skill's signed_url.py (GCS) or presigned_url.py (S3/R2) via docker exec.
 * If the file is local-only, syncs it to cloud first, then generates the link.
 */
export async function generateShareLink(
  workspaceId: string,
  relativePath: string,
  expirySeconds: number = 604800, // 7 days default
): Promise<{ url: string; expirySeconds: number } | { error: string }> {
  const skillSlug = await detectCloudSkill(workspaceId);
  if (!skillSlug) {
    return { error: "No cloud storage skill installed. Enable Google Cloud Storage, Amazon S3, or Cloudflare R2 from the Skills page." };
  }

  // Ensure the file is in the cloud — sync first if it's local-only
  const localPath = safePath(workspaceId, relativePath);
  try {
    const s = await stat(localPath);
    if (!s.isDirectory()) {
      const containerPath = `/home/node/.openclaw/data/archives/${relativePath}`;
      await cloudUpload(workspaceId, containerPath, relativePath);
    }
  } catch {
    // File may be cloud-only already — that's fine
  }

  // GCS uses signed_url.py, S3/R2 use presigned_url.py
  const scriptName = skillSlug === "google-cloud-storage" ? "signed_url.py" : "presigned_url.py";
  const scriptPath = `/home/node/.openclaw/skills/${skillSlug}/scripts/${scriptName}`;

  const output = await execInContainer(workspaceId, [
    "python3", scriptPath,
    "--remote-path", relativePath,
    "--expiry", String(expirySeconds),
    "--json",
  ]);

  if (!output) {
    return { error: "Failed to generate signed URL — container may not be running" };
  }

  try {
    const data = JSON.parse(output.trim());
    if (data.error) {
      return { error: `Cloud error: ${data.error}` };
    }
    const url = data.url || data.public_url;
    if (!url) {
      return { error: "No URL returned from cloud provider" };
    }
    return { url, expirySeconds };
  } catch {
    return { error: "Failed to parse cloud response" };
  }
}

/** Recursively collect all file paths under a directory (relative to root). */
async function collectLocalFiles(dir: string, root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir);
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      results.push(...await collectLocalFiles(full, root));
    } else {
      results.push(full.slice(root.length + 1));
    }
  }
  return results;
}

/**
 * Get a readable stream for a local file. For cloud-only files, use
 * downloadCloudFile() first to fetch to a temp path, then stream that.
 */
export async function getFileStream(
  workspaceId: string,
  relativePath: string,
): Promise<{ stream: ReturnType<typeof createReadStream>; size: number; name: string }> {
  const fullPath = safePath(workspaceId, relativePath);

  // Try local first
  try {
    const s = await stat(fullPath);
    if (s.isDirectory()) throw new Error("Cannot download a directory");
    return {
      stream: createReadStream(fullPath),
      size: s.size,
      name: basename(fullPath),
    };
  } catch {
    // Not local — try cloud download via docker exec
  }

  const tmpPath = await downloadCloudFile(workspaceId, relativePath);
  if (tmpPath) {
    const s = await stat(tmpPath);
    return {
      stream: createReadStream(tmpPath),
      size: s.size,
      name: basename(relativePath),
    };
  }

  throw new Error(`File not found: ${relativePath}`);
}
