export interface ExpectedSkill {
  key: string;
  name: string;
  description: string;
}

const roleSkills: Record<string, ExpectedSkill[]> = {
  research: [
    { key: "web-search", name: "Web Search", description: "Search the web for information" },
    { key: "summarize", name: "Summarize", description: "Summarize long text and documents" },
    { key: "notes", name: "Notes", description: "Create and manage research notes" },
  ],
  general: [
    { key: "summarize", name: "Summarize", description: "Summarize long text and documents" },
    { key: "write-doc", name: "Write Document", description: "Draft and edit documents" },
    { key: "inbox-helper", name: "Inbox Helper", description: "Process and triage inbox messages" },
  ],
  coding: [
    { key: "code-exec", name: "Code Execution", description: "Execute code in a sandboxed environment" },
    { key: "github", name: "GitHub", description: "Interact with GitHub repositories and issues" },
    { key: "file-ops", name: "File Operations", description: "Read, write, and manage files" },
  ],
  ops: [
    { key: "task-runner", name: "Task Runner", description: "Execute and monitor system tasks" },
    { key: "file-ops", name: "File Operations", description: "Read, write, and manage files" },
    { key: "scheduler-helper", name: "Scheduler Helper", description: "Manage cron jobs and scheduled tasks" },
  ],
  content: [
    { key: "write-doc", name: "Write Document", description: "Draft and edit documents" },
    { key: "summarize", name: "Summarize", description: "Summarize long text and documents" },
    { key: "publish-helper", name: "Publish Helper", description: "Publish content to various platforms" },
  ],
  assistant: [
    { key: "summarize", name: "Summarize", description: "Summarize long text and documents" },
    { key: "write-doc", name: "Write Document", description: "Draft and edit documents" },
    { key: "inbox-helper", name: "Inbox Helper", description: "Process and triage inbox messages" },
  ],
};

export function getExpectedSkills(role: string): ExpectedSkill[] {
  const normalized = role.toLowerCase().trim();
  for (const [key, skills] of Object.entries(roleSkills)) {
    if (normalized.includes(key)) return skills;
  }
  return roleSkills.general;
}
