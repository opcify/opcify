"use client";

import { useState, useCallback } from "react";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useWorkspace } from "@/lib/workspace-context";
import type { TaskPriority, AgentSummary } from "@opcify/core";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface TaskItem {
  title: string;
  description: string;
  priority: TaskPriority;
  agentId: string;
  selected: boolean;
}

interface CreateTaskGroupModalProps {
  sourceTaskId: string;
  sourceTaskTitle: string;
  onClose: () => void;
}

function parseDecompositionItems(resultContent: string | null): TaskItem[] {
  if (!resultContent) return [];

  try {
    const parsed = JSON.parse(resultContent);
    if (Array.isArray(parsed)) {
      return parsed.map((item: Record<string, unknown>) => ({
        title: String(item.title ?? ""),
        description: String(item.description ?? ""),
        priority: (item.priority as TaskPriority) ?? "medium",
        agentId: String(item.agentId ?? ""),
        selected: true,
      }));
    }
  } catch {
    // not JSON — parse line-by-line as fallback
  }

  const lines = resultContent
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length > 0);

  return lines.map((line) => ({
    title: line,
    description: "",
    priority: "medium" as TaskPriority,
    agentId: "",
    selected: true,
  }));
}

export function CreateTaskGroupModal({
  sourceTaskId,
  sourceTaskTitle,
  onClose,
}: CreateTaskGroupModalProps) {
  const router = useWorkspaceRouter();
  const { workspaceId } = useWorkspace();
  const { data: task } = useApi(
    () => api.tasks.get(workspaceId, sourceTaskId),
    [workspaceId, sourceTaskId],
  );
  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialItems = task ? parseDecompositionItems(task.resultContent) : [];
  const [items, setItems] = useState<TaskItem[]>(initialItems);
  const [initialized, setInitialized] = useState(false);

  if (task && !initialized && items.length === 0) {
    const parsed = parseDecompositionItems(task.resultContent);
    if (parsed.length > 0) {
      setItems(parsed);
    } else {
      setItems([{
        title: "",
        description: "",
        priority: "medium",
        agentId: agents?.[0]?.id ?? "",
        selected: true,
      }]);
    }
    setInitialized(true);
  }

  const defaultAgentId = agents?.[0]?.id ?? "";

  const toggleItem = useCallback((idx: number) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === idx ? { ...item, selected: !item.selected } : item,
      ),
    );
  }, []);

  const updateItem = useCallback(
    (idx: number, field: keyof TaskItem, value: string | boolean) => {
      setItems((prev) =>
        prev.map((item, i) =>
          i === idx ? { ...item, [field]: value } : item,
        ),
      );
    },
    [],
  );

  const addItem = useCallback(() => {
    setItems((prev) => [
      ...prev,
      {
        title: "",
        description: "",
        priority: "medium" as TaskPriority,
        agentId: defaultAgentId,
        selected: true,
      },
    ]);
  }, [defaultAgentId]);

  const removeItem = useCallback((idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const selectedItems = items.filter((item) => item.selected && item.title.trim());
  const selectedCount = selectedItems.length;

  const handleCreate = useCallback(async () => {
    if (selectedCount === 0 || creating) return;

    const invalidItems = selectedItems.filter((item) => !item.agentId);
    if (invalidItems.length > 0) {
      setError("Please assign an agent to all selected tasks");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const result = await api.taskGroups.createFromDecomposition(
        workspaceId,
        sourceTaskId,
        {
          tasks: selectedItems.map((item) => ({
            title: item.title.trim(),
            description: item.description.trim() || undefined,
            priority: item.priority,
            agentId: item.agentId,
          })),
        },
      );
      router.push(`/task-groups/${result.taskGroup.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task group");
    } finally {
      setCreating(false);
    }
  }, [workspaceId, selectedItems, selectedCount, creating, sourceTaskId, router]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 pt-16 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">
                Create Task Group
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                From: {sourceTaskTitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">
              <p>No decomposition items found in this task&apos;s results.</p>
              <p className="mt-1">Add tasks manually below.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 transition-colors ${
                    item.selected
                      ? "border-zinc-700 bg-zinc-900/80"
                      : "border-zinc-800/50 bg-zinc-900/30 opacity-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <label className="mt-1 flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => toggleItem(idx)}
                        className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/20"
                      />
                    </label>
                    <div className="min-w-0 flex-1 space-y-2">
                      <input
                        type="text"
                        value={item.title}
                        onChange={(e) => updateItem(idx, "title", e.target.value)}
                        placeholder="Task title"
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600"
                      />
                      <textarea
                        value={item.description}
                        onChange={(e) =>
                          updateItem(idx, "description", e.target.value)
                        }
                        placeholder="Description (optional)"
                        rows={1}
                        className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-700 outline-none focus:border-zinc-600"
                      />
                      <div className="flex gap-2">
                        <select
                          value={item.priority}
                          onChange={(e) =>
                            updateItem(idx, "priority", e.target.value)
                          }
                          className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-zinc-600"
                        >
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                        <select
                          value={item.agentId || defaultAgentId}
                          onChange={(e) =>
                            updateItem(idx, "agentId", e.target.value)
                          }
                          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-zinc-600"
                        >
                          <option value="">Select agent…</option>
                          {(agents ?? []).map((a: AgentSummary) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeItem(idx)}
                          className="rounded-md px-2 py-1 text-xs text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={addItem}
            className="mt-3 w-full rounded-lg border border-dashed border-zinc-700 py-2 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-300"
          >
            + Add Task
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-6 py-4">
          {error && (
            <p className="mb-3 text-xs text-red-400">{error}</p>
          )}
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">
              {selectedCount > 0
                ? `This will create a task group with ${selectedCount} task${selectedCount === 1 ? "" : "s"}`
                : "Select at least one task to create a group"}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={selectedCount === 0 || creating}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
              >
                {creating
                  ? "Creating…"
                  : `Create Task Group (${selectedCount})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
