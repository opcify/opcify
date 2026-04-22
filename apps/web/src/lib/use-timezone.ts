"use client";

import { useAuth } from "./auth-context";

export function useTimezone(): string {
  const { user } = useAuth();
  return user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
