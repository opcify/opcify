# API Reference

Complete endpoint reference for the Opcify API (Fastify, port 4210).

Most data routes are workspace-scoped and live under `/workspaces/:workspaceId/...`. Auth accepts either a `Authorization: Bearer <jwt>` header or, for browser navigations that can't set headers (SSE, file downloads), a `?_token=<jwt>` query parameter fallback.

---

## Workspaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces` | List all workspaces |
| `GET` | `/workspaces/archived` | List archived workspaces |
| `GET` | `/workspaces/default` | Get default workspace |
| `POST` | `/workspaces` | Create a workspace |
| `GET` | `/workspaces/:id` | Get workspace by ID |
| `PATCH` | `/workspaces/:id` | Update workspace |
| `POST` | `/workspaces/:id/provision` | Provision from template |
| `POST` | `/workspaces/:id/archive` | Archive workspace |
| `POST` | `/workspaces/:id/restore-archive` | Restore an archived workspace |
| `POST` | `/workspaces/:id/set-default` | Set as default workspace |
| `GET` | `/workspaces/:id/docker-status` | Docker gateway status for workspace |
| `GET` | `/workspaces/:id/export` | Export workspace snapshot |
| `POST` | `/workspaces/:id/save-as-template` | Save as reusable template |
| `GET` | `/workspaces/:id/backup` | Export full JSON backup |
| `GET` | `/workspaces/:id/backup-db` | Export raw SQLite DB |
| `POST` | `/workspaces/restore` | Restore from JSON backup (creates new workspace) |
| `POST` | `/workspaces/restore-db` | Restore from raw SQLite DB |
| `GET` | `/workspaces/:id/api-key` | Get the per-workspace `OPCIFY_API_KEY` |
| `POST` | `/workspaces/:id/api-key/regenerate` | Rotate the per-workspace API key |

## Tasks

All task routes are workspace-scoped except the OpenClaw callback sync route, which is intentionally kept at root so the runtime can report back without a user context.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces/:workspaceId/tasks` | List tasks (with filters) |
| `POST` | `/workspaces/:workspaceId/tasks` | Create a task |
| `GET` | `/workspaces/:workspaceId/tasks/:id` | Get task by ID |
| `PATCH` | `/workspaces/:workspaceId/tasks/:id` | Update task |
| `PATCH` | `/workspaces/:workspaceId/tasks/:id/status` | Update task status |
| `GET` | `/workspaces/:workspaceId/tasks/:id/logs` | Get task logs |
| `POST` | `/workspaces/:workspaceId/tasks/:id/start` | Dispatch to OpenClaw |
| `POST` | `/workspaces/:workspaceId/tasks/:id/stop` | Stop a running task |
| `POST` | `/workspaces/:workspaceId/tasks/:id/archive` | Archive task |
| `POST` | `/workspaces/:workspaceId/tasks/:id/unarchive` | Unarchive task |
| `GET` | `/workspaces/:workspaceId/tasks/:id/review` | Get review payload |
| `POST` | `/workspaces/:workspaceId/tasks/:id/accept` | Accept review |
| `POST` | `/workspaces/:workspaceId/tasks/:id/retry` | Retry task |
| `POST` | `/workspaces/:workspaceId/tasks/:id/follow-up` | Create follow-up task |
| `POST` | `/tasks/:id/execution-steps/sync` | Sync execution steps (OpenClaw callback) |

## Agents

All agent routes are workspace-scoped. Skill install/remove routes live under the (non-scoped) Skills section below.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces/:workspaceId/agents` | List agents |
| `GET` | `/workspaces/:workspaceId/agents/:id` | Get agent detail |
| `POST` | `/workspaces/:workspaceId/agents` | Create agent |
| `PATCH` | `/workspaces/:workspaceId/agents/:id` | Update agent (supports `soul`, `agentConfig`, `identity`, `tools`, `user`, `bootstrap`, `heartbeat` — the 7 OpenClaw bootstrap files) |
| `DELETE` | `/workspaces/:workspaceId/agents/:id` | Delete agent |
| `POST` | `/workspaces/:workspaceId/agents/:id/enable` | Enable a disabled agent |
| `POST` | `/workspaces/:workspaceId/agents/:id/disable` | Disable an active agent |
| `POST` | `/workspaces/:workspaceId/agents/:id/restore` | Restore a deleted agent |
| `GET` | `/workspaces/:workspaceId/agents/:id/token-usage` | Get token usage totals |

## Skills

