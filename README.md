# Opcify

Open source AI workspace platform powered by [OpenClaw](https://github.com/openclaw/openclaw). Released under the [MIT License](LICENSE).

> **OpenClaw** = runtime / intelligence / execution engine
> **Opcify** = control plane / workspace management / UI / state

Opcify creates tasks and dispatches them to OpenClaw for execution. OpenClaw sends step-by-step execution updates back to Opcify via the sync API. Opcify persists all state and drives the UI.

## Quick Start

```bash
cp .env.example .env
pnpm install
pnpm db:generate && pnpm db:push && pnpm db:seed
pnpm dev
```

Web: http://localhost:3210 · API: http://localhost:4210

---

## Architecture

> See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design, data flow diagrams, and design decisions.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind CSS 4, TypeScript |
| Backend | Fastify 5, Prisma 6, Zod |
| Database | SQLite (default) or JSON filesystem |
| AI Client | OpenAI SDK (GPT-5.4, Claude, Gemini, DeepSeek, MiniMax, and custom providers) |
| Monorepo | pnpm workspaces, tsup, Vitest |

### Monorepo Structure

```
opcify/
├── apps/
│   ├── web/                  Next.js frontend (port 3210)
│   │   └── src/
│   │       ├── app/          App Router pages & layouts
│   │       ├── components/   Reusable React components
│   │       └── lib/          API client, hooks, utilities
│   └── api/                  Fastify backend (port 4210)
│       └── src/
│           ├── index.ts      Server entry point
│           ├── db.ts         Prisma client
│           ├── logger.ts     Structured logging
│           ├── modules/      Feature modules (24 modules)
│           └── workspace/    Docker workspace lifecycle
├── packages/
│   └── core/                 Shared TypeScript types
├── prisma/
│   ├── schema.prisma         Database schema (16 models)
│   └── seed.ts               Demo data seeding
├── templates/
│   ├── workspaces/           8 built-in workspace templates
│   ├── agents/               6 agent templates
│   ├── skills/               12 skill templates
│   └── tasks/                8 task templates
├── docker/                   Docker configs & dev services
├── docker-compose.yml        Docker deployment
├── tests/                    Integration test scripts
└── scripts/
    └── seed-workspace.ts     Workspace seeding utility
```

---

## Features

### Workspace Management
- Create workspaces from **8 built-in templates** (Opcify Starter, Content Creator Studio, E-Commerce, Investing & Trading, Real Estate, Software, Tradie Business, Training & Tutoring)
- Multi-workspace support with a configurable default workspace
- **Provisioning engine** that bootstraps agents, skills, and demo data from templates
- **Backup & restore** with full workspace export/import (all IDs remapped on restore)
- Archive workspaces or save them as reusable templates

### Task Management
- Full task lifecycle: `queued` &rarr; `running` &rarr; `waiting` &rarr; `done` / `failed`
- Review workflow: `pending` &rarr; `accepted` / `rejected` / `followed_up`
- Priority levels (high, medium, low), planned/scheduled dates
- Task decomposition into subtasks and task groups
- Task templates, follow-ups, and blocking relationships
- Execution modes: single, manual workflow, orchestrated

### Agent System
- Create custom AI agents with configurable LLM models
- Edit all 7 OpenClaw bootstrap files per agent from the agent detail page: `SOUL.md`, `AGENTS.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`
- System agents (built-in, non-editable) and custom agents
- Status tracking: idle, running, blocked, error, disabled
- Token usage monitoring per agent

### Skills
- Skill catalog with categories
- Install/uninstall skills per agent
- Skill advisor recommends capabilities based on agent role and task type

### Task Execution (OpenClaw Integration)
- Dispatch tasks to OpenClaw (real) or a built-in mock executor
- Track execution step-by-step with detailed status and output
- Each step captures: agent, role, instruction, output summary, and full content
- Real-time progress sync via `POST /tasks/:id/execution-steps/sync`

### Kanban & Daily Planning
- Daily kanban board grouped by task status
- Status badges, progress indicators, quick-start actions (Start, Accept, Retry, Follow-up)
- Date-scoped task filtering

### Clients & Projects
- Client management (name, company, contact info, notes)
- Link clients to tasks and ledger entries
- Status: active, inactive, archived

### Financial Ledger
- Record income and expense entries
- Link entries to clients and tasks
- Attachment support (invoices, receipts) with currency tracking

### Recurring Tasks
- Define recurring rules (weekly, monthly) with configurable schedules
- Auto-generation of tasks on schedule, linked to clients and presets

### Authentication
- Google OAuth login via full-page authorization-code redirect (requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and a configured redirect URI)
- Email/password registration and login
- JWT-based sessions with user profile management (name, timezone)
- Workspace-scoped auth: routes live under `/workspaces/:workspaceId/...` and accept either a JWT Bearer (user-owned) or a per-workspace API key (for agents running inside the container)

### Agent Chat
- Real-time chat with AI agents via OpenClaw gateway
- SSE streaming for live response tokens
- Chat session management: history, abort, reset
- File attachment support (up to 20MB)

### Notes & Knowledge Base
- Wiki-style markdown notes with `[[backlink]]` support
- Daily notes (auto-created per date)
- 6 built-in templates: Brainstorm, Client Notes, SOP Draft, Content Idea, Quotation Draft, Daily Note
- Link notes to clients, search and archive notes

### Inbox & Email
- Gmail-style threaded conversation view with sent-mail tracking
- Gmail OAuth integration per workspace for real email send/receive
- Compose drafts with markdown editor and attachments
- Convert inbox items into tasks with agent assignment

### Archives & File Storage
- Per-workspace file management with upload/download
- Folder organization with create, move, rename, delete
- Cloud storage sync (Amazon S3, Cloudflare R2, Google Cloud Storage)
- Shareable links with configurable expiry (60 seconds to 7 days)

### Real-time Events
- Server-sent events (SSE) for live task status updates
- SSE streaming for agent chat responses
- Heartbeat-based connection management

### Dashboard
- Workspace dashboard with summary metrics
- Task status overview and agent activity

---

## Prerequisites

- Node.js >= 22
- pnpm >= 9

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment file
cp .env.example .env

# 3. Generate Prisma client + push schema + seed demo data
pnpm db:generate
pnpm db:push
pnpm db:seed

# 4. Start dev servers
pnpm dev
```

Then open **http://localhost:3210**

The API runs on **http://localhost:4210** — check **http://localhost:4210/health** for status.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:./opcify.db` | SQLite database path |
| `API_PORT` | `4210` | API server port |
| `API_HOST` | `127.0.0.1` | API bind address |
| `ADAPTER_MODE` | `prisma` | `prisma` (SQLite + Prisma) or `filesystem` (JSON files) |
| `REDIS_URL` | `redis://localhost:6379` | Redis URL for BullMQ task queue |
| `OPENCLAW_BASE_URL` | _(unset)_ | OpenClaw runtime URL (global fallback) |
| `OPENCLAW_AUTH_TOKEN` | _(unset)_ | Bearer token for OpenClaw runtime |
| `OPENCLAW_GATEWAY_TOKEN` | _(unset)_ | Token for dispatching tasks via gateway CLI |
| `OPENCLAW_GATEWAY_AGENT` | `main` | Default agent for gateway dispatch |
| `OPENCLAW_WORKSPACE` | _(unset)_ | Path to OpenClaw workspace (filesystem adapter only) |
| `OPCIFY_CALLBACK_URL` | _(unset)_ | Base URL for OpenClaw callback reporting |
| `OPCIFY_CALLBACK_TOKEN` | _(unset)_ | Bearer token for callback authentication |
| `GOOGLE_CLIENT_ID` | _(unset)_ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | _(unset)_ | Google OAuth client secret |
| `JWT_SECRET` | _(unset)_ | Signing key for JWT tokens |
| `WORKSPACE_DATA_ROOT` | `~/.opcify/workspaces` | Root directory for workspace data |
| `DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | Docker socket path |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4210` | API URL used by the frontend |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3210` | App URL used by the frontend |

---

## Development

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Run both web + API concurrently |
| `pnpm dev:web` | Next.js only (http://localhost:3210) |
| `pnpm dev:api` | Fastify only (http://localhost:4210) |
| `pnpm dev:fs` | API with filesystem adapter |
| `pnpm build` | Build all packages |
| `pnpm build:web` | Build frontend only |
| `pnpm build:api` | Build backend only |
| `pnpm test` | Run tests (Vitest) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | Lint all packages |
| `pnpm format` | Format with Prettier |
| `pnpm format:check` | Check formatting |
| `pnpm clean` | Remove all node_modules, .next, and dist |

### Database Scripts

| Script | Description |
|--------|-------------|
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:push` | Sync schema to database |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:studio` | Open Prisma Studio GUI |
| `pnpm seed:workspace` | Seed a specific workspace |

### Adapter Modes

Opcify supports two persistence backends:

- **`prisma` (default)** — SQLite via Prisma. Recommended for development and production.
- **`filesystem`** — JSON file-based persistence. Useful for debugging or when you want human-readable data files. Set `ADAPTER_MODE=filesystem` and provide `OPENCLAW_WORKSPACE`.

---

## Creating a Workspace

1. Open http://localhost:3210
2. Click **New Workspace** on the home page
3. Choose a template (8 built-in: Opcify Starter, Content Creator Studio, E-Commerce, Investing & Trading, Real Estate, Software, Tradie Business, Training & Tutoring)
4. Configure name, AI model, Cloud Storage and team setup
5. Click **Deploy Workspace**
6. The provisioner creates agents, skills, and demo data
7. You're redirected into the workspace

---

## Task Execution Flow

```
1. User creates a task in Opcify
2. User clicks "Start" on the task or Wait the Opcify task dispatcher to Auto dispatch the task
3. Opcify dispatches task via command to OpenClaw
4. OpenClaw executes the task step-by-step(Agent to agent)
5. Each step syncs back to Opcify via POST /tasks/:id/execution-steps/sync
6. Opcify persists steps and updates task progress
7. When done, task moves to review (reviewStatus = pending)
8. User accepts, retries, or creates a follow-up
```

---

## Backup & Restore

### Export Backup
Exports the **entire workspace** including all tasks, execution steps, inbox items, agent configs, and review state.

**UI:** Workspace sidebar &rarr; Workspace Actions &rarr; Export Backup

**API:**
```bash
curl http://localhost:4210/workspaces/<ID>/backup > backup.json
```

### Restore Backup
Creates a **new workspace** from a backup file. Original IDs are remapped to avoid collisions. All relationships (follow-ups, blockers, task groups, execution steps) are preserved.

**UI:** Workspace sidebar &rarr; Workspace Actions &rarr; Restore Backup &rarr; select JSON file

**API:**
```bash
curl -X POST http://localhost:4210/workspaces/restore \
  -H "Content-Type: application/json" \
  -d @backup.json
```

---

## API Reference

> See [docs/api-reference.md](docs/api-reference.md) for the complete endpoint reference.

---

## Database Schema

> See [docs/database-schema.md](docs/database-schema.md) for all 16 models, relationships, and status enums.

---

## Docker

```bash
docker compose up
```

| Service | URL |
|---------|-----|
| Web (Next.js) | http://localhost:3210 |
| API (Fastify) | http://localhost:4210 |

The API service includes a health check. The web service waits for the API to be healthy before starting. Data is persisted in a Docker volume (`opcify-data`).

---

## Healthcheck

```bash
curl http://localhost:4210/health
```

Returns:
```json
{
  "status": "ok",
  "version": "0.2.0",
  "uptime": 42,
  "services": {
    "db": "ok",
    "openclaw": "not_configured"
  }
}
```

---

## Troubleshooting

### API won't start
- Check `.env` exists: `cp .env.example .env`
- Regenerate Prisma: `pnpm db:generate`
- Push schema: `pnpm db:push`

### No workspaces visible
- Run seed: `pnpm db:seed`
- Check API is running: `curl http://localhost:4210/health`

### Port already in use
```bash
lsof -ti :4210 | xargs kill -9   # Free API port
lsof -ti :3210 | xargs kill -9   # Free web port
```

### Database corrupted
```bash
rm prisma/opcify.db
pnpm db:push
pnpm db:seed
```

### Prisma client out of sync
If you see "unknown model" or schema errors after pulling changes:
```bash
pnpm db:generate
pnpm db:migrate
```

### Frontend can't reach API
- Verify `NEXT_PUBLIC_API_URL` in `.env` matches the running API URL
- Check CORS — the API allows all origins in development by default

---

## License

MIT — see [LICENSE](LICENSE).
