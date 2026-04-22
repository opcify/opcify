"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { setToken } from "@/lib/auth";

function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const err = searchParams.get("error");

  useEffect(() => {
    if (token) {
      setToken(token);
      window.location.href = "/dashboard";
    }
  }, [token]);

  const error = err
    ? "Authentication failed. Please try again."
    : !token
      ? "No authentication token received."
      : null;

  if (error) {
    return (
      <div className="text-center">
        <p className="text-lg text-red-400">{error}</p>
        <a
          href="/login"
          className="mt-4 inline-block text-sm text-emerald-500 hover:text-emerald-400"
        >
          Back to login
        </a>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
      <p className="mt-4 text-sm text-zinc-400">Signing you in...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <Suspense
        fallback={
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
            <p className="mt-4 text-sm text-zinc-400">Signing you in...</p>
          </div>
        }
      >
        <AuthCallbackContent />
      </Suspense>
    </div>
  );
}
