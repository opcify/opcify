/**
 * Structured logger for Opcify API.
 *
 * Each log entry includes: timestamp, level, module, message, requestId (if available), metadata.
 * Integrates with Fastify's request lifecycle via AsyncLocalStorage.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  requestId?: string;
  meta?: Record<string, unknown>;
}

// AsyncLocalStorage for per-request context (requestId)
const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

function formatEntry(entry: LogEntry): string {
  const parts = [
    entry.timestamp,
    `[${entry.level.toUpperCase()}]`,
    `[${entry.module}]`,
    entry.message,
  ];
  if (entry.requestId) parts.push(`reqId=${entry.requestId}`);
  if (entry.meta && Object.keys(entry.meta).length > 0) {
    parts.push(JSON.stringify(entry.meta));
  }
  return parts.join(" ");
}

function emit(level: LogLevel, module: string, message: string, meta?: Record<string, unknown>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    requestId: getRequestId(),
    meta,
  };

  const line = formatEntry(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createLogger(module: string) {
  return {
    info: (message: string, meta?: Record<string, unknown>) => emit("info", module, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => emit("warn", module, message, meta),
    error: (message: string, meta?: Record<string, unknown>) => emit("error", module, message, meta),
  };
}