Skill catalog is global; install/remove actions target a specific agent.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/skills` | List skill catalog |
| `GET` | `/agents/:id/skills` | List skills installed on an agent |
| `GET` | `/agents/:id/skills/recommendations` | Recommended skills for this agent |
| `POST` | `/agents/:id/skills/install` | Install skill on agent |
| `DELETE` | `/agents/:id/skills/:skillId` | Remove skill from agent |
| `GET` | `/agents/:id/skills/advice` | Skill advisor recommendations |
| `POST` | `/skills/create-draft` | Create a new skill draft |

## Kanban

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces/:workspaceId/kanban?date=YYYY-MM-DD` | Kanban for a specific date |
| `GET` | `/workspaces/:workspaceId/kanban/summary` | Today's kanban summary |
| `GET` | `/workspaces/:workspaceId/kanban/stats` | Aggregated kanban stats |

## Auth

User login uses a full-page Google OAuth 2.0 authorization-code redirect (requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a configured `redirectUri`). Workspace Gmail connections are a separate OAuth flow — users connect a Gmail account per workspace for the inbox module.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/google` | Exchange Google auth code for JWT |
| `POST` | `/auth/register` | Email/password signup |
| `POST` | `/auth/login` | Email/password login |
| `POST` | `/auth/logout` | Invalidate session (client-side token clear) |
| `GET` | `/auth/me` | Get current user profile |
| `PATCH` | `/auth/me` | Update user profile |
| `POST` | `/auth/gmail/connect` | Connect a Gmail account for inbox send/receive |
| `GET` | `/auth/gmail/status` | Check Gmail connection status |
| `POST` | `/auth/gmail/disconnect` | Disconnect Gmail account |

## Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/workspaces/:workspaceId/chat/:agentId/send` | Send message to agent |
| `GET` | `/workspaces/:workspaceId/chat/:agentId/stream` | SSE stream for chat events (accepts `?_token=<jwt>` for EventSource) |
| `GET` | `/workspaces/:workspaceId/chat/:agentId/history` | Get chat history |
| `POST` | `/workspaces/:workspaceId/chat/:agentId/abort` | Stop active generation |
| `POST` | `/workspaces/:workspaceId/chat/:agentId/reset` | Reset chat session |

## Notes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/notes` | List notes (search, archive filter) |
| `POST` | `/notes` | Create a note |
| `GET` | `/notes/templates` | List note templates |
| `POST` | `/notes/daily` | Get or create daily note |
| `POST` | `/notes/from-template` | Create note from template |
| `GET` | `/notes/:id` | Get note with link analysis |
| `PATCH` | `/notes/:id` | Update note |
| `DELETE` | `/notes/:id` | Delete note |
| `GET` | `/notes/:id/backlinks` | Get backlinks for a note |

## Archives

Archives are hybrid local + cloud storage. Each listing merges the on-disk workspace volume with any configured cloud bucket (S3, R2, or GCS) and marks each entry as `local`, `cloud`, or `synced`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces/:workspaceId/archives?path=<rel>` | List files/folders at path |
| `GET` | `/workspaces/:workspaceId/archives/download?path=<rel>` | Download or preview a file (accepts `?_token=<jwt>` for browser navigation; `&inline=1` for preview) |
| `POST` | `/workspaces/:workspaceId/archives/upload` | Upload files (base64, max 20) |
| `POST` | `/workspaces/:workspaceId/archives/folder` | Create folder |
| `DELETE` | `/workspaces/:workspaceId/archives?path=<rel>` | Delete file or folder |
| `POST` | `/workspaces/:workspaceId/archives/share` | Generate expiring share link |
| `POST` | `/workspaces/:workspaceId/archives/sync` | Sync local file/folder to cloud |
| `PATCH` | `/workspaces/:workspaceId/archives/move` | Move or rename file/folder |

## Inbox

Workspace-scoped inbox with Gmail-style threaded conversations, draft management, and Gmail OAuth send/receive.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces/:workspaceId/inbox` | List inbox items (supports filters) |
| `GET` | `/workspaces/:workspaceId/inbox/stats` | Inbox unread/pending counts |
| `GET` | `/workspaces/:workspaceId/inbox/:id` | Get inbox item detail |
| `GET` | `/workspaces/:workspaceId/inbox/:id/thread` | Get full conversation thread |
| `POST` | `/workspaces/:workspaceId/inbox` | Create inbox item |
| `PATCH` | `/workspaces/:workspaceId/inbox/:id` | Update inbox item |
| `DELETE` | `/workspaces/:workspaceId/inbox/:id` | Delete inbox item |
| `POST` | `/workspaces/:workspaceId/inbox/:id/action` | Act on item (reply, snooze, convert to task, etc.) |
| `POST` | `/workspaces/:workspaceId/inbox/batch` | Batch action across multiple items |
| `GET` | `/workspaces/:workspaceId/inbox/drafts` | List compose drafts |
| `POST` | `/workspaces/:workspaceId/inbox/drafts` | Create a draft |
| `GET` | `/workspaces/:workspaceId/inbox/drafts/:id` | Get draft detail |
| `PATCH` | `/workspaces/:workspaceId/inbox/drafts/:id` | Update draft |
| `DELETE` | `/workspaces/:workspaceId/inbox/drafts/:id` | Delete draft |
| `POST` | `/workspaces/:workspaceId/inbox/drafts/:id/attachments` | Attach files to draft |
| `POST` | `/workspaces/:workspaceId/inbox/compose` | Send composed message (via Gmail if connected, else local) |
| `POST` | `/workspaces/:workspaceId/inbox/cleanup-empty-drafts` | Remove empty/stale drafts |

