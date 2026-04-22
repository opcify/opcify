"use client";

import { useState, useMemo } from "react";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useWorkspace } from "@/lib/workspace-context";
import { Bot } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { AgentTemplate, AgentTemplateDetail } from "@opcify/core";
import { TemplateCard } from "@/components/agents-hub/template-card";
import { TemplateCategoryFilter } from "@/components/agents-hub/template-category-filter";
import { TemplatePreviewModal } from "@/components/agents-hub/template-preview-modal";
import { UseTemplateModal } from "@/components/agents-hub/use-template-modal";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";

export default function AgentsHubPage() {
  const router = useWorkspaceRouter();
  const { workspaceId } = useWorkspace();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (search) p.q = search;
    if (category) p.category = category;
    return Object.keys(p).length > 0 ? p : undefined;
  }, [search, category]);

  const {
    data: templates,
    loading,
    error,
    refetch,
  } = useApi(() => api.templates.list(params), [search, category]);

  const [previewTemplate, setPreviewTemplate] = useState<AgentTemplateDetail | null>(null);
  const [useTemplate, setUseTemplate] = useState<AgentTemplateDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function loadTemplateDetail(
    tpl: AgentTemplate,
    target: "preview" | "use",
  ) {
    setLoadingDetail(tpl.id);
    try {
      const detail = await api.templates.get(tpl.id);
      if (target === "preview") {
        setPreviewTemplate(detail);
      } else {
        setUseTemplate(detail);
      }
    } finally {
      setLoadingDetail(null);
    }
  }

  async function handleCreateAgent(data: {
    name: string;
    description: string;
    model: string;
    skillIds: string[];
    responsibilitiesSummary: string;
    soul: string;
    agentConfig: string;
    identity: string;
    tools: string;
    user: string;
    heartbeat: string;
    bootstrap: string;
  }) {
    if (!useTemplate) return;
    setCreating(true);
    setCreateError(null);
    try {
      const agent = await api.templates.createAgent(useTemplate.id, { ...data, workspaceId });
      setUseTemplate(null);
      router.push(`/agents/${agent.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create agent";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }

  function handlePreviewToUse() {
    if (!previewTemplate) return;
    setPreviewTemplate(null);
    setUseTemplate(previewTemplate);
  }

  return (
    <>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents Hub</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Ready-made agent templates to get you started quickly
          </p>
        </div>
        <div className="hidden md:block"><UserProfileDropdown /></div>
      </div>

      {/* Toolbar */}
      <div className="mt-6 space-y-3">
        {/* Search */}
        <div className="relative max-w-md">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1 0 5.65 5.65a7.5 7.5 0 0 0 10.6 10.6z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-700 focus:ring-0"
          />
        </div>

        {/* Category filter */}
        <TemplateCategoryFilter value={category} onChange={setCategory} />
      </div>

      {/* Loading */}
      {loading && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900 p-5"
            >
              <div className="h-5 w-32 rounded bg-zinc-800" />
              <div className="mt-2 flex gap-2">
                <div className="h-4 w-16 rounded-full bg-zinc-800" />
                <div className="h-4 w-20 rounded bg-zinc-800" />
              </div>
              <div className="mt-3 space-y-1.5">
                <div className="h-3 w-full rounded bg-zinc-800" />
                <div className="h-3 w-3/4 rounded bg-zinc-800" />
                <div className="h-3 w-1/2 rounded bg-zinc-800" />
              </div>
              <div className="mt-4 flex gap-2">
                <div className="h-7 w-24 rounded-lg bg-zinc-800" />
                <div className="h-7 w-16 rounded-lg bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 py-16">
          <p className="text-sm text-red-400">Failed to load templates</p>
          <p className="mt-1 text-xs text-zinc-500">{error}</p>
          <button
            onClick={refetch}
            className="mt-3 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && templates && templates.length === 0 && (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 py-16">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-zinc-500">
            <Bot className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-medium text-zinc-300">
            No templates found
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            {search || category
              ? "Try adjusting your search or filter."
              : "No templates available yet."}
          </p>
          {(search || category) && (
            <button
              onClick={() => {
                setSearch("");
                setCategory("");
              }}
              className="mt-3 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {!loading && !error && templates && templates.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              onPreview={() => loadTemplateDetail(tpl, "preview")}
              onUse={() => loadTemplateDetail(tpl, "use")}
            />
          ))}
        </div>
      )}

      {/* Loading indicator for detail fetch */}
      {loadingDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-4 shadow-xl">
            <p className="text-sm text-zinc-300">Loading template…</p>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <TemplatePreviewModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onUse={handlePreviewToUse}
        />
      )}

      {/* Use Template Modal */}
      {useTemplate && (
        <UseTemplateModal
          template={useTemplate}
          workspaceId={workspaceId}
          onClose={() => { setUseTemplate(null); setCreateError(null); }}
          onSubmit={handleCreateAgent}
          submitting={creating}
          error={createError}
        />
      )}
    </>
  );
}
