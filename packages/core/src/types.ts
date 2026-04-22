// --- AI Provider types ---

export interface AIModelOption {
  value: string;
  label: string;
  desc?: string;
}

export interface AIProviderDef {
  id: string;
  label: string;
  models: AIModelOption[];
}

export interface AIProviderConfig {
  id: string;
  apiKey: string;
  /** Only for custom providers */
  label?: string;
  /** Only for custom providers */
  baseUrl?: string;
  /** Only for custom providers — user-defined models */
  models?: AIModelOption[];
}

export interface WorkspaceAISettings {
  providers: AIProviderConfig[];
  defaultModel: string;
}

// --- Workspace types ---

export type WorkspaceStatus = "draft" | "provisioning" | "ready" | "failed" | "archived";
export type WorkspaceType =
  | "opcify_starter"
  | "content_creator_studio"
  | (string & {}); // allow custom template keys

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: WorkspaceType;
  status: WorkspaceStatus;
  isDefault: boolean;
  userId?: string | null;
  settingsJson: string | null;
  bundleVersion: string | null;
  lastProvisionedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummary extends Workspace {
  agentCount: number;
  taskCount: number;
  activeTaskCount: number;
}

export interface WorkspaceTemplate {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  isBuiltIn: boolean;
  configJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTemplateDetail extends WorkspaceTemplate {
  config: WorkspaceTemplateConfig;
}

export interface WorkspaceTemplateConfig {
  agents: WorkspaceTemplateAgent[];
  skills: string[]; // skill keys
  taskTemplates: string[]; // task template keys
  demoData?: boolean;
}

export interface WorkspaceTemplateAgent {
  name: string;
  role: string;
  description: string;
  model?: string;
  skillKeys?: string[];
  // Agent bootstrap files (all optional — defaults generated if not set)
  soul?: string;
  agentConfig?: string;
  identity?: string;
  user?: string;
  tools?: string;
  heartbeat?: string;
  bootstrap?: string;
}

export interface SaveWorkspaceAsTemplateInput {
  name: string;
  description?: string;
  category?: string;
  icon?: string;
}

export interface CreateWorkspaceInput {
  name: string;
  slug?: string;
  description?: string;
  type?: WorkspaceType;
  templateId?: string;
  settingsJson?: string;
}

export interface ProvisionWorkspaceInput {
  templateId?: string;
  defaultModel?: string;
  agents?: WorkspaceTemplateAgent[];
  skillKeys?: string[];
  /** Opcify managed skills to install (e.g. "opcify-docx", "opcify-pdf"). "opcify" is always included. */
  managedSkillKeys?: string[];
  taskTemplateKeys?: string[];
  enableDemoData?: boolean;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  status?: WorkspaceStatus;
  settingsJson?: string | null;
}

// --- Domain types matching Prisma schema ---

export type AgentStatus = "idle" | "running" | "blocked" | "error" | "disabled";
export type TaskStatus = "queued" | "running" | "waiting" | "done" | "failed" | "stopped";
export type TaskType = "normal" | "decomposition";
export type ExecutionMode = "single" | "manual_workflow" | "orchestrated";
export type ExecutionStepStatus = "pending" | "running" | "completed" | "failed";
export type TaskPriority = "high" | "medium" | "low";
export type WaitingReason =
  | "waiting_for_review"
  | "waiting_for_input"
  | "waiting_for_dependency"
  | "waiting_for_retry"
  | "waiting_for_external";
export type LogLevel = "info" | "error";

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  model: string;
  soul: string | null;
  agentConfig: string | null;
  identity: string | null;
  user: string | null;
  tools: string | null;
  heartbeat: string | null;
  bootstrap: string | null;
  isSystem: boolean;
  status: AgentStatus;
  maxConcurrent: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSummary extends Agent {
  currentTask: { id: string; title: string; progress: number } | null;
  tokenUsageToday: number;
  tokenUsageWeek: number;
  installedSkillsCount: number;
}

export interface AgentTokenUsage {
  today: number;
  week: number;
  total: number;
  daily: { date: string; tokens: number }[];
}

export interface AgentRecentTask {
  id: string;
  title: string;
  status: TaskStatus;
  resultSummary: string | null;
  finishedAt: string | null;
}

export interface AgentDetail extends Agent {
  skills: Skill[];
  taskCounts: { total: number; running: number; done: number; failed: number };
  currentTask: { id: string; title: string; progress: number } | null;
  tokenUsage: AgentTokenUsage;
  recentTasks: AgentRecentTask[];
}

export interface Skill {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
}

export interface AgentSkill {
  id: string;
  agentId: string;
  skillId: string;
  installedAt: string;
  skill: Skill;
}

export type ReviewStatus = "pending" | "accepted" | "rejected" | "followed_up";
export type TaskGroupType = "decomposition" | "manual";

export interface TaskGroup {
  id: string;
  title: string;
  description: string;
  type: TaskGroupType;
  sourceTaskId: string | null;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskGroupDetail extends TaskGroup {
  tasks: TaskWithAgent[];
}

export interface TaskGroupInfo {
  id: string;
  title: string;
}

export interface CreateTaskGroupFromDecompositionInput {
  tasks: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    agentId: string;
  }[];
}

export interface CreateTaskGroupResult {
  taskGroup: TaskGroup;
  tasks: Task[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  taskType: TaskType;
  agentId: string;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  reviewStatus: ReviewStatus | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  resultSummary: string | null;
  resultContent: string | null;
  sourceTaskId: string | null;
  plannedDate: string | null;
  isFocus: boolean;
  taskGroupId: string | null;
  waitingReason: WaitingReason | null;
  blockingQuestion: string | null;
  blockedByTaskId: string | null;
  executionMode: ExecutionMode;
  orchestratorAgentId: string | null;
  clientId: string | null;
  maxRetries: number;
  recurringRuleId: string | null;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  queuePosition?: number | null;
}

export interface TaskExecutionStep {
  id: string;
  taskId: string;
  stepOrder: number;
  agentId: string | null;
  agentName: string | null;
  roleLabel: string | null;
  title: string | null;
  instruction: string | null;
  status: ExecutionStepStatus;
  outputSummary: string | null;
  outputContent: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceTaskInfo {
  id: string;
  title: string;
  resultSummary: string | null;
  reviewStatus: ReviewStatus | null;
}

export interface FollowUpTaskInfo {
  id: string;
  title: string;
  status: TaskStatus;
  reviewStatus: ReviewStatus | null;
}

export interface TaskExecutionStepSummary {
  total: number;
  completed: number;
  running: number;
  currentAgentName: string | null;
}

export interface TaskWithAgent extends Task {
  agent: { id: string; name: string };
  sourceTask?: SourceTaskInfo | null;
  taskGroup?: TaskGroupInfo | null;
  executionStepsSummary?: TaskExecutionStepSummary | null;
}

export interface BlockedByTaskInfo {
  id: string;
  title: string;
  status: TaskStatus;
  reviewStatus: ReviewStatus | null;
}

export interface RecurringRuleInfo {
  id: string;
  title: string;
  frequency: string;
  interval: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number | null;
  minute: number | null;
  startDate: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  isActive: boolean;
}

export interface TaskDetail extends Task {
  agent: Pick<Agent, "id" | "name" | "role" | "model">;
  logs: TaskLog[];
  sourceTask?: SourceTaskInfo | null;
  followUpTasks?: FollowUpTaskInfo[];
  taskGroup?: TaskGroupInfo | null;
  blockedByTask?: BlockedByTaskInfo | null;
  executionSteps?: TaskExecutionStep[];
  client?: { id: string; name: string } | null;
  recurringRule?: RecurringRuleInfo | null;
}

export interface SyncExecutionStepsInput {
  taskId: string;
  executionMode?: ExecutionMode;
  finalTaskStatus?: TaskStatus;
  steps: {
    stepOrder: number;
    agentId?: string;
    agentName?: string;
    roleLabel?: string;
    title?: string;
    instruction?: string;
    status: ExecutionStepStatus;
    outputSummary?: string;
    outputContent?: string;
    startedAt?: string;
    finishedAt?: string;
  }[];
}

// --- OpenClaw Integration types ---

export interface OpenClawWorkflowStep {
  stepOrder: number;
  agentId?: string;
  agentName?: string;
  roleLabel?: string;
  instruction: string;
}

export interface OpenClawExecuteCommand {
  taskId: string;
  executionMode: ExecutionMode;
  goal: string;
  description?: string;
  priority: TaskPriority;
  /** If this is a follow-up task, the ID of the source task it continues from. */
  sourceTaskId?: string;
  workflowPlan?: OpenClawWorkflowStep[];
  context?: {
    taskGroupId?: string;
    orchestratorAgentId?: string;
  };
  callbackUrl?: string;
  callbackToken?: string;
  /** IANA timezone of the workspace owner (e.g. "America/New_York"). */
  timezone?: string;
  agent?: {
    id: string;
    name: string;
    role: string;
    model: string;
    skills?: string[];
  };
}

// --- SSE Event types ---

export type TaskSSEEvent =
  | {
      type: "task:created";
      taskId: string;
      title: string;
      agentId: string;
      priority: TaskPriority;
      status: TaskStatus;
    }
  | {
      type: "task:updated";
      taskId: string;
      status?: TaskStatus;
      progress?: number;
      reviewStatus?: ReviewStatus | null;
      priority?: TaskPriority;
      currentAgentName?: string | null;
    }
  | {
      type: "step:updated";
      taskId: string;
      stepOrder: number;
      status: string;
      outputSummary?: string;
      agentId?: string | null;
      agentName?: string | null;
    }
  | {
      type: "queue:changed";
      agentId: string;
      queuedCount: number;
      runningCount: number;
      maxConcurrent: number;
    };

// ─── Chat Types ─────────────────────────────────────────────────────

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; name: string; input: string }
  | { type: "tool_result"; name: string; content: string };

export type ChatMessage = {
  role: "user" | "assistant";
  content: ChatContentBlock[];
  timestamp?: number;
};

export type ChatAttachment = {
  type: "image" | "file";
  mediaType: string;
  fileName?: string;
  data: string; // base64
};

export type ChatSendInput = {
  message: string;
  sessionKey?: string;
  attachments?: ChatAttachment[];
};

export type ChatHistoryResponse = {
  messages: ChatMessage[];
  sessionKey: string;
};

export type ChatSessionInfo = {
  sessionKey: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
};

export type ChatSessionsResponse = {
  sessions: ChatSessionInfo[];
};

export type ChatStreamEvent =
  | { type: "chat:delta"; text: string; blockType?: "text" | "thinking"; sessionKey: string }
  | { type: "chat:final"; message: ChatMessage; sessionKey: string }
  | { type: "chat:error"; error: string; sessionKey: string }
  | { type: "chat:aborted"; sessionKey: string };

export interface OpenClawDispatchResult {
  success: boolean;
  error?: string;
}

export interface TaskLog {
  id: string;
  taskId: string;
  level: LogLevel;
  message: string;
  createdAt: string;
}

export interface DashboardSummary {
  agents: { total: number; idle: number; running: number; error: number; disabled: number };
  tasks: { total: number; queued: number; running: number; done: number; failed: number };
  skills: { total: number; installed: number };
  recentTasks: Task[];
}

export type KanbanMode = "today" | "past" | "future";

export interface KanbanSummaryCards {
  items: { label: string; value: number; color: string; bg: string; dot: string }[];
}

/**
 * Timing aggregates for the Kanban scope (today, a past day, etc.).
 * Computed server-side so headless consumers (Telegram bot, scheduled reports, CLI,
 * future mobile clients) can read them without reimplementing aggregation logic.
 */
export interface KanbanTimingMetrics {
  avgDurationMs: number | null;
  totalProcessingMs: number;
  avgQueueWaitMs: number | null;
  longestRunningMs: number | null;
  longestRunningTaskId: string | null;
  longestRunningTaskTitle: string | null;
  completedCount: number;
  runningCount: number;
}

export interface KanbanSummary {
  summary: {
    planned: number;
    running: number;
    review: number;
    completed: number;
  };
  todayPlan: TaskWithAgent[];
  inProgress: TaskWithAgent[];
  readyForReview: TaskWithAgent[];
  completedToday: TaskWithAgent[];
  failedToday: TaskWithAgent[];
  nextActions: SuggestedTaskAction[];
  timingMetrics: KanbanTimingMetrics;
}

export interface KanbanDateResponse {
  mode: KanbanMode;
  selectedDate: string;
  summary: KanbanSummaryCards;
  dailySummaryText?: string;
  focusTasks?: TaskWithAgent[];
  sections: {
    todayPlan?: TaskWithAgent[];
    inProgress?: TaskWithAgent[];
    readyForReview?: TaskWithAgent[];
    completedToday?: TaskWithAgent[];
    failedToday?: TaskWithAgent[];
    nextActions?: SuggestedTaskAction[];
    assignedThatDay?: TaskWithAgent[];
    completedThatDay?: TaskWithAgent[];
    stillInProgress?: TaskWithAgent[];
    attentionNeeded?: TaskWithAgent[];
    suggestedNextSteps?: SuggestedTaskAction[];
    plannedTasks?: TaskWithAgent[];
    suggestedTasks?: SuggestedTaskAction[];
  };
  timingMetrics: KanbanTimingMetrics;
}

export interface SuggestedTaskAction {
  id: string;
  title: string;
  suggestedAgentId?: string;
  suggestedAgentName?: string;
  reason: string;
  templateId?: string;
  sourceTaskId?: string;
}

export interface DecompositionResultItem {
  title: string;
  description?: string;
  priority?: TaskPriority;
}

export interface DecompositionResult {
  goal: string;
  tasks: DecompositionResultItem[];
}

// --- Client types ---

export type ClientStatus = "active" | "inactive" | "archived";

export interface Client {
  id: string;
  workspaceId: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ClientWithTaskCount extends Client {
  _count: { tasks: number };
}

export interface ClientDetail extends Client {
  _count: { tasks: number };
  recentTasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    updatedAt: string;
  }[];
}

export interface CreateClientInput {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  notes?: string;
  status?: ClientStatus;
}

export interface UpdateClientInput {
  name?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: ClientStatus;
}

// --- Ledger types ---

export type LedgerEntryType = "income" | "expense";
export type AttachmentType = "invoice" | "receipt";

export interface LedgerEntry {
  id: string;
  workspaceId: string;
  type: LedgerEntryType;
  amount: number;
  currency: string;
  clientId: string | null;
  taskId: string | null;
  category: string | null;
  description: string;
  attachmentType: AttachmentType | null;
  attachmentUrl: string | null;
  notes: string | null;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntryWithClient extends LedgerEntry {
  client: { id: string; name: string; company: string | null } | null;
  task?: { id: string; title: string } | null;
}

export interface LedgerSummary {
  totalIncome: number;
  totalExpense: number;
  net: number;
}

export interface CreateLedgerEntryInput {
  type: LedgerEntryType;
  amount: number;
  currency?: string;
  clientId?: string;
  taskId?: string;
  category?: string;
  description: string;
  attachmentType?: AttachmentType;
  attachmentUrl?: string;
  notes?: string;
  entryDate?: string;
}

export interface UpdateLedgerEntryInput {
  type?: LedgerEntryType;
  amount?: number;
  currency?: string;
  clientId?: string | null;
  taskId?: string | null;
  category?: string | null;
  description?: string;
  attachmentType?: AttachmentType | null;
  attachmentUrl?: string | null;
  notes?: string | null;
  entryDate?: string;
}

// --- Recurring Rule types ---

export type RecurringFrequency = "hourly" | "daily" | "weekly" | "monthly";

export interface RecurringRule {
  id: string;
  workspaceId: string;
  title: string;
  frequency: RecurringFrequency;
  interval: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number | null;
  minute: number | null;
  startDate: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  isActive: boolean;
  templateId: string | null;
  clientId: string | null;
  agentId: string | null;
  presetData: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringRuleWithClient extends RecurringRule {
  client: { id: string; name: string } | null;
}

export interface CreateRecurringRuleInput {
  title: string;
  frequency: RecurringFrequency;
  interval?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  hour?: number;
  minute?: number;
  startDate?: string;
  clientId?: string;
  agentId?: string;
  templateId?: string;
  presetData?: { description?: string; priority?: TaskPriority };
}

export interface UpdateRecurringRuleInput {
  title?: string;
  frequency?: RecurringFrequency;
  interval?: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  hour?: number | null;
  minute?: number | null;
  startDate?: string | null;
  clientId?: string | null;
  agentId?: string | null;
  templateId?: string | null;
  presetData?: { description?: string; priority?: TaskPriority } | null;
  isActive?: boolean;
}

// --- Inbox types ---

export type InboxItemStatus =
  | "inbox"
  | "clarified"
  | "processed"
  | "snoozed"
  | "draft";
export type InboxItemKind = "idea" | "request" | "follow_up" | "reminder" | "email";
export type InboxItemSource =
  | "manual"
  | "agent"
  | "system"
  | "client"
  | "email"
  | "compose";
export type InboxUrgency = "low" | "medium" | "high" | "critical";
export type InboxSuggestedAction =
  | "create_task"
  | "break_down"
  | "snooze"
  | "approve_draft"
  | "reply"
  | "delegate"
  | "forward"
  | null;
export type InboxActionTaken =
  | "approved"
  | "delegated"
  | "replied"
  | "converted"
  | "snoozed"
  | "archived";

export interface InboxItem {
  id: string;
  content: string;
  status: InboxItemStatus;
  kind: InboxItemKind | null;
  source: InboxItemSource;
  snoozedUntil: string | null;
  convertedTaskId: string | null;
  convertedGroupId: string | null;
  workspaceId: string | null;
  // Email metadata
  emailMessageId: string | null;
  emailFrom: string | null;
  emailTo: string | null;
  emailCc: string | null;
  emailBcc: string | null;
  emailSubject: string | null;
  emailDate: string | null;
  emailThreadId: string | null;
  emailInReplyTo: string | null;
  emailLabels: string | null;
  emailIsRead: boolean;
  attachmentsJson: string | null;
  // AI triage context
  aiSummary: string | null;
  aiUrgency: InboxUrgency | null;
  aiSuggestedAction: InboxSuggestedAction;
  aiDraftReply: string | null;
  // Action tracking
  actionTaken: InboxActionTaken | null;
  actionAgentId: string | null;
  linkedClientId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInboxItemInput {
  content: string;
  kind?: InboxItemKind;
  source?: InboxItemSource;
  // Email fields
  emailMessageId?: string;
  emailFrom?: string;
  emailTo?: string;
  emailSubject?: string;
  emailDate?: string;
  emailThreadId?: string;
  emailInReplyTo?: string;
  emailLabels?: string;
  // AI fields
  aiSummary?: string;
  aiUrgency?: InboxUrgency;
  aiSuggestedAction?: InboxSuggestedAction;
  aiDraftReply?: string;
}

export interface UpdateInboxItemInput {
  content?: string;
  status?: InboxItemStatus;
  kind?: InboxItemKind | null;
  snoozedUntil?: string | null;
  convertedTaskId?: string | null;
  convertedGroupId?: string | null;
  emailIsRead?: boolean;
  actionTaken?: InboxActionTaken;
  actionAgentId?: string | null;
  linkedClientId?: string | null;
  aiDraftReply?: string | null;
}

// --- Email compose types ---

export interface EmailDraftAttachment {
  path: string;
  fileName: string;
  mediaType: string;
  size: number;
}

export interface EmailPatch {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  send?: boolean;
}

export interface CreateEmailDraftInput {
  workspaceId: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
}

export interface UpdateEmailDraftInput {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  attachments?: EmailDraftAttachment[];
}

export interface ComposeEmailInput {
  workspaceId: string;
  agentId: string;
  draftId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}

export interface InboxActionInput {
  action:
    | "approve_draft"
    | "delegate"
    | "reply"
    | "convert_task"
    | "snooze"
    | "archive"
    | "forward";
  editedDraft?: string;
  agentId?: string;
  replyContent?: string;
  taskTitle?: string;
  taskDescription?: string;
  taskAgentId?: string;
  taskPriority?: string;
  snoozeUntil?: string;
  forwardTo?: string;
  clientId?: string;
}

// --- Note types ---

export interface Note {
  id: string;
  workspaceId: string;
  title: string;
  contentMarkdown: string;
  clientId: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoteWithLinks extends Note {
  outgoingLinks: string[];
  backlinks: { id: string; title: string }[];
  client?: { id: string; name: string } | null;
}

export interface CreateNoteInput {
  title: string;
  contentMarkdown?: string;
  clientId?: string;
}

export interface UpdateNoteInput {
  title?: string;
  contentMarkdown?: string;
  clientId?: string | null;
  isArchived?: boolean;
}

// --- Adapter interface ---

export interface OpenClawAdapter {
  listAgents(workspaceId?: string): Promise<AgentSummary[]>;
  getAgent(id: string): Promise<AgentDetail | null>;
  getAgentTokenUsage(id: string): Promise<AgentTokenUsage>;
  createAgent(data: CreateAgentInput): Promise<Agent>;
  updateAgent(id: string, data: UpdateAgentInput): Promise<Agent>;
  deleteAgent(id: string): Promise<void>;
  restoreAgent(id: string): Promise<Agent>;
  enableAgent(id: string): Promise<Agent>;
  disableAgent(id: string): Promise<Agent>;

