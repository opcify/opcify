import { getToken } from "./auth";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4210";

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(apiUrl(path), { cache: "no-store", ...init, headers });

  // Auth failures get redirected — `request()` runs outside React, so it has
  // to use a hard navigation. `?next=` on /login and `?forbidden=1` on
  // /dashboard let the landing pages decide how to respond.
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("opcify_token");
      } catch {
        // ignore storage errors (private mode)
      }
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?next=${next}`);
    }
    throw new Error("Not authenticated");
  }

  if (res.status === 403) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("opcify:forbidden", { detail: { path } }),
      );
      window.location.replace("/dashboard?forbidden=1");
    }
    throw new Error("Forbidden: you don't have access to this workspace");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    let msg = (typeof body?.error === "object" ? body.error.message : body?.error) || `HTTP ${res.status}`;
    if (body?.issues?.length) {
      msg += ": " + body.issues.map((i: { path: string; message: string }) => `${i.path} ${i.message}`).join(", ");
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  workspaces: {
    list: () => request<import("@opcify/core").WorkspaceSummary[]>("/workspaces"),
    get: (id: string) => request<import("@opcify/core").WorkspaceSummary>(`/workspaces/${id}`),
    create: (data: import("@opcify/core").CreateWorkspaceInput) =>
      request<import("@opcify/core").Workspace>("/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (id: string, data: import("@opcify/core").UpdateWorkspaceInput) =>
      request<import("@opcify/core").Workspace>(`/workspaces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    provision: (id: string, data: import("@opcify/core").ProvisionWorkspaceInput) =>
      request<import("@opcify/core").Workspace>(`/workspaces/${id}/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    dockerStatus: (id: string) =>
      request<{ status: "running" | "starting" | "not_found" }>(`/workspaces/${id}/docker-status`),
    listArchived: () =>
      request<import("@opcify/core").WorkspaceSummary[]>("/workspaces/archived"),
    archive: (id: string) =>
      request<import("@opcify/core").Workspace>(`/workspaces/${id}/archive`, { method: "POST" }),
    restoreArchive: (id: string) =>
      request<import("@opcify/core").Workspace>(`/workspaces/${id}/restore-archive`, { method: "POST" }),
    getDefault: () =>
      request<{ workspaceId: string | null }>("/workspaces/default"),
    setDefault: (id: string) =>
      request<{ ok: boolean }>(`/workspaces/${id}/set-default`, { method: "POST" }),
    backup: (id: string) =>
      request<Record<string, unknown>>(`/workspaces/${id}/backup`),
    backupDbUrl: (id: string) => apiUrl(`/workspaces/${id}/backup-db`),
    restore: (data: Record<string, unknown>, name?: string) =>
      request<{ workspaceId: string; mode: string; counts: Record<string, number> }>(
        `/workspaces/restore${name ? `?name=${encodeURIComponent(name)}` : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    restoreDb: (dbFile: ArrayBuffer) =>
      request<{ ok: boolean; message: string }>("/workspaces/restore-db", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: dbFile,
      }),
    getApiKey: (id: string) =>
      request<{ apiKey: string | null }>(`/workspaces/${id}/api-key`),
    regenerateApiKey: (id: string) =>
      request<{ apiKey: string }>(`/workspaces/${id}/api-key/regenerate`, { method: "POST" }),
  },

  workspaceTemplates: {
    list: () => request<import("@opcify/core").WorkspaceTemplateDetail[]>("/workspace-templates"),
    get: (id: string) =>
      request<import("@opcify/core").WorkspaceTemplateDetail>(`/workspace-templates/${id}`),
    saveFromWorkspace: (workspaceId: string, data: import("@opcify/core").SaveWorkspaceAsTemplateInput) =>
      request<import("@opcify/core").WorkspaceTemplateDetail>(`/workspaces/${workspaceId}/save-as-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
  },

  dashboard: (workspaceId: string) => request<import("@opcify/core").DashboardSummary>(`/dashboard/summary?workspaceId=${workspaceId}`),

  kanban: {
    summary: (workspaceId: string) =>
      request<import("@opcify/core").KanbanSummary>(
        `/workspaces/${workspaceId}/kanban/summary`,
      ),
    byDate: (date: string, workspaceId: string, timezone?: string) => {
      const qs = new URLSearchParams({ date });
      if (timezone) qs.set("timezone", timezone);
      return request<import("@opcify/core").KanbanDateResponse>(
        `/workspaces/${workspaceId}/kanban?${qs.toString()}`,
      );
    },
    stats: (workspaceId: string, date?: string, timezone?: string) => {
      const qs = new URLSearchParams();
      if (date) qs.set("date", date);
      if (timezone) qs.set("timezone", timezone);
      const query = qs.toString();
      return request<import("@opcify/core").KanbanTimingMetrics>(
        `/workspaces/${workspaceId}/kanban/stats${query ? `?${query}` : ""}`,
      );
    },
    startTask: (workspaceId: string, id: string) =>
      request<import("@opcify/core").Task>(
        `/workspaces/${workspaceId}/tasks/${id}/start`,
        { method: "POST" },
      ),
    acceptTask: (workspaceId: string, id: string, reviewNotes?: string) =>
      request<import("@opcify/core").Task & { parentAutoAccepted?: boolean }>(
        `/workspaces/${workspaceId}/tasks/${id}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewNotes }),
        },
      ),
    retryTask: (
      workspaceId: string,
      id: string,
      reviewNotes?: string,
      overrideInstruction?: string,
    ) =>
      request<import("@opcify/core").Task>(
        `/workspaces/${workspaceId}/tasks/${id}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewNotes, overrideInstruction }),
        },
      ),
    resumeTask: (
      workspaceId: string,
      id: string,
      action: "continue" | "append" | "cancel",
      message?: string,
    ) =>
      request<import("@opcify/core").Task>(
        `/workspaces/${workspaceId}/tasks/${id}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, message }),
        },
      ),
    followUpTask: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").CreateFollowUpInput,
    ) =>
      request<import("@opcify/core").FollowUpResult>(
        `/workspaces/${workspaceId}/tasks/${id}/follow-up`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    getReview: (workspaceId: string, id: string) =>
      request<import("@opcify/core").TaskReviewPayload>(
        `/workspaces/${workspaceId}/tasks/${id}/review`,
      ),
    updatePlannedDate: (workspaceId: string, id: string, date: string | null) =>
      request<import("@opcify/core").Task>(
        `/workspaces/${workspaceId}/tasks/${id}/planned-date`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date }),
        },
      ),
    toggleFocus: (workspaceId: string, id: string, isFocus: boolean) =>
      request<import("@opcify/core").Task>(
        `/workspaces/${workspaceId}/tasks/${id}/focus`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFocus }),
        },
      ),
  },

  agents: {
    list: (workspaceId: string) =>
      request<import("@opcify/core").AgentSummary[]>(
        `/workspaces/${workspaceId}/agents`,
      ),
    get: (workspaceId: string, id: string) =>
      request<import("@opcify/core").AgentDetail>(
        `/workspaces/${workspaceId}/agents/${id}`,
      ),
    tokenUsage: (workspaceId: string, id: string) =>
      request<import("@opcify/core").AgentTokenUsage>(
        `/workspaces/${workspaceId}/agents/${id}/token-usage`,
      ),
    create: (
      workspaceId: string,
      data: import("@opcify/core").CreateAgentInput,
    ) =>
      request<import("@opcify/core").Agent>(`/workspaces/${workspaceId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").UpdateAgentInput,
    ) =>
      request<import("@opcify/core").Agent>(
        `/workspaces/${workspaceId}/agents/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    delete: (workspaceId: string, id: string) =>
      request<void>(`/workspaces/${workspaceId}/agents/${id}`, {
        method: "DELETE",
      }),
    enable: (workspaceId: string, id: string) =>
      request<import("@opcify/core").Agent>(
        `/workspaces/${workspaceId}/agents/${id}/enable`,
        { method: "POST" },
      ),
    disable: (workspaceId: string, id: string) =>
      request<import("@opcify/core").Agent>(
        `/workspaces/${workspaceId}/agents/${id}/disable`,
        { method: "POST" },
      ),
    skills: (workspaceId: string, agentId: string) =>
      request<import("@opcify/core").AgentSkill[]>(
        `/workspaces/${workspaceId}/agents/${agentId}/skills`,
      ),
    recommendations: (workspaceId: string, agentId: string) =>
      request<import("@opcify/core").Skill[]>(
        `/workspaces/${workspaceId}/agents/${agentId}/skills/recommendations`,
      ),
    installSkill: (workspaceId: string, agentId: string, skillId: string) =>
      request<import("@opcify/core").AgentSkill>(
        `/workspaces/${workspaceId}/agents/${agentId}/skills/install`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillId }),
        },
      ),
    uninstallSkill: (workspaceId: string, agentId: string, skillId: string) =>
      request<void>(
        `/workspaces/${workspaceId}/agents/${agentId}/skills/${skillId}`,
        { method: "DELETE" },
      ),
    advice: (workspaceId: string, agentId: string) =>
      request<import("@opcify/core").SkillAdvice>(
        `/workspaces/${workspaceId}/agents/${agentId}/skills/advice`,
      ),
  },

  skills: {
    // Global catalog — any authenticated user can browse.
    list: () => request<import("@opcify/core").Skill[]>("/skills"),
    createDraft: (
      workspaceId: string,
      data: import("@opcify/core").CreateSkillDraftInput,
    ) =>
      request<import("@opcify/core").CreateSkillDraftOutput>(
        `/workspaces/${workspaceId}/skills/create-draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
  },

  templates: {
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<import("@opcify/core").AgentTemplate[]>(`/agent-templates${qs}`);
    },
    get: (id: string) =>
      request<import("@opcify/core").AgentTemplateDetail>(`/agent-templates/${id}`),
    createAgent: (
      templateId: string,
      data: Omit<import("@opcify/core").CreateAgentFromTemplateInput, "templateId">,
    ) =>
      request<import("@opcify/core").Agent>(
        `/agent-templates/${templateId}/create-agent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
  },

  taskTemplates: {
    list: (workspaceId: string, params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<import("@opcify/core").TaskTemplate[]>(
        `/workspaces/${workspaceId}/task-templates${qs}`,
      );
    },
    get: (workspaceId: string, id: string) =>
      request<import("@opcify/core").TaskTemplate>(
        `/workspaces/${workspaceId}/task-templates/${id}`,
      ),
    createTask: (
      workspaceId: string,
      templateId: string,
      data: Omit<import("@opcify/core").CreateTaskFromTemplateInput, "templateId">,
    ) =>
      request<import("@opcify/core").Task>(
        `/workspaces/${workspaceId}/task-templates/${templateId}/create-task`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    save: (
      workspaceId: string,
      data: import("@opcify/core").SaveTaskTemplateInput,
    ) =>
      request<import("@opcify/core").TaskTemplate>(
        `/workspaces/${workspaceId}/task-templates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    saveFromTask: (workspaceId: string, taskId: string, name?: string) =>
      request<import("@opcify/core").TaskTemplate>(
        `/workspaces/${workspaceId}/task-templates/from-task/${taskId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(name ? { name } : {}),
        },
      ),
    delete: (workspaceId: string, id: string) =>
      request<void>(`/workspaces/${workspaceId}/task-templates/${id}`, {
        method: "DELETE",
      }),
  },

  taskGroups: {
    list: (workspaceId: string) =>
      request<import("@opcify/core").TaskGroup[]>(
        `/workspaces/${workspaceId}/task-groups`,
      ),
    get: (workspaceId: string, id: string) =>
      request<import("@opcify/core").TaskGroupDetail>(
        `/workspaces/${workspaceId}/task-groups/${id}`,
      ),
    createFromDecomposition: (
      workspaceId: string,
      taskId: string,
      data: import("@opcify/core").CreateTaskGroupFromDecompositionInput,
    ) =>
      request<import("@opcify/core").CreateTaskGroupResult>(
        `/workspaces/${workspaceId}/task-groups/from-decomposition/${taskId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
  },

  notes: {
    list: (
      workspaceId: string,
      params?: { q?: string; includeArchived?: boolean },
    ) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set("q", params.q);
      if (params?.includeArchived) qs.set("includeArchived", "true");
      const query = qs.toString();
      return request<import("@opcify/core").Note[]>(
        `/workspaces/${workspaceId}/notes${query ? `?${query}` : ""}`,
      );
    },
    get: (workspaceId: string, id: string) =>
      request<import("@opcify/core").NoteWithLinks>(
        `/workspaces/${workspaceId}/notes/${id}`,
      ),
    create: (workspaceId: string, data: import("@opcify/core").CreateNoteInput) =>
      request<import("@opcify/core").Note>(`/workspaces/${workspaceId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").UpdateNoteInput,
    ) =>
      request<import("@opcify/core").Note>(
        `/workspaces/${workspaceId}/notes/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    delete: (workspaceId: string, id: string) =>
      request<void>(`/workspaces/${workspaceId}/notes/${id}`, { method: "DELETE" }),
    daily: (workspaceId: string, date?: string) => {
      const qs = new URLSearchParams();
      if (date) qs.set("date", date);
      const query = qs.toString();
      return request<import("@opcify/core").Note>(
        `/workspaces/${workspaceId}/notes/daily${query ? `?${query}` : ""}`,
        { method: "POST" },
      );
    },
    templates: (workspaceId: string) =>
      request<{ key: string; title: string; content: string }[]>(
        `/workspaces/${workspaceId}/notes/templates`,
      ),
    createFromTemplate: (
      workspaceId: string,
      templateKey: string,
      title?: string,
    ) =>
      request<import("@opcify/core").Note>(
        `/workspaces/${workspaceId}/notes/from-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateKey, title }),
        },
      ),
  },

  clients: {
    list: (params: { workspaceId: string; q?: string; status?: string; sort?: string }) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      if (params.sort) qs.set("sort", params.sort);
      const query = qs.toString();
      return request<import("@opcify/core").ClientWithTaskCount[]>(
        `/workspaces/${params.workspaceId}/clients${query ? `?${query}` : ""}`,
      );
    },
    get: (workspaceId: string, id: string) =>
      request<import("@opcify/core").ClientDetail>(
        `/workspaces/${workspaceId}/clients/${id}`,
      ),
    create: (workspaceId: string, data: import("@opcify/core").CreateClientInput) =>
      request<import("@opcify/core").Client>(`/workspaces/${workspaceId}/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").UpdateClientInput,
    ) =>
      request<import("@opcify/core").Client>(
        `/workspaces/${workspaceId}/clients/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    archive: (workspaceId: string, id: string) =>
      request<import("@opcify/core").Client>(
        `/workspaces/${workspaceId}/clients/${id}`,
        { method: "DELETE" },
      ),
    tasks: (workspaceId: string, id: string) =>
      request<{ id: string; title: string; status: string; priority: string; updatedAt: string; agent: { id: string; name: string } }[]>(
        `/workspaces/${workspaceId}/clients/${id}/tasks`,
      ),
  },

  ledger: {
    list: (params: { workspaceId: string; type?: string; clientId?: string; q?: string; sort?: string; dateFrom?: string; dateTo?: string }) => {
      const qs = new URLSearchParams();
      if (params.type) qs.set("type", params.type);
      if (params.clientId) qs.set("clientId", params.clientId);
      if (params.q) qs.set("q", params.q);
      if (params.sort) qs.set("sort", params.sort);
      if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
      if (params.dateTo) qs.set("dateTo", params.dateTo);
      const query = qs.toString();
      return request<import("@opcify/core").LedgerEntryWithClient[]>(
        `/workspaces/${params.workspaceId}/ledger${query ? `?${query}` : ""}`,
      );
    },
    summary: (workspaceId: string, dateFrom?: string, dateTo?: string) => {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      const query = qs.toString();
      return request<import("@opcify/core").LedgerSummary>(
        `/workspaces/${workspaceId}/ledger/summary${query ? `?${query}` : ""}`,
      );
    },
    get: (workspaceId: string, id: string) =>
      request<import("@opcify/core").LedgerEntryWithClient>(
        `/workspaces/${workspaceId}/ledger/${id}`,
      ),
    create: (workspaceId: string, data: import("@opcify/core").CreateLedgerEntryInput) =>
      request<import("@opcify/core").LedgerEntry>(`/workspaces/${workspaceId}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").UpdateLedgerEntryInput,
    ) =>
      request<import("@opcify/core").LedgerEntry>(
        `/workspaces/${workspaceId}/ledger/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    delete: (workspaceId: string, id: string) =>
      request<void>(`/workspaces/${workspaceId}/ledger/${id}`, { method: "DELETE" }),
  },

  recurring: {
    list: (workspaceId: string) =>
      request<import("@opcify/core").RecurringRuleWithClient[]>(
        `/workspaces/${workspaceId}/recurring`,
      ),
    get: (workspaceId: string, id: string) =>
      request<import("@opcify/core").RecurringRuleWithClient>(
        `/workspaces/${workspaceId}/recurring/${id}`,
      ),
    create: (
      workspaceId: string,
      data: import("@opcify/core").CreateRecurringRuleInput,
    ) =>
      request<import("@opcify/core").RecurringRule>(
        `/workspaces/${workspaceId}/recurring`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    update: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").UpdateRecurringRuleInput,
    ) =>
      request<import("@opcify/core").RecurringRule>(
        `/workspaces/${workspaceId}/recurring/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    delete: (workspaceId: string, id: string) =>
      request<void>(`/workspaces/${workspaceId}/recurring/${id}`, {
        method: "DELETE",
      }),
    trigger: (workspaceId: string) =>
      request<{ processed: number }>(
        `/workspaces/${workspaceId}/recurring/trigger`,
        { method: "POST" },
      ),
  },

  tasks: {
    list: (workspaceId: string, params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<import("@opcify/core").TaskWithAgent[]>(
        `/workspaces/${workspaceId}/tasks${qs}`,
      );
    },
    get: (workspaceId: string, id: string) =>
      request<import("@opcify/core").TaskDetail>(
        `/workspaces/${workspaceId}/tasks/${id}`,
      ),
    logs: (workspaceId: string, id: string) =>
      request<import("@opcify/core").TaskLog[]>(
        `/workspaces/${workspaceId}/tasks/${id}/logs`,
      ),
    create: (workspaceId: string, data: import("@opcify/core").CreateTaskInput) =>
      request<import("@opcify/core").Task>(`/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").UpdateTaskInput,
    ) =>
      request<import("@opcify/core").Task>(
        `/workspaces/${workspaceId}/tasks/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    updateStatus: (workspaceId: string, id: string, status: string) =>
      request<import("@opcify/core").Task>(
        `/workspaces/${workspaceId}/tasks/${id}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      ),
    stop: (workspaceId: string, id: string) =>
      request<import("@opcify/core").Task>(
        `/workspaces/${workspaceId}/tasks/${id}/stop`,
        { method: "POST" },
      ),
    archive: (workspaceId: string, id: string) =>
      request<{ ok: boolean }>(
        `/workspaces/${workspaceId}/tasks/${id}/archive`,
        { method: "POST" },
      ),
    unarchive: (workspaceId: string, id: string) =>
      request<{ ok: boolean }>(
        `/workspaces/${workspaceId}/tasks/${id}/unarchive`,
        { method: "POST" },
      ),
  },

  chat: {
    send: (agentId: string, workspaceId: string, data: import("@opcify/core").ChatSendInput) =>
      request<{ ok: boolean; sessionKey: string }>(
        `/workspaces/${workspaceId}/chat/${agentId}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    history: (agentId: string, workspaceId: string, sessionKey?: string) => {
      const qs = new URLSearchParams();
      if (sessionKey) qs.set("sessionKey", sessionKey);
      const query = qs.toString();
      return request<import("@opcify/core").ChatHistoryResponse>(
        `/workspaces/${workspaceId}/chat/${agentId}/history${query ? `?${query}` : ""}`,
      );
    },
    sessions: (agentId: string, workspaceId: string) =>
      request<import("@opcify/core").ChatSessionsResponse>(
        `/workspaces/${workspaceId}/chat/${agentId}/sessions`,
      ),
    abort: (agentId: string, workspaceId: string, sessionKey?: string) =>
      request<{ ok: boolean }>(
        `/workspaces/${workspaceId}/chat/${agentId}/abort`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionKey }),
        },
      ),
    reset: (agentId: string, workspaceId: string, sessionKey?: string) =>
      request<{ ok: boolean }>(
        `/workspaces/${workspaceId}/chat/${agentId}/reset`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionKey }),
        },
      ),
  },

  openclaw: {
    config: (workspaceId: string) =>
      request<Record<string, unknown>>(
        `/workspaces/${workspaceId}/openclaw/config`,
      ),
    telegramConfig: (workspaceId: string) =>
      request<{ telegram: TelegramChannelConfig | null; bindings: TelegramBinding[] }>(
        `/workspaces/${workspaceId}/openclaw/config/telegram`,
      ),
    saveTelegramConfig: (workspaceId: string, data: SaveTelegramConfigInput) =>
      request<{ ok: boolean; config: Record<string, unknown> }>(
        `/workspaces/${workspaceId}/openclaw/config/telegram`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    startGateway: (workspaceId: string) =>
      request<CommandResult>(
        `/workspaces/${workspaceId}/openclaw/gateway/start`,
        { method: "POST" },
      ),
    pairingList: (workspaceId: string) =>
      request<CommandResult>(
        `/workspaces/${workspaceId}/openclaw/pairing/telegram`,
      ),
    approvePairing: (workspaceId: string, code: string) =>
      request<CommandResult>(
        `/workspaces/${workspaceId}/openclaw/pairing/telegram/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        },
      ),
    saveBindings: (
      workspaceId: string,
      bindings: { agentId: string; accountId: string }[],
    ) =>
      request<{ ok: boolean; config: Record<string, unknown> }>(
        `/workspaces/${workspaceId}/openclaw/bindings/telegram`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bindings }),
        },
      ),
    deleteTelegramAccount: (workspaceId: string, accountId: string) =>
      request<{ ok: boolean }>(
        `/workspaces/${workspaceId}/openclaw/config/telegram/${accountId}`,
        { method: "DELETE" },
      ),
    status: (workspaceId: string) =>
      request<OpenClawStatus>(
        `/workspaces/${workspaceId}/openclaw/status`,
      ),

    // Capabilities (Skills & Plugins management) — workspace-scoped
    listCapabilities: (workspaceId: string) =>
      request<{ skills: InstalledSkill[]; perAgentSlugs?: string[] }>(`/workspaces/${workspaceId}/openclaw/capabilities`),
    listManagedSkills: (workspaceId: string) =>
      request<{ skills: ManagedSkill[] }>(`/workspaces/${workspaceId}/openclaw/managed-skills`),
    /** Workspace-agnostic catalog used by the setup wizard. Loaded from each
     *  templates/skills/<slug>/_meta.json — no hardcoded list anywhere. */
    listManagedSkillsCatalog: () =>
      request<{ skills: ManagedSkill[] }>(`/managed-skills/catalog`),
    listSkills: (workspaceId: string) =>
      request<CapabilitiesSkillsResponse>(`/workspaces/${workspaceId}/openclaw/skills`),
    listPlugins: (workspaceId: string) =>
      request<CapabilitiesPluginsResponse>(`/workspaces/${workspaceId}/openclaw/plugins`),
    installSkill: (workspaceId: string, slug: string, agentIds?: string[]) =>
      request<CommandResult>(`/workspaces/${workspaceId}/openclaw/skills/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...(agentIds?.length ? { agentIds } : {}) }),
      }),
    uninstallSkill: (workspaceId: string, slug: string) =>
      request<CommandResult>(`/workspaces/${workspaceId}/openclaw/skills/uninstall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      }),
    installPlugin: (workspaceId: string, packageName: string) =>
      request<CommandResult>(`/workspaces/${workspaceId}/openclaw/plugins/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageName }),
      }),
    updateAllSkills: (workspaceId: string) =>
      request<CommandResult>(`/workspaces/${workspaceId}/openclaw/skills/update-all`, { method: "POST" }),
    updateAllPlugins: (workspaceId: string) =>
      request<CommandResult>(`/workspaces/${workspaceId}/openclaw/plugins/update-all`, { method: "POST" }),
    toggleSkill: (workspaceId: string, skillName: string, enabled: boolean) =>
      request<{ ok: boolean }>(`/workspaces/${workspaceId}/openclaw/skills/${encodeURIComponent(skillName)}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }),
    getSkillConfig: (workspaceId: string, skillName: string) =>
      request<SkillConfigEntry>(`/workspaces/${workspaceId}/openclaw/skills/${encodeURIComponent(skillName)}/config`),
    updateSkillConfig: (workspaceId: string, skillName: string, config: Partial<SkillConfigEntry>) =>
      request<{ ok: boolean }>(`/workspaces/${workspaceId}/openclaw/skills/${encodeURIComponent(skillName)}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      }),
  },

  archives: {
    list: (workspaceId: string, path: string = "") => {
      const qs = new URLSearchParams({ path });
      return request<ArchiveListResponse>(
        `/workspaces/${workspaceId}/archives?${qs.toString()}`,
      );
    },
    downloadUrl: (workspaceId: string, path: string) => {
      // Browser navigation (<a href>, window.open) can't set the
      // Authorization header, so we fall back to the backend's ?_token
      // query-param auth path (also used by EventSource/SSE routes).
      const token = getToken();
      const qs = new URLSearchParams({ path });
      if (token) qs.set("_token", token);
      return apiUrl(
        `/workspaces/${workspaceId}/archives/download?${qs.toString()}`,
      );
    },
    previewUrl: (workspaceId: string, path: string) => {
      const token = getToken();
      const qs = new URLSearchParams({ path, inline: "1" });
      if (token) qs.set("_token", token);
      return apiUrl(
        `/workspaces/${workspaceId}/archives/download?${qs.toString()}`,
      );
    },
    upload: (
      workspaceId: string,
      path: string,
      files: Array<{ fileName: string; data: string }>,
    ) =>
      request<{ paths: string[] }>(`/workspaces/${workspaceId}/archives/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, files }),
      }),
    createFolder: (workspaceId: string, path: string) =>
      request<{ path: string }>(`/workspaces/${workspaceId}/archives/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      }),
    delete: (workspaceId: string, path: string) => {
      const qs = new URLSearchParams({ path });
      return request<void>(
        `/workspaces/${workspaceId}/archives?${qs.toString()}`,
        { method: "DELETE" },
      );
    },
    move: (workspaceId: string, from: string, to: string) =>
      request<{ from: string; to: string }>(
        `/workspaces/${workspaceId}/archives/move`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to }),
        },
      ),
    sync: (workspaceId: string, path: string) =>
      request<{ synced: number; path: string }>(
        `/workspaces/${workspaceId}/archives/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        },
      ),
    share: (workspaceId: string, path: string, expirySeconds?: number) =>
      request<{ url: string; expirySeconds: number }>(
        `/workspaces/${workspaceId}/archives/share`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, expirySeconds: expirySeconds ?? 604800 }),
        },
      ),
  },

  inbox: {
    list: (params: {
      workspaceId: string;
      status?: string;
      urgency?: string;
      source?: string;
      q?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params.status) qs.set("status", params.status);
      if (params.urgency) qs.set("urgency", params.urgency);
      if (params.source) qs.set("source", params.source);
      if (params.q) qs.set("q", params.q);
      const query = qs.toString();
      return request<import("@opcify/core").InboxItem[]>(
        `/workspaces/${params.workspaceId}/inbox${query ? `?${query}` : ""}`,
      );
    },
    stats: (workspaceId: string) =>
      request<{ inbox: number; critical: number; high: number }>(
        `/workspaces/${workspaceId}/inbox/stats`,
      ),
    get: (workspaceId: string, id: string) =>
      request<import("@opcify/core").InboxItem>(
        `/workspaces/${workspaceId}/inbox/${id}`,
      ),
    thread: (workspaceId: string, id: string) =>
      request<import("@opcify/core").InboxItem[]>(
        `/workspaces/${workspaceId}/inbox/${id}/thread`,
      ),
    create: (
      workspaceId: string,
      data: import("@opcify/core").CreateInboxItemInput,
    ) =>
      request<import("@opcify/core").InboxItem>(
        `/workspaces/${workspaceId}/inbox`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    update: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").UpdateInboxItemInput,
    ) =>
      request<import("@opcify/core").InboxItem>(
        `/workspaces/${workspaceId}/inbox/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    action: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").InboxActionInput,
    ) =>
      request<{ ok: boolean; resultId?: string }>(
        `/workspaces/${workspaceId}/inbox/${id}/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    batch: (
      workspaceId: string,
      data: {
        ids: string[];
        action: string;
        snoozeUntil?: string;
      },
    ) =>
      request<{ ok: boolean }>(`/workspaces/${workspaceId}/inbox/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    delete: (workspaceId: string, id: string) =>
      request<void>(`/workspaces/${workspaceId}/inbox/${id}`, {
        method: "DELETE",
      }),

    // ── Email compose ────────────────────────────────────────────
    draftCreate: (
      workspaceId: string,
      data: Omit<import("@opcify/core").CreateEmailDraftInput, "workspaceId">,
    ) =>
      request<import("@opcify/core").InboxItem>(
        `/workspaces/${workspaceId}/inbox/drafts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    draftUpdate: (
      workspaceId: string,
      id: string,
      data: import("@opcify/core").UpdateEmailDraftInput,
    ) =>
      request<import("@opcify/core").InboxItem>(
        `/workspaces/${workspaceId}/inbox/drafts/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    draftDelete: (workspaceId: string, id: string) =>
      request<void>(`/workspaces/${workspaceId}/inbox/drafts/${id}`, {
        method: "DELETE",
      }),
    draftAttachment: (
      workspaceId: string,
      id: string,
      file: { fileName: string; mediaType: string; data: string },
    ) =>
      request<import("@opcify/core").EmailDraftAttachment>(
        `/workspaces/${workspaceId}/inbox/drafts/${id}/attachments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(file),
        },
      ),
    compose: (
      workspaceId: string,
      data: Omit<import("@opcify/core").ComposeEmailInput, "workspaceId">,
    ) =>
      request<{ ok: boolean; inboxItemId: string }>(
        `/workspaces/${workspaceId}/inbox/compose`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    cleanupEmptyDrafts: (workspaceId: string) =>
      request<{ deleted: number }>(
        `/workspaces/${workspaceId}/inbox/cleanup-empty-drafts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      ),
  },

  gmail: {
    status: (workspaceId: string) =>
      request<{ connected: boolean; email?: string }>(
        `/auth/gmail/status?workspaceId=${workspaceId}`,
      ),
    connect: (data: { code: string; workspaceId: string }) =>
      request<{ connected: boolean; email: string }>(
        "/auth/gmail/connect",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    disconnect: (workspaceId: string) =>
      request<{ connected: false }>("/auth/gmail/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      }),
  },
};

// ─── OpenClaw types ───────────────────────────────────────────────

export interface TelegramAccountInput {
  accountId: string;
  botToken: string;
  enabled?: boolean;
  requireMention?: boolean;
  dmPolicy?: string;
  groupPolicy?: string;
  streaming?: string;
}

export interface SaveTelegramConfigInput {
  accounts: TelegramAccountInput[];
  enabled?: boolean;
  dmPolicy?: string;
  groupPolicy?: string;
  streaming?: string;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  dmPolicy: string;
  groupPolicy: string;
  streaming: string;
  accounts: Record<string, {
    enabled: boolean;
    dmPolicy: string;
    botToken: string;
    groups: Record<string, { requireMention: boolean }>;
    groupPolicy: string;
    streaming: string;
  }>;
}

export interface TelegramBinding {
  agentId: string;
  match: { channel: string; accountId: string };
}

export interface CommandResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface OpenClawStatus {
  configured: boolean;
  telegramEnabled: boolean;
  accountCount: number;
  bindingCount: number;
}

export interface InstalledSkill {
  slug: string;
  name: string;
  description?: string;
  emoji?: string;
  eligible: boolean;
  disabled: boolean;
  bundled: boolean;
  source?: string;
  homepage?: string;
  missing?: { bins: string[]; env: string[]; config: string[]; os: string[] };
}

export type ManagedSkillTier = "general" | "template-scoped";

export interface ManagedSkill {
  slug: string;
  name: string;
  /** Display label from _meta.json (falls back to name/slug). */
  label: string;
  description: string;
  version: string;
  category: string;
  installed: boolean;
  /**
   * Setup-wizard tier:
   *   - "general"         → shown for every workspace template
   *   - "template-scoped" → only shown in setup when its template is selected;
   *                          installable from the post-creation Skills page anywhere.
   */
  tier: ManagedSkillTier;
  /** Workspace template keys this skill is scoped to (template-scoped tier only). */
  templateScopes?: string[];
  /** Always-on skills are rendered as locked checkboxes in the setup wizard. */
  alwaysOn: boolean;
  /** Optional emoji from _meta.json for UI rendering. */
  emoji?: string;
}

export interface InstalledPlugin {
  packageName: string;
  description?: string;
  version?: string;
  source?: string;
}

export interface SkillConfigEntry {
  enabled?: boolean;
  env?: Record<string, string>;
  apiKey?: string | { source: string; provider: string; id: string };
}

export interface CapabilitiesSkillsResponse {
  skills: InstalledSkill[];
  command: string;
  success: boolean;
  stderr: string;
}

export interface ArchiveItem {
  name: string;
  type: "file" | "folder";
  size: number | null;
  mtime: string;
  path: string;
  source: "local" | "cloud" | "synced";
}

export interface ArchiveListResponse {
  items: ArchiveItem[];
  path: string;
}

export interface CapabilitiesPluginsResponse {
  plugins: InstalledPlugin[];
  command: string;
  success: boolean;
  stderr: string;
}
