# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Opcify is an AI workspace platform — a control plane and management UI for OpenClaw (an intelligent runtime engine). It provides task management, agent orchestration, workspace provisioning, financial tracking, and client management.

## Architecture

**Monorepo** using pnpm workspaces with three packages:

- `apps/web` — Next.js 15 frontend (React 19, Tailwind CSS 4), port 3210
- `apps/api` — Fastify 5 backend (TypeScript ESM, Zod validation), port 4210
- `packages/core` — Shared TypeScript types (`types.ts` has ~400+ types, `ai-providers.ts` has model definitions)

**Database:** Prisma 6 ORM with SQLite (`prisma/schema.prisma`, 16 models). Two adapter modes: `prisma` (default, SQLite+Prisma) and `filesystem` (JSON files in workspace directory).

**Backend modules** live in `apps/api/src/modules/` — each module typically has `routes.ts`, `service.ts`, `types.ts`, and `*.test.ts`. There are 23 modules: agents, agent-templates, archives, auth, chat, clients, dashboard, events, kanban, ledger, notes, openclaw-adapter, openclaw-capabilities, openclaw-config, openclaw-integration, recurring, skill-advisor, skills, task-dispatcher, task-groups, task-templates, tasks, workspaces.

**Frontend** uses Next.js App Router. API client is centralized in `apps/web/src/lib/api.ts`. Workspace state managed via `apps/web/src/lib/workspace-context.tsx`.

## Commands

```bash
# Development
pnpm dev              # Run frontend + API concurrently (runs db migrate first)
pnpm dev:web          # Next.js frontend only
pnpm dev:api          # Fastify API only

# Build
pnpm build            # Build all packages

# Testing (Vitest, runs against apps/api)
pnpm test             # Run all tests
pnpm test:watch       # Watch mode
# Integration tests: bash scripts in tests/ (run_all.sh, test_webhook_e2e.sh, etc.)

# Database
pnpm db:generate      # Generate Prisma client
pnpm db:push          # Sync schema to database (no migration)
pnpm db:migrate       # Run Prisma migrations
pnpm db:seed          # Seed demo data
pnpm db:studio        # Open Prisma Studio GUI

# Code quality
pnpm lint             # ESLint across all packages
pnpm format           # Prettier write
pnpm format:check     # Prettier check

# Setup from scratch
cp .env.example .env && pnpm install && pnpm db:generate && pnpm db:push && pnpm db:seed
```

## Key Patterns

- **API routes** register via `{feature}Routes(app, adapter)` in `apps/api/src/index.ts`. Request/response validation uses Zod schemas. Structured logging with request-scoped IDs via AsyncLocalStorage (`apps/api/src/logger.ts`).
- **Prisma client** is a singleton in `apps/api/src/db.ts`.
- **OpenClaw integration** supports mock mode (local execution simulation) and real mode (external runtime via `OPENCLAW_BASE_URL`). Gateway webhook support for task dispatch.
- **Task lifecycle:** `queued` → `running` → `waiting` → `done`/`failed`. Review workflow: `pending` → `accepted`/`rejected`/`followed_up`.
- **Recurring scheduler** runs every 60s in background, auto-generates tasks from recurring rules.
- **Workspace provisioning** creates agents, skills, and demo data from 8 built-in workspace templates.
- **Task dispatch** uses Redis + BullMQ for per-workspace task queues with priority-based dispatch and recovery sweep. Requires `REDIS_URL`.
- **Docker workspace lifecycle** managed by `apps/api/src/workspace/` — per-workspace OpenClaw gateway containers with port allocation and health monitoring.
- **`postinstall` hook** runs `prisma generate` and `prisma migrate deploy` automatically.

## gstack

Use `/browse` from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`.

## Code Style

- TypeScript strict mode, ESM throughout
- Prettier: semicolons, double quotes, 2-space indent, 90 char print width, trailing commas
- ESLint: unused vars warning with `_` prefix exception
- Vitest config: node environment, 15s test timeout, globals enabled
