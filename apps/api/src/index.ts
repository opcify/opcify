import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { OpenClawAdapter } from "./modules/openclaw-adapter/index.js";
import { PrismaAdapter, FilesystemAdapter } from "./modules/openclaw-adapter/index.js";
import { ensureDir } from "./modules/openclaw-adapter/fs-utils.js";
import { createLogger, runWithRequestId } from "./logger.js";
import { prisma } from "./db.js";
import IORedis from "ioredis";
import { createOpenClawClient } from "./modules/openclaw-integration/index.js";
import { DispatchManager, runRecoverySweep } from "./modules/task-dispatcher/index.js";
import { eventRoutes } from "./modules/events/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { agentRoutes } from "./modules/agents/routes.js";
import { skillRoutes } from "./modules/skills/routes.js";
import { taskRoutes, taskCallbackRoutes } from "./modules/tasks/routes.js";
import { skillAdvisorRoutes } from "./modules/skill-advisor/routes.js";
import { agentTemplateRoutes } from "./modules/agent-templates/routes.js";
import { taskTemplateRoutes } from "./modules/task-templates/routes.js";
import { taskGroupRoutes } from "./modules/task-groups/routes.js";
import { kanbanRoutes } from "./modules/kanban/routes.js";
import { notesRoutes } from "./modules/notes/routes.js";
import { workspaceRoutes } from "./modules/workspaces/routes.js";
import { clientRoutes } from "./modules/clients/routes.js";
import { ledgerRoutes } from "./modules/ledger/routes.js";
import { publicQuoteRoutes } from "./modules/ledger/public-routes.js";
import { recurringRoutes } from "./modules/recurring/routes.js";
import { startRecurringScheduler } from "./modules/recurring/scheduler.js";
import { openclawConfigRoutes } from "./modules/openclaw-config/routes.js";
import { openclawCapabilitiesRoutes } from "./modules/openclaw-capabilities/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { dockerWorkspaceRoutes } from "./workspace/WorkspaceRouter.js";
import { chatRoutes } from "./modules/chat/routes.js";
import { archiveRoutes } from "./modules/archives/routes.js";
import { inboxRoutes } from "./modules/inbox/routes.js";
import { seedBuiltInWorkspaceTemplates } from "./modules/workspaces/seed-built-in-templates.js";

const log = createLogger("server");

const app = Fastify({ logger: false }); // we use our own logger

await app.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
});

// ─── Content type parser for binary uploads (DB restore) ──────────

app.addContentTypeParser(
  "application/octet-stream",
  { parseAs: "buffer", bodyLimit: 100 * 1024 * 1024 }, // 100MB
  (_req, body, done) => { done(null, body); },
);

// ─── Auth decorator ────────────────────────────────────────────────

app.decorateRequest("userId", null);

// ─── Request ID middleware ──────────────────────────────────────────

app.addHook("onRequest", (req, reply, done) => {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID().slice(0, 8);
  (req as unknown as Record<string, unknown>).requestId = requestId;
  reply.header("x-request-id", requestId);
  done();
});

// Wrap every handler in request context for structured logging
app.addHook("preHandler", (req, _reply, done) => {
  const requestId = (req as unknown as Record<string, unknown>).requestId as string;
  runWithRequestId(requestId, () => done());
});

// ─── Request logging ────────────────────────────────────────────────

app.addHook("onResponse", (req, reply, done) => {
  const requestId = (req as unknown as Record<string, unknown>).requestId as string;
  const duration = reply.elapsedTime?.toFixed(0) ?? "?";
  // Only log non-health requests at info level
  if (req.url !== "/health") {
    log.info(`${req.method} ${req.url} → ${reply.statusCode} (${duration}ms)`, { requestId });
  }
  done();
});

// ─── Normalized error handler ───────────────────────────────────────

app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
  const requestId = (req as unknown as Record<string, unknown>).requestId as string || "unknown";

  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        requestId,
        issues: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
  }

  log.error(`Unhandled error: ${error.message}`, { requestId, stack: error.stack });

  const statusCode = error.statusCode || 500;
  return reply.status(statusCode).send({
    error: {
      code: "INTERNAL_ERROR",
      message: statusCode === 500 ? "Internal server error" : error.message,
      requestId,
    },
  });
});

// ─── Adapter setup ──────────────────────────────────────────────────

