# Database Schema

Opcify uses SQLite with Prisma ORM. The schema is defined in `prisma/schema.prisma`.

---

## Models (16)

| Model | Purpose |
|-------|---------|
| `User` | Authentication and user profile (Google OAuth, email/password) |
| `Workspace` | Container for all workspace-scoped entities |
| `WorkspaceTemplate` | Reusable workspace configuration templates |
| `Agent` | AI agents with model, soul, config, and identity |
| `AgentSkill` | Many-to-many relationship between agents and skills |
| `Skill` | Entries in the skill catalog |
| `Task` | Individual tasks with status, priority, and execution mode |
| `TaskTemplate` | Reusable task patterns with agent role suggestions |
| `TaskGroup` | Groups of related tasks (e.g., decomposition results) |
| `TaskExecutionStep` | Step-by-step execution history with output |
| `TaskLog` | Debug logs per task |
| `Client` | Customer/project entities |
| `LedgerEntry` | Income/expense records linked to clients and tasks |
| `RecurringRule` | Schedules for automatic task generation |
| `InboxItem` | Quick captures with status and snooze support |
| `Note` | Wiki-style markdown notes with client linking |

All models include `createdAt` and `updatedAt` timestamps.

---

## Key Relationships

```
User ──1:N──▶ Workspace
Workspace ──1:N──▶ Agent, Task, TaskGroup, TaskTemplate,
                    InboxItem, Client, LedgerEntry,
                    RecurringRule, Note

Agent ──M:N──▶ Skill        (via AgentSkill)
Agent ──1:N──▶ Task

Task ──1:N──▶ TaskExecutionStep
Task ──1:N──▶ TaskLog
Task ──1:1──▶ Task          (follow-up via sourceTaskId)
Task ──N:1──▶ TaskGroup
Task ──N:1──▶ Client
Task ──N:1──▶ RecurringRule

Client ──1:N──▶ Task, LedgerEntry, RecurringRule, Note
```

---

## Status Enums

| Model | Field | Values |
|-------|-------|--------|
| Workspace | `status` | `draft`, `provisioning`, `ready`, `failed`, `archived` |
| Agent | `status` | `idle`, `running`, `blocked`, `error`, `disabled` |
| Task | `status` | `queued`, `running`, `waiting`, `done`, `failed` |
| Task | `reviewStatus` | `pending`, `accepted`, `rejected`, `followed_up` |
| Task | `executionMode` | `single`, `manual_workflow`, `orchestrated` |
| Task | `priority` | `high`, `medium`, `low` |
| InboxItem | `status` | `inbox`, `clarified`, `processed`, `snoozed` |
| Client | `status` | `active`, `inactive`, `archived` |
| LedgerEntry | `type` | `income`, `expense` |
| RecurringRule | `frequency` | `weekly`, `monthly` |
| TaskExecutionStep | `status` | `pending`, `running`, `completed`, `failed` |

---

## Adapter Modes

Opcify supports two persistence backends:

- **`prisma` (default)** — SQLite via Prisma ORM. Recommended for development and production. All models above are stored in a single `opcify.db` file.
- **`filesystem`** — JSON file-based persistence. Useful for debugging or when you want human-readable data files. Set `ADAPTER_MODE=filesystem` and provide `OPENCLAW_WORKSPACE`.

---

## Database Commands

| Command | Description |
|---------|-------------|
| `pnpm db:generate` | Generate Prisma client from schema |
| `pnpm db:push` | Sync schema to database (no migration) |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:studio` | Open Prisma Studio GUI |
