"use client";

import { useState, useMemo } from "react";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useWorkspace } from "@/lib/workspace-context";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { TaskTemplate, TaskPriority } from "@opcify/core";
import { TaskTemplateCard } from "@/components/task-hub/task-template-card";
import { TaskTemplateCategoryFilter } from "@/components/task-hub/task-template-category-filter";
import { TaskTemplatePreview } from "@/components/task-hub/task-template-preview";
import { UseTaskTemplateModal } from "@/components/task-hub/use-task-template-modal";
import { Toast } from "@/components/toast";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";

export default function TaskHubPage() {
  const router = useWorkspaceRouter();
  const { workspaceId } = useWorkspace();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
  } = useApi(
    () => api.taskTemplates.list(workspaceId, params),
    [workspaceId, search, category],
  );

  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);

  const agentMap = useMemo(() => {
    const m = new Map<string, string>();
    if (agents) {
      for (const a of agents) m.set(a.id, a.name);
    }
    return m;
  }, [agents]);

  const [previewTemplate, setPreviewTemplate] = useState<TaskTemplate | null>(null);
  const [useTemplate, setUseTemplate] = useState<TaskTemplate | null>(null);
  const [customizeTemplate, setCustomizeTemplate] = useState<TaskTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreateTask(data: {
    title: string;
    description: string;
    agentId: string;
    priority?: TaskPriority;
    attachments?: import("@opcify/core").ChatAttachment[];
    recurring?: import("@/components/tasks/task-create-modal").RecurringConfig;
  }) {
    const tpl = useTemplate ?? customizeTemplate;
    if (!tpl) return;
    setCreating(true);
    try {
      const task = await api.taskTemplates.createTask(workspaceId, tpl.id, data);

      // If recurring, also create the recurring rule and link it
      if (data.recurring) {
        const rule = await api.recurring.create(workspaceId, {
          title: data.title,
          frequency: data.recurring.frequency,
          interval: data.recurring.interval,
          dayOfWeek: data.recurring.dayOfWeek,
          dayOfMonth: data.recurring.dayOfMonth,
          hour: data.recurring.hour,
          minute: data.recurring.minute,
          startDate: data.recurring.startDate,
          agentId: data.agentId,
          presetData: {
            description: data.description || undefined,
            priority: data.priority,
          },
        });
        await api.tasks.update(workspaceId, task.id, { recurringRuleId: rule.id } as import("@opcify/core").UpdateTaskInput);
        setToastMessage("Recurring task created from template");
      }

      setUseTemplate(null);
      setCustomizeTemplate(null);
      router.push("/kanban");
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveAsTemplate(data: {
    name: string;
    category: string;
    description: string;
    suggestedAgentRoles: string[];
    defaultTitle: string;
    defaultDescription: string;
    defaultTags: string[];
  }) {
    setCreating(true);
    try {
      await api.taskTemplates.save(
        workspaceId,
        data as Parameters<typeof api.taskTemplates.save>[1],
      );
      setCustomizeTemplate(null);
      refetch();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(tpl: TaskTemplate) {
    try {
      await api.taskTemplates.delete(workspaceId, tpl.id);
      refetch();
      setToastMessage("Template deleted");
    } catch {
      setToastMessage("Failed to delete template");
    }
  }

  function handlePreviewToUse() {
    if (!previewTemplate) return;
    setPreviewTemplate(null);
    setUseTemplate(previewTemplate);
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            onClick={() => router.push("/kanban")}
            className="mb-2 inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Kanban
          </button>
          <h1 className="text-2xl font-bold tracking-tight">Task Template</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Reusable task templates — save successful tasks and create new ones faster
          </p>
        </div>
        <div className="hidden md:block"><UserProfileDropdown /></div>
      </div>

      <div className="mt-6 space-y-3">
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

        <TaskTemplateCategoryFilter value={category} onChange={setCategory} />
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
            <LayoutGrid className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-medium text-zinc-300">
            No templates found
          </h3>
          <p className="mt-1 max-w-xs text-center text-sm text-zinc-500">
            {search || category
              ? "Try adjusting your search or filter."
              : "Complete a task and save it as a template to build your library."}
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
            <TaskTemplateCard
              key={tpl.id}
              template={tpl}
              agentName={tpl.defaultAgentId ? agentMap.get(tpl.defaultAgentId) : undefined}
              onPreview={() => setPreviewTemplate(tpl)}
              onUse={() => setUseTemplate(tpl)}
              onCustomize={() => setCustomizeTemplate(tpl)}
              onDelete={!tpl.isBuiltIn ? () => handleDelete(tpl) : undefined}
            />
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <TaskTemplatePreview
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onUse={handlePreviewToUse}
        />
      )}

      {/* Use Template Modal */}
      {useTemplate && agents && (
        <UseTaskTemplateModal
          template={useTemplate}
          agents={agents}
          onClose={() => setUseTemplate(null)}
          onSubmit={handleCreateTask}
          submitting={creating}
        />
      )}

      {/* Customize Template Modal */}
      {customizeTemplate && agents && (
        <UseTaskTemplateModal
          template={customizeTemplate}
          agents={agents}
          onClose={() => setCustomizeTemplate(null)}
          onSubmit={handleCreateTask}
          onSaveAsTemplate={handleSaveAsTemplate}
          submitting={creating}
          customize
        />
      )}

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </>
  );
}
