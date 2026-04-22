"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthInput } from "@/components/auth/auth-input";
import type { AuthState } from "@/components/auth/auth-state";
import Link from "next/link";

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export default function ForgotPasswordPage() {
  const [authState, setAuthState] = useState<AuthState>("idle_slacking");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleEmailFocus = useCallback(() => {
    if (email.length > 0) {
      setAuthState("curious_input");
    }
  }, [email]);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    if (value.length > 0) {
      setAuthState("curious_input");
    } else {
      setAuthState("idle_slacking");
    }
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubmitting(true);
    setAuthState("submitting");

    // Simulate sending reset email
    await new Promise((r) => setTimeout(r, 1800));

    setAuthState("success");
    setShowSuccess(true);
    setIsSubmitting(false);
  }, [email]);

  return (
    <AuthLayout state={authState}>
      {/* Logo */}
      <div className="mb-8 flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
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
        <span className="text-xl font-bold text-zinc-100">Opcify</span>
      </div>

      {/* Heading */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-100">Reset your password</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          Enter your email and we&apos;ll send you a reset link
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
            Check your inbox
          </motion.p>
          <motion.p
            className="mt-1 text-sm text-zinc-500 text-center px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            We&apos;ve sent a password reset link to {email}
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
            className="mt-6"
          >
            <Link
              href="/login"
              className="text-sm font-medium text-emerald-500/80 transition-colors hover:text-emerald-400"
            >
              Back to sign in
            </Link>
          </motion.div>
        </motion.div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="relative space-y-5">
        <AuthInput
          label="Email address"
          type="email"
          placeholder="boss@opcify.com"
          icon={<MailIcon />}
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          onFocus={handleEmailFocus}
          autoComplete="email"
        />

        {/* Submit button */}
        <motion.button
          type="submit"
          disabled={isSubmitting || !email}
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
              Sending reset link...
            </div>
          ) : (
            "Send reset link"
          )}
          {/* Shine effect on hover */}
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

        {/* Back to login */}
        <Link
          href="/login"
          className="flex items-center justify-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowLeftIcon />
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  );
}
