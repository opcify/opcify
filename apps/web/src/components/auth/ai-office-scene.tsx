"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import type { AuthState } from "./auth-state";
import { EMPLOYEES } from "./auth-state";
import { AiEmployee } from "./ai-employee";
import { useMousePosition } from "./use-mouse-position";

interface AiOfficeSceneProps {
  state: AuthState;
}

export function AiOfficeScene({ state }: AiOfficeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mousePos = useMousePosition(containerRef);

  const isBossHere = state === "boss_detected";
  const isSuccess = state === "success" || state === "signup_success";
  const isSlacking = state === "idle_slacking" || state === "signup_idle";
  const isPrivacy = state === "password_privacy";

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden select-none">
      {/* Deep background */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 40% 25%, #13132a 0%, #0b0b1a 40%, #060610 100%)",
        }}
      />

      {/* Subtle noise texture */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Perspective grid floor */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(99, 102, 241, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99, 102, 241, 0.04) 1px, transparent 1px)
          `,
          backgroundSize: "50px 50px",
          transform: "perspective(600px) rotateX(45deg)",
          transformOrigin: "center 90%",
          maskImage:
            "linear-gradient(to top, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 50%)",
        }}
      />

      {/* Ambient glow — shifts with state */}
      <motion.div
        className="absolute inset-0"
        animate={{
          background: isBossHere
            ? "radial-gradient(ellipse at 50% 50%, rgba(16, 185, 129, 0.1) 0%, transparent 65%)"
            : isSuccess
              ? "radial-gradient(ellipse at 50% 50%, rgba(16, 185, 129, 0.15) 0%, transparent 60%)"
              : isPrivacy
                ? "radial-gradient(ellipse at 50% 50%, rgba(99, 102, 241, 0.03) 0%, transparent 70%)"
                : isSlacking
                  ? "radial-gradient(ellipse at 50% 50%, rgba(245, 158, 11, 0.04) 0%, transparent 70%)"
                  : "radial-gradient(ellipse at 50% 50%, rgba(99, 102, 241, 0.06) 0%, transparent 65%)",
        }}
        transition={{ duration: 1 }}
      />

      {/* Floating light orbs for atmosphere */}
      <FloatingOrb x={20} y={20} size={80} color="99, 102, 241" delay={0} />
      <FloatingOrb x={70} y={15} size={60} color="139, 92, 246" delay={1.5} />
      <FloatingOrb x={45} y={75} size={50} color="6, 182, 212" delay={3} />

      {/* Workstation desks */}
      <Workstation x={12} y={48} width={70} isBossHere={isBossHere} isSuccess={isSuccess} />
      <Workstation x={50} y={68} width={62} isBossHere={isBossHere} isSuccess={isSuccess} />
      <Workstation x={78} y={42} width={55} isBossHere={isBossHere} isSuccess={isSuccess} />

      {/* Holographic monitors */}
      <Monitor x={10} y={20} isBossHere={isBossHere} isSuccess={isSuccess} delay={0} />
      <Monitor x={58} y={16} isBossHere={isBossHere} isSuccess={isSuccess} delay={0.15} />
      <Monitor x={82} y={40} isBossHere={isBossHere} isSuccess={isSuccess} delay={0.3} />

      {/* AI Employees */}
      {EMPLOYEES.map((emp, i) => (
        <AiEmployee
          key={emp.id}
          config={emp}
          state={state}
          index={i}
          mousePos={mousePos}
        />
      ))}

      {/* Workplace status badge */}
      <motion.div
        className="absolute left-4 top-4 flex items-center gap-2.5 rounded-full px-4 py-2"
        style={{
          backgroundColor: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
          zIndex: 100,
        }}
      >
        <motion.div
          className="rounded-full"
          style={{ width: 7, height: 7 }}
          animate={{
            backgroundColor: isBossHere || isSuccess
              ? "#10b981"
              : isSlacking ? "#f59e0b" : "#6366f1",
            boxShadow: isBossHere || isSuccess
              ? "0 0 10px #10b98160"
              : isSlacking ? "0 0 8px #f59e0b40" : "0 0 8px #6366f140",
            scale: isBossHere ? [1, 1.2, 1] : 1,
          }}
          transition={{
            duration: isBossHere ? 1.5 : 0.4,
            repeat: isBossHere ? Infinity : 0,
          }}
        />
        <motion.span
          className="text-xs font-medium tracking-wide"
          animate={{
            color: isBossHere || isSuccess
              ? "rgba(52, 211, 153, 0.8)"
              : isSlacking
                ? "rgba(251, 191, 36, 0.5)"
                : "rgba(255, 255, 255, 0.35)",
          }}
          transition={{ duration: 0.4 }}
        >
          {isBossHere
            ? "Boss Detected"
            : isSuccess
              ? "Systems Online"
              : isSlacking
                ? "Unsupervised"
                : isPrivacy
                  ? "Privacy Mode"
                  : "Monitoring..."}
        </motion.span>
      </motion.div>

      {/* Team count badge */}
      <div
        className="absolute right-4 top-4 flex items-center gap-2 rounded-full px-3 py-1.5"
        style={{
          backgroundColor: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.04)",
          zIndex: 100,
        }}
      >
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
          {EMPLOYEES.length} agents
        </span>
      </div>

      {/* Bottom fade */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-24"
        style={{ background: "linear-gradient(to top, #09090b, transparent)" }}
      />
      {/* Top subtle fade */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 h-12"
        style={{ background: "linear-gradient(to bottom, rgba(6,6,16,0.5), transparent)" }}
      />
    </div>
  );
}

function FloatingOrb({ x, y, size, color, delay }: {
  x: number; y: number; size: number; color: string; delay: number;
}) {
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        left: `${x}%`, top: `${y}%`, width: size, height: size,
        background: `radial-gradient(circle, rgba(${color}, 0.06), transparent 70%)`,
        filter: "blur(20px)",
      }}
      animate={{
        x: [0, 15, -10, 5, 0],
        y: [0, -10, 5, -15, 0],
        scale: [1, 1.1, 0.95, 1.05, 1],
      }}
      transition={{
        duration: 12 + delay * 2, repeat: Infinity, delay,
        ease: "easeInOut" as const,
      }}
    />
  );
}

function Workstation({ x, y, width, isBossHere, isSuccess }: {
  x: number; y: number; width: number; isBossHere: boolean; isSuccess: boolean;
}) {
  return (
    <motion.div
      className="absolute"
      style={{
        left: `${x}%`, top: `${y}%`, width, height: 3, borderRadius: 2,
        transform: "translate(-50%, -50%)",
      }}
      animate={{
        backgroundColor: isBossHere || isSuccess
          ? "rgba(16, 185, 129, 0.15)" : "rgba(99, 102, 241, 0.06)",
        boxShadow: isBossHere || isSuccess
          ? "0 2px 16px rgba(16, 185, 129, 0.1), 0 0 1px rgba(16, 185, 129, 0.3)"
          : "0 2px 8px rgba(99, 102, 241, 0.03)",
      }}
      transition={{ duration: 0.6 }}
    />
  );
}

function Monitor({ x, y, isBossHere, isSuccess, delay }: {
  x: number; y: number; isBossHere: boolean; isSuccess: boolean; delay: number;
}) {
  return (
    <motion.div
      className="absolute overflow-hidden"
      style={{
        left: `${x}%`, top: `${y}%`, width: 30, height: 20, borderRadius: 4,
        transform: "translate(-50%, -50%)", border: "1px solid transparent",
      }}
      animate={{
        backgroundColor: isSuccess
          ? "rgba(16, 185, 129, 0.1)"
          : isBossHere ? "rgba(16, 185, 129, 0.06)" : "rgba(99, 102, 241, 0.04)",
        borderColor: isSuccess
          ? "rgba(16, 185, 129, 0.25)"
          : isBossHere ? "rgba(16, 185, 129, 0.15)" : "rgba(99, 102, 241, 0.08)",
        boxShadow: isSuccess
          ? "0 0 24px rgba(16, 185, 129, 0.12)"
          : isBossHere ? "0 0 14px rgba(16, 185, 129, 0.06)" : "none",
      }}
      transition={{ delay, duration: 0.5 }}
    >
      <motion.div
        className="flex flex-col gap-[2px] p-1.5"
        animate={{ opacity: isSuccess ? 1 : isBossHere ? 0.7 : 0.25 }}
        transition={{ delay: delay + 0.15 }}
      >
        {[80, 55, 70, 45].map((w, i) => (
          <div key={i} className="rounded-sm" style={{
            height: 1.5, width: `${w}%`,
            backgroundColor: isSuccess
              ? `rgba(16, 185, 129, ${0.4 - i * 0.08})`
              : `rgba(99, 102, 241, ${0.15 - i * 0.03})`,
          }} />
        ))}
      </motion.div>
    </motion.div>
  );
}
