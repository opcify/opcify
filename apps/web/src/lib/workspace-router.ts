"use client";

import { useRouter } from "next/navigation";
import type { NavigateOptions } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useOptionalWorkspace } from "./workspace-context";

export function useWorkspaceRouter() {
  const router = useRouter();
  const ws = useOptionalWorkspace();

  const prefix = ws ? `/workspaces/${ws.workspaceId}` : "";

  return {
    push: (path: string, options?: NavigateOptions) =>
      router.push(`${prefix}${path}`, options),
    replace: (path: string, options?: NavigateOptions) =>
      router.replace(`${prefix}${path}`, options),
    /** Build a workspace-scoped path for use in Link href */
    href: (path: string) => `${prefix}${path}`,
    /** Raw router for non-workspace navigation */
    raw: router,
  };
}
