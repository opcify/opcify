"use client";

import { motion } from "framer-motion";
import type { InputHTMLAttributes } from "react";
import { useState, useEffect } from "react";

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: React.ReactNode;
  /** Called when password visibility changes (only for type="password") */
  onPasswordVisibilityChange?: (visible: boolean) => void;
}

export function AuthInput({ label, icon, className, onPasswordVisibilityChange, ...props }: AuthInputProps) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = props.type === "password";

  useEffect(() => {
    onPasswordVisibilityChange?.(showPassword);
  }, [showPassword, onPasswordVisibilityChange]);

  return (
    <div className="group relative">
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-emerald-500">
            {icon}
          </div>
        )}
        <motion.div
          className="absolute inset-0 rounded-xl"
          animate={{
            boxShadow: focused
              ? "0 0 0 2px rgba(16, 185, 129, 0.2), 0 0 20px rgba(16, 185, 129, 0.05)"
              : "0 0 0 0px transparent",
          }}
          transition={{ duration: 0.2 }}
          style={{ pointerEvents: "none" }}
        />
        <input
          {...props}
          type={isPassword && showPassword ? "text" : props.type}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          className={`
            w-full rounded-xl border border-zinc-800 bg-zinc-900/80
            px-4 py-3 text-sm text-zinc-100
            placeholder-zinc-600
            outline-none
            transition-colors
            focus:border-emerald-500/50 focus:bg-zinc-900
            ${icon ? "pl-10" : ""}
            ${isPassword ? "pr-10" : ""}
            ${className ?? ""}
          `}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-zinc-600 transition-colors hover:text-zinc-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    </div>
  );
}
