import type { AgentTokenUsage } from "@opcify/core";
import { chatService } from "../chat/service.js";
import { createLogger } from "../../logger.js";

const log = createLogger("openclaw-usage");

// ─── Cache ──────────────────────────────────────────────────────────

interface SessionUsage {
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface CachedUsage {
  data: Map<string, SessionUsage>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CachedUsage>();

// ─── Fetch via gateway WebSocket RPC ────────────────────────────────

function extractAgentSlug(key: string): string | null {
  // Session keys follow the pattern "agent:{slug}:{scope}"
  if (!key.startsWith("agent:")) return null;
  const parts = key.split(":");
  return parts.length >= 2 ? parts[1] : null;
}

async function fetchSessionsFromGateway(workspaceId: string): Promise<Map<string, SessionUsage>> {
  const cached = cache.get(workspaceId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const client = await chatService.getClient(workspaceId);
    const result = await client.request<{
      sessions?: {
        key?: string;
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      }[];
    }>("sessions.list", {});

    const map = new Map<string, SessionUsage>();
    for (const s of result?.sessions ?? []) {
      const agentId = s.key ? extractAgentSlug(s.key) : null;
      if (!agentId) continue;

      const existing = map.get(agentId);
      if (existing) {
        existing.inputTokens += s.inputTokens ?? 0;
        existing.outputTokens += s.outputTokens ?? 0;
        existing.totalTokens += s.totalTokens ?? 0;
      } else {
        map.set(agentId, {
          agentId,
          inputTokens: s.inputTokens ?? 0,
          outputTokens: s.outputTokens ?? 0,
          totalTokens: s.totalTokens ?? 0,
        });
      }
    }

    cache.set(workspaceId, { data: map, fetchedAt: Date.now() });
    return map;
  } catch (err) {
    log.warn("Failed to fetch token usage from gateway", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return cache.get(workspaceId)?.data ?? new Map();
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export async function fetchAgentTokenUsage(
  workspaceId: string,
  agentName: string,
): Promise<AgentTokenUsage> {
  const sessions = await fetchSessionsFromGateway(workspaceId);
  const slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const usage = sessions.get(slug);
  const total = usage?.totalTokens ?? 0;

  return {
    today: total,
    week: total,
    total,
    daily: [],
  };
}
