-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'operations',
    "description" TEXT NOT NULL DEFAULT '',
    "suggestedAgentRoles" TEXT NOT NULL DEFAULT '[]',
    "defaultTitle" TEXT NOT NULL DEFAULT '',
    "defaultDescription" TEXT NOT NULL DEFAULT '',
    "defaultTags" TEXT NOT NULL DEFAULT '[]',
    "defaultAgentId" TEXT,
    "defaultPriority" TEXT NOT NULL DEFAULT 'medium',
    "sourceTaskId" TEXT,
    "workspaceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskTemplate_key_key" ON "TaskTemplate"("key");
