"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  completeGoogleSignIn,
  consumeGoogleOAuthState,
  getGoogleRedirectUri,
} from "@/lib/auth";

// Module-level guard so React Strict Mode's dev-only double-invoke of the
// mount effect doesn't consume the OAuth state twice (the second read would
// see `null` and reject the legitimate callback as a state mismatch).
let callbackHandled = false;

function GoogleCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (callbackHandled) return;
    callbackHandled = true;

    const redirectWithError = (msg: string) => {
      router.replace(`/login?error=${encodeURIComponent(msg)}`);
    };

    const error = searchParams.get("error");
    if (error) {
      const description = searchParams.get("error_description");
      redirectWithError(description || error);
      return;
    }

    const code = searchParams.get("code");
    if (!code) {
      redirectWithError("Google sign-in was cancelled");
      return;
    }

    const state = searchParams.get("state");
    const storedState = consumeGoogleOAuthState();
    if (!state || !storedState || state !== storedState) {
      redirectWithError("Google sign-in state mismatch. Please try again.");
      return;
    }

    completeGoogleSignIn(code, getGoogleRedirectUri())
      .then(() => {
        window.location.href = "/dashboard";
      })
      .catch((err) => {
        redirectWithError((err as Error).message || "Google sign-in failed");
      });
  }, [router, searchParams]);

  return (
    <div className="text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
      <p className="mt-4 text-sm text-zinc-400">Signing you in…</p>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <Suspense
        fallback={
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
            <p className="mt-4 text-sm text-zinc-400">Signing you in…</p>
          </div>
        }
      >
        <GoogleCallbackContent />
      </Suspense>
    </div>
  );
}