  listSkills(): Promise<Skill[]>;
  getAgentSkills(agentId: string): Promise<AgentSkill[]>;
  getSkillRecommendations(agentId: string): Promise<Skill[]>;
  installSkill(agentId: string, skillId: string): Promise<AgentSkill>;
  uninstallSkill(agentId: string, skillId: string): Promise<void>;

  listTasks(filters?: TaskFilters): Promise<TaskWithAgent[]>;
  getTask(id: string): Promise<TaskDetail | null>;
  getTaskLogs(taskId: string): Promise<TaskLog[]>;
  createTask(data: CreateTaskInput): Promise<Task>;
  updateTask(id: string, data: UpdateTaskInput): Promise<Task>;
  updateTaskStatus(id: string, status: TaskStatus): Promise<Task>;

  getDashboardSummary(workspaceId: string): Promise<DashboardSummary>;

  getKanbanSummary(workspaceId: string): Promise<KanbanSummary>;
  getKanbanByDate(date: string, workspaceId: string, timezone?: string): Promise<KanbanDateResponse>;
  getKanbanTimingMetrics(workspaceId: string, date: string, timezone?: string): Promise<KanbanTimingMetrics>;
  startTask(id: string): Promise<Task>;
  acceptTask(id: string, notes?: string): Promise<Task>;
  retryTask(id: string, notes?: string, overrideInstruction?: string): Promise<Task>;
  followUpTask(id: string, data: CreateFollowUpInput): Promise<FollowUpResult>;
  getTaskReview(id: string): Promise<TaskReviewPayload | null>;
  updatePlannedDate(id: string, date: string | null): Promise<Task>;
  toggleFocus(id: string, isFocus: boolean): Promise<Task>;

