# Architecture

This document describes the system architecture of Opcify, an AI workspace platform that serves as the control plane for [OpenClaw](https://github.com/openclaw/openclaw) (an intelligent runtime engine).

---

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                           Opcify                                │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────────┐ │
│  │ Next.js  │   │ Fastify  │   │  SQLite  │   │   Redis     │ │
│  │ Frontend │──▶│   API    │──▶│    DB    │   │  (BullMQ)   │ │
│  │  :3210   │   │  :4210   │   │ (Prisma) │   │  task queue │ │
│  └──────────┘   └────┬─────┘   └──────────┘   └──────┬──────┘ │
│       ▲               │                               │        │
│       │          SSE + REST                     dispatch jobs   │
│       │               │                               │        │
│       │        ┌──────▼──────────────────────────────▼───────┐ │
│       │        │          Per-Workspace Containers            │ │
│       │        │  ┌─────────────┐  ┌─────────────────────┐   │ │
│       └────────│──│  OpenClaw   │  │  Browser Automation  │   │ │
│     SSE events │  │  Gateway    │  │  (browser-use skill) │   │ │
│                │  └──────┬──────┘  └─────────────────────┘   │ │
│                └─────────┼───────────────────────────────────┘ │
│                          │                                     │
│                   callback sync                                │
│                 POST /tasks/:id/execution-steps/sync           │
└─────────────────────────────────────────────────────────────────┘
```

Opcify creates tasks and dispatches them to OpenClaw for execution. OpenClaw sends step-by-step execution updates back via the sync API. Opcify persists all state and drives the UI through real-time SSE events.

---

## System Components

### Frontend — `apps/web`

Next.js 15 with React 19, Tailwind CSS 4, and TypeScript.

**Key files:**
- `src/lib/api.ts` — Centralized fetch-based API client with Bearer token injection
- `src/lib/workspace-context.tsx` — React context for workspace ID and slug

**Workspace pages** (under `/workspaces/[workspaceId]/`):
agents, agents-hub, archives, channels, chat, clients, kanban, ledger, notes, skills, task-groups, task-hub, tasks

**Auth pages:** login, signup, forgot-password, Google OAuth callback

**Real-time updates:** SSE hooks for task events and chat streaming.

### Backend — `apps/api`

Fastify 5 with TypeScript ESM and Zod validation.

**Core infrastructure:**
- `src/index.ts` — Server entry, route registration (21 routes), health check
- `src/db.ts` — Prisma client singleton
- `src/logger.ts` — Structured logging with request-scoped IDs via AsyncLocalStorage

**23 feature modules** in `src/modules/`:

| Category | Modules |
|----------|---------|
| Core entities | agents, tasks, clients, skills, notes |
| Templates | agent-templates, task-templates, workspaces |
| Workflow | kanban, task-groups, task-dispatcher, recurring, events |
| OpenClaw | openclaw-adapter, openclaw-integration, openclaw-config, openclaw-capabilities |
| Features | chat, archives, ledger, dashboard, skill-advisor |
| Auth | auth |

**Docker workspace lifecycle** in `src/workspace/`:
- `WorkspaceService.ts` — Container creation, start/stop, health monitoring
- `WorkspaceRouter.ts` — REST API for Docker workspace management

### Shared Types — `packages/core`

- `types.ts` — ~400+ TypeScript types shared between frontend and backend
- `ai-providers.ts` — AI model definitions across providers

### Database — Prisma + SQLite

16 models defined in `prisma/schema.prisma`. Two adapter modes:
- **`prisma`** (default) — SQLite via Prisma ORM
- **`filesystem`** — JSON file-based persistence for debugging

---

## Data Flow

### Task Execution Pipeline

```
User creates task (UI)
        │
        ▼
POST /tasks ──▶ Task saved (status: queued)
        │
        ▼
BullMQ enqueues job ──▶ Per-workspace Redis queue
        │
        ▼
Dispatcher sends to OpenClaw gateway
        │
        ▼
OpenClaw executes step-by-step
        │
        ▼
POST /tasks/:id/execution-steps/sync ──▶ Steps persisted
        │
        ▼
SSE event emitted ──▶ Frontend updates in real-time
        │
        ▼
Task completes (status: done, reviewStatus: pending)
        │
        ▼
User accepts / retries / creates follow-up
```

**Task statuses:** `queued` → `running` → `waiting` → `done` / `failed`
**Review statuses:** `pending` → `accepted` / `rejected` / `followed_up`

### Agent Chat Pipeline

```
User sends message (POST /chat/:agentId/send)
        │
        ▼
API routes to OpenClaw gateway
        │
        ▼
Agent processes message with configured tools
        │
        ▼
SSE stream (GET /chat/:agentId/stream) ──▶ UI renders tokens
```

Chat supports file attachments (up to 20MB), session history, abort, and reset.

### Workspace Provisioning Pipeline

```
User selects template ──▶ POST /workspaces/:id/provision
        │
        ▼
Create agents from template definitions
        │
        ▼
Install skills from template config
        │
        ▼
Seed task templates and demo data
        │
        ▼
Start Docker container (OpenClaw gateway)
        │
        ▼
Workspace ready (status: ready)
```

8 built-in workspace templates bundle pre-configured agents, skills, and task templates. Users can also save any workspace as a reusable template.

---

## Infrastructure

### Docker Workspace Lifecycle

Each workspace gets its own Docker container running an OpenClaw gateway. The `WorkspaceService` manages:
- **Container creation** with port allocation
- **Lazy startup** — containers start on first workspace access, not at boot
- **Health monitoring** — `GET /docker-workspaces/:id/health`
- **Workspace data** stored at `WORKSPACE_DATA_ROOT` (default: `~/.opcify/workspaces`)

### Redis + BullMQ

Task dispatch uses Redis-backed BullMQ queues:
- **Per-workspace queues** for tenant isolation
- **Priority-based dispatch** (high/medium/low)
- **Recovery sweep** every 60s re-enqueues orphaned tasks
- **Graceful degradation** — API runs without Redis, but task dispatch is disabled

### Recurring Scheduler

Background timer (60s interval) checks `RecurringRule` records and auto-generates tasks based on weekly/monthly schedules. Each rule tracks `nextRunAt` and `lastRunAt`.

### Authentication

- **Google OAuth** — Popup flow via Google Identity Services (no redirect URI)
- **Email/password** — Registration with bcrypt hashing
- **JWT tokens** — Signed with `JWT_SECRET`, sent as Bearer header
- **User profiles** — Name, timezone, avatar

### Structured Logging

Request-scoped logging via `AsyncLocalStorage`:
- Every request gets a unique ID (`x-request-id` header)
- All log entries include module name, timestamp, level, and request ID
- Zod validation errors return structured error responses

---

## Deployment

### Docker — `docker-compose.yml`

Containerized deployment with API and Web services. API includes health check. Data persisted via Docker volume.

### Development — `docker/docker-compose.yml`

Development services (Redis) started automatically by `pnpm dev`.

### CI/CD — GitHub Actions

`.github/workflows/build-openclaw.yml` builds multi-arch (amd64/arm64) OpenClaw Docker images and pushes to Docker Hub.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **SQLite** | Single-node simplicity, zero-config, file-based backups. Sufficient for workspace-scale data. |
| **Two adapter modes** | Prisma for production, filesystem for debugging with human-readable JSON files. |
| **Per-workspace Docker containers** | Tenant isolation — each workspace gets its own OpenClaw gateway with independent config. |
| **BullMQ over direct dispatch** | Reliable task queuing with retry, priority, and recovery. Per-workspace queues prevent noisy neighbors. |
| **SSE over WebSocket** | Simpler client/server implementation. One-directional server → client fits the update notification pattern. |
| **Lazy container startup** | Avoids slow boot and unnecessary resource usage for idle workspaces. Containers start on first access. |
| **Template-based provisioning** | 8 workspace templates, 6 agent templates, 11 skill templates, 8 task templates. Users start productive immediately. |
