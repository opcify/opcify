-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InboxItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'inbox',
    "kind" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "snoozedUntil" DATETIME,
    "convertedTaskId" TEXT,
    "convertedGroupId" TEXT,
    "workspaceId" TEXT,
    "emailMessageId" TEXT,
    "emailFrom" TEXT,
    "emailTo" TEXT,
    "emailSubject" TEXT,
    "emailDate" DATETIME,
    "emailThreadId" TEXT,
    "emailInReplyTo" TEXT,
    "emailLabels" TEXT,
    "emailIsRead" BOOLEAN NOT NULL DEFAULT false,
    "aiSummary" TEXT,
    "aiUrgency" TEXT,
    "aiSuggestedAction" TEXT,
    "aiDraftReply" TEXT,
    "actionTaken" TEXT,
    "actionAgentId" TEXT,
    "linkedClientId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InboxItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InboxItem" ("content", "convertedGroupId", "convertedTaskId", "createdAt", "id", "kind", "snoozedUntil", "source", "status", "updatedAt", "workspaceId") SELECT "content", "convertedGroupId", "convertedTaskId", "createdAt", "id", "kind", "snoozedUntil", "source", "status", "updatedAt", "workspaceId" FROM "InboxItem";
DROP TABLE "InboxItem";
ALTER TABLE "new_InboxItem" RENAME TO "InboxItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