  listAgentTemplates(): Promise<AgentTemplate[]>;
  getAgentTemplate(id: string): Promise<AgentTemplateDetail | null>;
  createAgentFromTemplate(data: CreateAgentFromTemplateInput): Promise<Agent>;

  createTaskGroupFromDecomposition(taskId: string, input: CreateTaskGroupFromDecompositionInput): Promise<CreateTaskGroupResult>;
  getTaskGroup(id: string): Promise<TaskGroupDetail | null>;
  listTaskGroups(workspaceId?: string): Promise<TaskGroup[]>;

  syncExecutionSteps(taskId: string, input: SyncExecutionStepsInput): Promise<TaskExecutionStep[]>;

  listTaskTemplates(workspaceId?: string): Promise<TaskTemplate[]>;
  getTaskTemplate(id: string): Promise<TaskTemplate | null>;
  createTaskFromTemplate(data: CreateTaskFromTemplateInput): Promise<Task>;
  saveTaskTemplate(data: SaveTaskTemplateInput): Promise<TaskTemplate>;
  saveTemplateFromTask(taskId: string, input?: SaveTemplateFromTaskInput): Promise<TaskTemplate>;
  deleteTaskTemplate(id: string): Promise<void>;
}

// --- Skill Advisor types ---

export interface SkillAdvice {
  installedSkills: Skill[];
  recommendedSkills: Skill[];
  missingSkills: MissingSkill[];
}

export interface MissingSkill {
  key: string;
  name: string;
  description: string;
}

export interface CreateSkillDraftInput {
  key: string;
  name: string;
  description: string;
  agentRole: string;
  inputs?: string[];
  outputs?: string[];
}

export interface CreateSkillDraftOutput {
  success: boolean;
  skillPath: string;
  files: string[];
}

// --- Agent Template types ---

export type AgentTemplateCategory =
  | "research"
  | "content"
  | "assistant"
  | "operations"
  | "support"
  | "sales";

export interface AgentTemplate {
  id: string;
  key: string;
  name: string;
  role: string;
  category: AgentTemplateCategory;
  description: string;
  defaultModel: string;
  responsibilitiesSummary: string;
  suggestedSkillKeys: string[];
  isBuiltIn: boolean;
  /** Default SOUL.md content for the template */
  defaultSoul?: string;
  /** Default AGENTS.md content for the template */
  defaultAgentConfig?: string;
  /** Default IDENTITY.md content for the template */
  defaultIdentity?: string;
  /** Default TOOLS.md content for the template */
  defaultTools?: string;
  /** Default USER.md content for the template */
  defaultUser?: string;
  /** Default HEARTBEAT.md content for the template */
  defaultHeartbeat?: string;
  /** Default BOOTSTRAP.md content for the template */
  defaultBootstrap?: string;
}

export interface AgentTemplateDetail extends AgentTemplate {
  suggestedSkills: Skill[];
}

export interface CreateAgentFromTemplateInput {
  templateId: string;
  name: string;
  description?: string;
  model?: string;
  skillIds?: string[];
  responsibilitiesSummary?: string;
  workspaceId?: string;
  /** Custom SOUL.md content (overrides template default) */
  soul?: string;
  /** Custom AGENTS.md content (overrides template default) */
  agentConfig?: string;
  /** Custom IDENTITY.md content (overrides template default) */
  identity?: string;
  /** Custom TOOLS.md content (overrides template default) */
  tools?: string;
  /** Custom USER.md content (overrides template default) */
  user?: string;
  /** Custom HEARTBEAT.md content (overrides template default) */
  heartbeat?: string;
  /** Custom BOOTSTRAP.md content (overrides template default) */
  bootstrap?: string;
}

// --- Task Template types ---

export type TaskTemplateCategory =
  | "research"
  | "reporting"
  | "content"
  | "operations"
  | "sales";

export interface TaskTemplate {
  id: string;
  key: string;
  name: string;
  category: TaskTemplateCategory;
  description: string;
  suggestedAgentRoles: string[];
  defaultTitle: string;
  defaultDescription: string;
  defaultTags: string[];
  defaultAgentId?: string | null;
  defaultPriority?: TaskPriority;
  sourceTaskId?: string | null;
  workspaceId?: string | null;
  isBuiltIn: boolean;
}

export interface CreateTaskFromTemplateInput {
  templateId: string;
  title?: string;
  description?: string;
  agentId?: string;
  priority?: TaskPriority;
  plannedDate?: string;
}

export interface SaveTaskTemplateInput {
  name: string;
  category: TaskTemplateCategory;
  description: string;
  suggestedAgentRoles: string[];
  defaultTitle: string;
  defaultDescription: string;
  defaultTags: string[];
  defaultAgentId?: string | null;
  defaultPriority?: TaskPriority;
  workspaceId?: string;
}

export interface SaveTemplateFromTaskInput {
  name?: string;
}

// --- Input types ---

export interface CreateAgentInput {
  name: string;
  role: string;
  description?: string;
  model?: string;
  soul?: string;
  agentConfig?: string;
  identity?: string;
  user?: string;
  tools?: string;
  heartbeat?: string;
  bootstrap?: string;
  workspaceId?: string;
}

export interface UpdateAgentInput {
  name?: string;
  role?: string;
  description?: string;
  model?: string;
  maxConcurrent?: number;
  soul?: string | null;
  agentConfig?: string | null;
  identity?: string | null;
  user?: string | null;
  tools?: string | null;
  heartbeat?: string | null;
  bootstrap?: string | null;
}

export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  agentId?: string;
  workspaceId?: string;
  archived?: string;
  q?: string;
  sort?: string;
  limit?: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  taskType?: TaskType;
  agentId: string;
  priority?: TaskPriority;
  plannedDate?: string;
  sourceTaskId?: string;
  clientId?: string;
  attachments?: ChatAttachment[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  agentId?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  plannedDate?: string | null;
  waitingReason?: WaitingReason | null;
  blockingQuestion?: string | null;
  blockedByTaskId?: string | null;
  clientId?: string | null;
  recurringRuleId?: string | null;
}

export interface UpdateTaskStatusInput {
  status: TaskStatus;
}

export interface CreateFollowUpInput {
  title?: string;
  description?: string;
  agentId?: string;
  priority?: TaskPriority;
  plannedDate?: string;
}

export interface FollowUpResult {
  sourceTask: Task;
  followUpTask: Task;
}

export interface TaskReviewPayload {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  reviewStatus: ReviewStatus | null;
  resultSummary: string | null;
  resultContent: string | null;
  agent: { id: string; name: string } | null;
  finishedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  sourceTaskId: string | null;
}
