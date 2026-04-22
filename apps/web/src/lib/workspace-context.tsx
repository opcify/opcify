"use client";

import { createContext, useContext } from "react";

interface WorkspaceContextValue {
  workspaceId: string;
  workspaceSlug: string;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  workspaceId,
  workspaceSlug,
  children,
}: {
  workspaceId: string;
  workspaceSlug: string;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={{ workspaceId, workspaceSlug }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}

export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}
