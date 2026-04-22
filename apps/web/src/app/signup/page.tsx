"use client";

import { Suspense, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthInput } from "@/components/auth/auth-input";
import { isBossUsername, type AuthState } from "@/components/auth/auth-state";
import Link from "next/link";
import {
  beginGoogleSignIn,
  setToken,
  getBrowserTimezone,
} from "@/lib/auth";

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  );
}

function SignupPageContent() {
  const [authState, setAuthState] = useState<AuthState>("signup_idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const displayGoogleError =
    googleError ?? (urlError ? decodeURIComponent(urlError) : null);

  const updateState = useCallback((newState: AuthState) => {
    setAuthState(newState);
  }, []);

  const handleInputFocus = useCallback(() => {
    updateState("signup_engaged");
  }, [updateState]);

  const handleInputBlur = useCallback(() => {
    if (!name && !email && !password) {
      updateState("signup_idle");
    }
  }, [name, email, password, updateState]);

  const handleEmailChange = useCallback(
    (value: string) => {
      setEmail(value);
      if (isBossUsername(value)) {
        updateState("boss_detected");
      } else if (value.length > 0) {
        updateState("signup_engaged");
      }
    },
    [updateState]
  );

  const handlePasswordVisibilityChange = useCallback(
    (visible: boolean) => {
      if (visible) {
        updateState("password_privacy");
      } else {
        if (email && isBossUsername(email)) {
          updateState("boss_detected");
        } else if (name || email) {
          updateState("signup_engaged");
        } else {
          updateState("signup_idle");
        }
      }
    },
    [email, name, updateState]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSignupError(null);
      setIsSubmitting(true);
      updateState("signup_submitting");

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4210";
        const res = await fetch(`${apiUrl}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, timezone: getBrowserTimezone() }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Registration failed");
        }

        setToken(data.token);
        updateState("signup_success");
        setShowSuccess(true);

        setTimeout(() => {
          window.location.href = "/dashboard";
        }, 1500);
      } catch (err) {
        setSignupError((err as Error).message);
        updateState("signup_idle");
        setIsSubmitting(false);
      }
    },
    [name, email, password, updateState]
  );

  const handleGoogleSignup = useCallback(() => {
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      beginGoogleSignIn();
    } catch (err) {
      setGoogleError((err as Error).message || "Google sign-up failed");
      setGoogleLoading(false);
    }
  }, []);

  const canSubmit = name && email && password && agreeTerms;

  return (
    <AuthLayout state={authState}>
      {/* Logo */}
      <Link href="/" className="mb-6 flex items-center gap-3 group">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl transition-shadow group-hover:shadow-[0_4px_20px_rgba(16,185,129,0.4)]"
          style={{
            background: "linear-gradient(135deg, #10b981, #059669)",
            boxShadow: "0 4px 14px rgba(16, 185, 129, 0.3)",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="text-xl font-bold text-zinc-100 group-hover:text-white transition-colors">Opcify</span>
      </Link>

      {/* Heading */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Create your account</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          Build and manage your AI workforce
        </p>
      </div>

      {/* Success overlay */}
      {showSuccess && (
        <motion.div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl"
          style={{
            backgroundColor: "rgba(9, 9, 11, 0.95)",
            backdropFilter: "blur(8px)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{
              background: "linear-gradient(135deg, #10b98130, #10b98110)",
              border: "2px solid #10b98140",
            }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#10b981"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <motion.path
                d="M20 6L9 17l-5-5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ delay: 0.5, duration: 0.4 }}
              />
            </svg>
          </motion.div>
          <motion.p
            className="mt-4 text-lg font-semibold text-zinc-100"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
          >
            Account created
          </motion.p>
          <motion.p
            className="mt-1 text-sm text-zinc-500"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            Your AI workforce is being assembled...
          </motion.p>
        </motion.div>
      )}

      {(signupError || displayGoogleError) && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {signupError || displayGoogleError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="relative space-y-4">
        <AuthInput
          label="Full name or company"
          type="text"
          placeholder="Acme Corp"
          icon={<BuildingIcon />}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          autoComplete="name"
        />

        <AuthInput
          label="Email"
          type="email"
          placeholder="you@company.com"
          icon={<MailIcon />}
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          autoComplete="email"
        />

        <AuthInput
          label="Password"
          type="password"
          placeholder="Create a strong password"
          icon={<LockIcon />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onPasswordVisibilityChange={handlePasswordVisibilityChange}
          autoComplete="new-password"
        />

        {/* Terms */}
        <label className="flex cursor-pointer items-start gap-2.5 pt-1">
          <input
            type="checkbox"
            checked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/20"
          />
          <span className="text-xs leading-relaxed text-zinc-500">
            I agree to the{" "}
            <a
              href="/terms"
              className="text-emerald-500/80 hover:text-emerald-400"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              className="text-emerald-500/80 hover:text-emerald-400"
            >
              Privacy Policy
            </a>
          </span>
        </label>

        {/* Submit */}
        <motion.button
          type="submit"
          disabled={isSubmitting || !canSubmit}
          className="relative w-full overflow-hidden rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          style={{
            boxShadow: "0 4px 14px rgba(16, 185, 129, 0.25)",
          }}
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center gap-2">
              <motion.div
                className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
                animate={{ rotate: 360 }}
                transition={{
                  duration: 0.8,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
              Creating account...
            </div>
          ) : (
            "Create account"
          )}
          <motion.div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)",
              transform: "translateX(-100%)",
            }}
            whileHover={{
              transform: "translateX(100%)",
              transition: { duration: 0.6 },
            }}
          />
        </motion.button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-800" />
          <span className="text-xs text-zinc-600">or</span>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        {/* Social signup — full-page OAuth redirect to Google */}
        <button
          type="button"
          onClick={handleGoogleSignup}
          disabled={googleLoading}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-700 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          {googleLoading ? "Redirecting to Google…" : "Sign up with Google"}
        </button>

        {/* Login link */}
        <p className="text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-emerald-500/80 transition-colors hover:text-emerald-400"
          >
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupPageContent />
    </Suspense>
  );
}