async function createAdapter(): Promise<OpenClawAdapter> {
  const mode = process.env.ADAPTER_MODE || "prisma";

  if (mode === "filesystem") {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const workspaceRoot =
      process.env.OPENCLAW_WORKSPACE || join(projectRoot, "templates", "openclaw");
    log.info(`Using FilesystemAdapter → ${workspaceRoot}`);
    await ensureDir(workspaceRoot);
    await ensureDir(join(workspaceRoot, "agents"));
    await ensureDir(join(workspaceRoot, "skills"));
    await ensureDir(join(workspaceRoot, "tasks"));
    await ensureDir(join(workspaceRoot, "task-groups"));
    await ensureDir(join(workspaceRoot, "task-templates"));
    return new FilesystemAdapter(workspaceRoot);
  }

  log.info("Using PrismaAdapter (SQLite)");
  return new PrismaAdapter();
}

const adapter = await createAdapter();
const openclawClient = createOpenClawClient();

// ─── Redis + BullMQ Dispatcher ──────────────────────────────────────

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
let redis: InstanceType<typeof IORedis> | undefined;
let dispatchManager: DispatchManager | undefined;

try {
  redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 10) return null; // give up after ~15s
      return Math.min(times * 300, 3000);
    },
  });
  redis.on("error", () => {}); // suppress unhandled error events
  await redis.connect();
  log.info(`Redis connected at ${redisUrl}`);

  dispatchManager = new DispatchManager(redis, openclawClient);
  log.info("BullMQ dispatch manager started (per-workspace queues)");
} catch (err) {
  if (redis) {
    redis.disconnect();
    redis = undefined;
  }
  log.warn(
    `Redis not available at ${redisUrl} — task queue disabled. ${err instanceof Error ? err.message : err}`,
  );
}

// ─── Routes ─────────────────────────────────────────────────────────

await authRoutes(app);
await eventRoutes(app);
await dashboardRoutes(app, adapter);
await agentRoutes(app, adapter);
await skillRoutes(app, adapter);
await taskRoutes(app, adapter, dispatchManager);
await taskCallbackRoutes(app, adapter, dispatchManager);
await skillAdvisorRoutes(app, adapter);
await agentTemplateRoutes(app, adapter);
await taskTemplateRoutes(app, adapter, dispatchManager);
await taskGroupRoutes(app, adapter, dispatchManager);
await kanbanRoutes(app, adapter, openclawClient, dispatchManager);
await notesRoutes(app);
await workspaceRoutes(app);
await clientRoutes(app);
await ledgerRoutes(app);
await publicQuoteRoutes(app);
await recurringRoutes(app);
await openclawConfigRoutes(app);
await openclawCapabilitiesRoutes(app);
await chatRoutes(app);
await archiveRoutes(app);
await inboxRoutes(app);
await dockerWorkspaceRoutes(app);

// ─── Healthcheck ────────────────────────────────────────────────────

app.get("/health", async () => {
  const services: Record<string, string> = {};

  // Check DB
  try {
    await prisma.$queryRaw`SELECT 1`;
    services.db = "ok";
  } catch {
    services.db = "error";
  }

  // Check OpenClaw connection
  services.openclaw = process.env.OPENCLAW_BASE_URL ? "connected" : "not_configured";

  const allOk = services.db === "ok";
  return {
    status: allOk ? "ok" : "degraded",
    version: "0.2.0",
    uptime: Math.floor(process.uptime()),
    services,
  };
});

// ─── Start ──────────────────────────────────────────────────────────

const port = Number(process.env.API_PORT) || 4210;
const host = process.env.API_HOST || "127.0.0.1";

// Seed built-in workspace templates (upsert — safe to run every boot)
await seedBuiltInWorkspaceTemplates();

await app.listen({ port, host });
log.info(`Opcify API listening on http://${host}:${port}`);

// Start background recurring task scheduler (checks every 60s)
startRecurringScheduler(60_000, dispatchManager);

// Run dispatch recovery sweep (re-enqueue orphaned queued tasks)
// Runs at startup and then every 60s to catch tasks whose BullMQ jobs
// exhausted retries or were lost.
if (dispatchManager) {
  const mgr = dispatchManager;
  const sweep = () => runRecoverySweep(mgr).catch((err) => {
    log.error(`Dispatch recovery sweep failed: ${err instanceof Error ? err.message : err}`);
  });
  sweep();
  setInterval(sweep, 60_000);
}

// Workspace containers are restored lazily — when a user opens a workspace
// (GET /workspaces/:id), the route triggers ensureContainers() on demand.
// This avoids slow startup and unnecessary resource usage for idle workspaces.
