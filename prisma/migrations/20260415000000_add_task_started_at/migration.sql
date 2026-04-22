-- AlterTable
ALTER TABLE "Task" ADD COLUMN "startedAt" DATETIME;

-- Backfill: for tasks that have left 'queued', use the earliest execution step
-- startedAt when available, falling back to createdAt. Pure 'queued' tasks stay NULL.
-- Note: the subquery makes this O(N*M) on SQLite; fine at dev scale.
UPDATE "Task"
SET "startedAt" = COALESCE(
  (SELECT MIN("startedAt") FROM "TaskExecutionStep"
    WHERE "TaskExecutionStep"."taskId" = "Task"."id" AND "startedAt" IS NOT NULL),
  "createdAt"
)
WHERE "status" IN ('running', 'waiting', 'done', 'failed', 'stopped')
  AND "startedAt" IS NULL;
