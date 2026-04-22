import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Minimal frontmatter parser for template markdown files.
 * Handles strings, booleans, and JSON arrays (e.g. ["a", "b"]).
 */
export function parseFrontmatter(raw: string): {
  meta: Record<string, string | boolean | string[]>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };

  const meta: Record<string, string | boolean | string[]> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (val === "true") meta[key] = true;
    else if (val === "false") meta[key] = false;
    else if (val.startsWith("[")) meta[key] = JSON.parse(val) as string[];
    else meta[key] = val;
  }

  return { meta, content: match[2] };
}

/**
 * Parse SKILL.md frontmatter — handles multiline descriptions and nested metadata.
 */
export function parseSkillFrontmatter(raw: string): {
  name: string;
  description: string;
  version: string;
  category: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: "", description: "", version: "", category: "" };
  const block = match[1];

  // name (simple single-line)
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";

  // description — single-line quoted, single-line unquoted, or multiline (> / |)
  let description = "";
  const descQuoted = block.match(/^description:\s*"([^"]+)"$/m);
  if (descQuoted) {
    description = descQuoted[1].trim();
  } else {
    const descMulti = block.match(
      /^description:\s*[>|]-?\s*\n((?:[ \t]+.+\n?)+)/m,
    );
    if (descMulti) {
      description = descMulti[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ");
    } else {
      const descPlain = block.match(/^description:\s*(?!>|[|])(.+)$/m);
      if (descPlain) description = descPlain[1].trim();
    }
  }

  // metadata.version and metadata.category (indented under metadata:)
  const versionMatch = block.match(/^\s+version:\s*"?([^"\n]+)"?$/m);
  const version = versionMatch?.[1]?.trim() ?? "1.0";

  const categoryMatch = block.match(/^\s+category:\s*(.+)$/m);
  const category = categoryMatch?.[1]?.trim() ?? "";

  return { name, description, version, category };
}

/** Find the project root by walking up until we find the templates/ directory. */
export function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "templates"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Could not find project root (templates/ directory)");
}

/** Read a file as UTF-8, returning empty string if missing. */
export function readMd(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