## Agent Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/agent-templates` | List agent templates |
| `GET` | `/agent-templates/:id` | Get template detail |
| `POST` | `/agent-templates/:id/create-agent` | Create agent from template |

## Task Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/task-templates` | List task templates |
| `GET` | `/task-templates/:id` | Get template detail |
| `POST` | `/task-templates/:id/create-task` | Create task from template |
| `POST` | `/task-templates` | Save custom template |
| `POST` | `/task-templates/from-task/:taskId` | Create template from task |
| `DELETE` | `/task-templates/:id` | Delete template |

## Task Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/task-groups/from-decomposition/:taskId` | Decompose task into group |
| `GET` | `/task-groups` | List task groups |
| `GET` | `/task-groups/:id` | Get task group detail |

## Recurring

Recurring rules auto-generate tasks on a schedule (hourly/daily/weekly/monthly). A background scheduler runs every 60 seconds and dispatches any due rules.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/recurring` | List recurring rules |
| `GET` | `/recurring/:id` | Get recurring rule |
| `POST` | `/recurring` | Create recurring rule |
| `PATCH` | `/recurring/:id` | Update recurring rule |
| `DELETE` | `/recurring/:id` | Delete recurring rule |
| `POST` | `/recurring/trigger` | Manually trigger the scheduler |

## Clients

All client endpoints are scoped under `/workspaces/:workspaceId/`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces/:workspaceId/clients` | List clients |
| `POST` | `/workspaces/:workspaceId/clients` | Create client |
| `PATCH` | `/workspaces/:workspaceId/clients/:id` | Update client |

## Ledger

All ledger endpoints are scoped under `/workspaces/:workspaceId/`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces/:workspaceId/ledger` | List ledger entries |
| `POST` | `/workspaces/:workspaceId/ledger` | Create entry |
| `PATCH` | `/workspaces/:workspaceId/ledger/:id` | Update entry |

## Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/dashboard/summary?workspaceId=<id>` | Workspace dashboard metrics (kept at root path; requires `Authorization: Bearer <jwt\|workspace-api-key>`) |

## Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/events/tasks` | SSE stream for task events |

## OpenClaw Config

All OpenClaw config endpoints are scoped under `/workspaces/:workspaceId/`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces/:workspaceId/openclaw/config` | Read OpenClaw configuration |
| `GET` | `/workspaces/:workspaceId/openclaw/status` | OpenClaw status check |
| `POST` | `/workspaces/:workspaceId/openclaw/gateway/start` | Start the gateway container on demand |
| `GET` | `/workspaces/:workspaceId/openclaw/config/telegram` | Get Telegram channel config |
| `POST` | `/workspaces/:workspaceId/openclaw/config/telegram` | Save Telegram configuration |
| `DELETE` | `/workspaces/:workspaceId/openclaw/config/telegram/:accountId` | Remove a Telegram account |
| `POST` | `/workspaces/:workspaceId/openclaw/pairing/telegram` | Request a Telegram pairing code |
| `POST` | `/workspaces/:workspaceId/openclaw/pairing/telegram/approve` | Approve a pending Telegram pairing |
| `GET` | `/workspaces/:workspaceId/openclaw/bindings/telegram` | List Telegram chat bindings |

## OpenClaw Capabilities

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/workspaces/:workspaceId/openclaw/capabilities` | List workspace capabilities |
| `GET` | `/workspaces/:workspaceId/openclaw/managed-skills` | List managed skills |
| `GET` | `/workspaces/:workspaceId/openclaw/skills` | List installed skills |
| `POST` | `/workspaces/:workspaceId/openclaw/skills/install` | Install skill by slug |
| `POST` | `/workspaces/:workspaceId/openclaw/skills/uninstall` | Uninstall skill |
| `POST` | `/workspaces/:workspaceId/openclaw/skills/update-all` | Update all installed skills |
| `POST` | `/workspaces/:workspaceId/openclaw/skills/:skillName/toggle` | Enable/disable a skill |
| `GET` | `/workspaces/:workspaceId/openclaw/skills/:skillName/config` | Get per-skill config |
| `PATCH` | `/workspaces/:workspaceId/openclaw/skills/:skillName/config` | Update per-skill config |
| `GET` | `/managed-skills/catalog` | Global managed skill catalog |

## System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health check |
