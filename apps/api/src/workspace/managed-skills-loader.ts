/**
 * Managed-skill registry loader.
 *
 * Scans `templates/skills/<slug>/_meta.json` at startup, picks up every entry
 * with a `managed` block, and exposes a typed in-memory registry. Adding a new
 * Opcify-managed skill is therefore zero-code: drop a folder under
 * `templates/skills/<slug>/` containing a `SKILL.md` and a `_meta.json` with a
 * `managed` block, restart the API, and it shows up everywhere — the setup
 * wizard, the post-creation Skills page, the disk-copy provisioner, the install
 * loop in provisioner.ts, and listManagedSkills().
 *
 * `_meta.json` schema (additive — existing fields stay):
 *
 *   {
 *     "ownerId": "...",
 *     "slug": "yahoo-finance",
 *     "version": "2.0.0",
 *     "publishedAt": 1769694296993,
 *     "managed": {
 *       "tier": "general" | "template-scoped",
 *       "templateScopes": ["investing_trading_firm"],   // template-scoped only
 *       "alwaysOn": false,                              // default false
 *       "label": "Yahoo Finance",
 *       "emoji": "📈",
 *       "description": "..."                            // optional, falls back to SKILL.md
 *     }
 *   }
 *
 * Skills without a `managed` block (or without `_meta.json`) are silently
 * ignored — they may exist for other reasons (experiments, ClawHub mirrors).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getSkillsSourceDir } from "./WorkspaceConfig.js";
import { createLogger } from "../logger.js";

const log = createLogger("managed-skills-loader");

export type ManagedSkillTier = "general" | "template-scoped";

export interface ManagedSkillManifest {
  /** Unique slug — must match the directory name under templates/skills/. */
  slug: string;
  /** Setup-wizard tier — see constants above. */
  tier: ManagedSkillTier;
  /** Template keys this skill is scoped to (template-scoped tier only). */
  templateScopes: string[];
  /** Always-on skills are rendered as disabled checkboxes in the setup wizard. */
  alwaysOn: boolean;
  /** Display label for the wizard / Skills page. */
  label: string;
  /** Optional emoji for the wizard / Skills page. */
  emoji?: string;
  /** Description for the wizard / Skills page. */
  description: string;
  /** Skill version from _meta.json. */
  version: string;
}

interface RawMetaJson {
  ownerId?: string;
  slug?: string;
  version?: string;
  publishedAt?: number;
  managed?: {
    tier?: string;
    templateScopes?: unknown;
    alwaysOn?: unknown;
    label?: unknown;
    emoji?: unknown;
    description?: unknown;
  };
}

let cache: ManagedSkillManifest[] | null = null;

/**
 * Load every managed skill manifest from `templates/skills/`. Cached for the
 * lifetime of the process — restart the API to pick up new skills.
 */
export function loadManagedSkillRegistry(): ManagedSkillManifest[] {
  if (cache !== null) return cache;
  cache = scan();
  return cache;
}

/** Force a re-scan on the next call. Useful for tests. */
export function invalidateManagedSkillRegistry(): void {
  cache = null;
}

function scan(): ManagedSkillManifest[] {
  const root = getSkillsSourceDir();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (err) {
    log.warn(
      `Could not read skills source directory at ${root}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const manifests: ManagedSkillManifest[] = [];
  for (const slug of entries) {
    const dir = join(root, slug);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const metaPath = join(dir, "_meta.json");
    let raw: RawMetaJson;
    try {
      raw = JSON.parse(readFileSync(metaPath, "utf-8"));
    } catch {
      // No _meta.json — skill is not managed by Opcify, skip silently.
      continue;
    }

    if (!raw.managed) continue;
    const m = raw.managed;

    // Validate tier
    const tier: ManagedSkillTier =
      m.tier === "template-scoped" ? "template-scoped" : "general";

    const templateScopes = Array.isArray(m.templateScopes)
      ? m.templateScopes.filter((s): s is string => typeof s === "string")
      : [];

    if (tier === "template-scoped" && templateScopes.length === 0) {
      log.warn(
        `Skill "${slug}" is template-scoped but declares no templateScopes; skipping.`,
      );
      continue;
    }

    const label = typeof m.label === "string" && m.label.trim() ? m.label : slug;
    const emoji = typeof m.emoji === "string" ? m.emoji : undefined;
    const description = typeof m.description === "string" ? m.description : "";
    const alwaysOn = m.alwaysOn === true;

    manifests.push({
      slug: raw.slug || slug,
      tier,
      templateScopes,
      alwaysOn,
      label,
      emoji,
      description,
      version: raw.version || "0.0.0",
    });
  }

  // Stable order: alwaysOn general first, then general, then template-scoped,
  // then alpha by slug. Makes the wizard rendering deterministic.
  manifests.sort((a, b) => {
    if (a.alwaysOn !== b.alwaysOn) return a.alwaysOn ? -1 : 1;
    if (a.tier !== b.tier) return a.tier === "general" ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });

  log.info(
    `Loaded ${manifests.length} managed skill manifest(s) from ${root}: ${manifests.map((m) => m.slug).join(", ")}`,
  );
  return manifests;
}

// ─── Convenience accessors ──────────────────────────────────────────

export function getManagedSkillKeys(): string[] {
  return loadManagedSkillRegistry().map((m) => m.slug);
}

export function getAlwaysOnManagedSkillKeys(): string[] {
  return loadManagedSkillRegistry()
    .filter((m) => m.alwaysOn)
    .map((m) => m.slug);
}

export function getGeneralManagedSkillKeys(): string[] {
  return loadManagedSkillRegistry()
    .filter((m) => m.tier === "general")
    .map((m) => m.slug);
}

export function getTemplateScopedManagedSkillKeys(templateKey: string): string[] {
  return loadManagedSkillRegistry()
    .filter((m) => m.tier === "template-scoped" && m.templateScopes.includes(templateKey))
    .map((m) => m.slug);
}

export function getManagedSkillManifest(slug: string): ManagedSkillManifest | undefined {
  return loadManagedSkillRegistry().find((m) => m.slug === slug);
}

export function isManagedSkill(slug: string): boolean {
  return loadManagedSkillRegistry().some((m) => m.slug === slug);
}
