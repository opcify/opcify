"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { AuthState } from "./auth-state";
import { AiOfficeScene } from "./ai-office-scene";

interface AuthLayoutProps {
  children: ReactNode;
  state: AuthState;
}

export function AuthLayout({ children, state }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen bg-zinc-950">
      {/* Left panel — AI Office Scene (hidden on mobile) */}
      <div className="relative hidden w-[55%] lg:block">
        <AiOfficeScene state={state} />

        {/* Brand watermark in scene */}
        <div className="absolute bottom-6 left-6 flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{
              background: "linear-gradient(135deg, #10b98130, #10b98110)",
              border: "1px solid #10b98125",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span
            className="text-xs font-medium"
            style={{ color: "rgba(255,255,255,0.25)" }}
          >
            Opcify AI Workforce
          </span>
        </div>
      </div>

      {/* Right panel — Auth Form */}
      <div className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-[45%] lg:px-16">
        {/* Mobile scene (simplified) */}
        <div className="mb-8 h-40 w-full overflow-hidden rounded-2xl lg:hidden">
          <AiOfficeScene state={state} />
        </div>

        <motion.div
          className="w-full max-w-[420px]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>

        {/* Footer */}
        <div className="mt-8 flex gap-4 text-xs text-zinc-600">
          <a href="/privacy" className="transition-colors hover:text-zinc-400">
            Privacy Policy
          </a>
          <span className="text-zinc-800">|</span>
          <a href="/terms" className="transition-colors hover:text-zinc-400">
            Terms of Service
          </a>
        </div>
      </div>
    </div>
  );
}
