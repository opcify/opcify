"use client";

import { motion, useSpring } from "framer-motion";
import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import type { AuthState, EmployeeConfig } from "./auth-state";
import { BOSS_GREETINGS } from "./auth-state";
import type { MousePosition } from "./use-mouse-position";

interface AiEmployeeProps {
  config: EmployeeConfig;
  state: AuthState;
  index: number;
  mousePos: MousePosition;
}

// ── Idle sway per personality (amplified) ──
function getIdleSway(personality: EmployeeConfig["personality"]) {
  switch (personality) {
    case "lazy":
      return { y: [0, 8, 14, 8, 0], rotate: [0, -5, -10, -5, 0], dur: 5.5 };
    case "nosy":
      return { y: [0, 3, 0], rotate: [0, 10, -8, 14, 0], dur: 4 };
    case "polite":
      return { y: [0, -4, 0, -3, 0], rotate: [0, 2, -2, 0], dur: 6 };
    case "nervous":
      return { y: [0, -3, 0, -5, 0], rotate: [0, 4, -5, 3, 0], dur: 2.6 };
    case "pretender":
      return { y: [0, -2, 0], rotate: [0, 2, -2, 0], dur: 3.5 };
    case "quickReactor":
      return { y: [0, 6, 0, 4, 0], rotate: [0, -3, 5, -2, 0], dur: 4.5 };
  }
}

function getSlackingActivity(p: EmployeeConfig["personality"]): string {
  switch (p) {
    case "lazy": return "💤";
    case "nosy": return "👀";
    case "polite": return "☕";
    case "nervous": return "📱";
    case "pretender": return "⌨️";
    case "quickReactor": return "🎮";
  }
}

function getGossip(p: EmployeeConfig["personality"]): string | null {
  switch (p) {
    case "nosy": return "psst...";
    case "lazy": return "zzz...";
    case "nervous": return "is that...?";
    default: return null;
  }
}

// ── Mouth shape per state/personality ──
type MouthShape = "flat" | "smile" | "bigSmile" | "open" | "nervous" | "yawn" | "whistle";

function getMouthShape(
  state: AuthState,
  personality: EmployeeConfig["personality"],
  pokedAwake?: boolean
): MouthShape {
  const isSlacking = state === "idle_slacking" || state === "signup_idle";
  const isBoss = state === "boss_detected";
  const isPrivacy = state === "password_privacy";
  const isSuccess = state === "success" || state === "signup_success";

  if (isSuccess) return "bigSmile";
  if (isBoss) {
    switch (personality) {
      case "nervous": return "nervous";
      case "polite": return "bigSmile";
      case "quickReactor": return "bigSmile";
      default: return "smile";
    }
  }
  if (isPrivacy) {
    switch (personality) {
      case "nervous": return "nervous";
      case "nosy": return "whistle";
      default: return "flat";
    }
  }
  if (isSlacking) {
    if (personality === "lazy" && pokedAwake) return "open"; // startled awake
    switch (personality) {
      case "lazy": return "yawn";
      case "nosy": return "smile";
      case "nervous": return "nervous";
      case "pretender": return "flat";
      default: return "flat";
    }
  }
  return "flat";
}

export function AiEmployee({ config, state, index, mousePos }: AiEmployeeProps) {
  const { personality, color, reactionDelay } = config;
  const greeting = BOSS_GREETINGS[index % BOSS_GREETINGS.length];
  const gossip = getGossip(personality);
  const slackActivity = getSlackingActivity(personality);
  const sway = getIdleSway(personality);

  const isSlacking = state === "idle_slacking" || state === "signup_idle";
  const isBossHere = state === "boss_detected";
  const isPrivacy = state === "password_privacy";
  const isSuccess = state === "success" || state === "signup_success";

  // ── Poke-to-wake: clicking lazy character wakes it up temporarily ──
  const [pokedAwake, setPokedAwake] = useState(false);
  const pokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    if (personality !== "lazy" || !isSlacking) return;
    setPokedAwake(true);
    // Clear any existing timer
    if (pokeTimerRef.current) clearTimeout(pokeTimerRef.current);
    // Fall back asleep after 20 seconds
    pokeTimerRef.current = setTimeout(() => {
      setPokedAwake(false);
      pokeTimerRef.current = null;
    }, 20000);
  }, [personality, isSlacking]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (pokeTimerRef.current) clearTimeout(pokeTimerRef.current);
    };
  }, []);

  // When no longer slacking, poked state is irrelevant — just ignore it via effectivelyLazy

  // Override lazy-specific behaviors when poked awake
  const effectivelyLazy = personality === "lazy" && !pokedAwake;

  const mouthShape = getMouthShape(state, personality, pokedAwake);

  const showHandCover = isPrivacy && (personality === "polite" || personality === "lazy");
  const showWave = isBossHere && (personality === "polite" || personality === "quickReactor");
  const showBow = isBossHere && personality === "nervous";

  // ── Mouse-relative angle ──
  const dx = mousePos.x - config.position.x / 100;
  const dy = mousePos.y - config.position.y / 100;

  // Body lean toward mouse — large multipliers for visible motion
  const bodyLeanX = dx * 35;
  const bodyLeanY = dy * 15;
  const bodyLeanRotate = dx * 16;

  // Spring-animated body position for smooth, weighty tracking
  const bodySpringConfig = { stiffness: 80, damping: 12, mass: 1.2 };
  const springBodyX = useSpring(0, bodySpringConfig);
  const springBodyY = useSpring(0, bodySpringConfig);
  const springBodyRotate = useSpring(0, bodySpringConfig);

  useEffect(() => {
    // Always update spring targets based on mouse — even slacking gets subtle tracking
    const leanScale = isSlacking ? 0.5 : 1;
    springBodyX.set(isPrivacy ? 0 : bodyLeanX * leanScale);
    springBodyY.set(isPrivacy ? 0 : bodyLeanY * leanScale);
    springBodyRotate.set(isPrivacy ? 0 : showBow ? 18 : bodyLeanRotate * leanScale);
  }, [bodyLeanX, bodyLeanY, bodyLeanRotate, isPrivacy, showBow, springBodyX, springBodyY, springBodyRotate, isSlacking]);

  // Head rotation toward mouse
  const headTrackRotate = useMemo(() => {
    if (isPrivacy) {
      switch (personality) {
        case "lazy": return -50;
        case "nosy": return 55;
        case "polite": return -60;
        case "nervous": return 65;
        case "pretender": return -45;
        case "quickReactor": return 50;
      }
    }
    if (isBossHere) return dx * 20;
    if (isSlacking) {
      const base = personality === "lazy" ? -25 : personality === "nosy" ? 30 : 0;
      return base + dx * 12;
    }
    return dx * 30;
  }, [isPrivacy, isBossHere, isSlacking, personality, dx]);

  // ── Pupil offset ──
  const maxPupilX = 5.5;
  const maxPupilY = 4;

  const pupilTarget = useMemo(() => {
    if (isPrivacy) {
      switch (personality) {
        case "polite":
        case "nervous": return { x: 0, y: 0, closed: true };
        case "nosy": return { x: maxPupilX, y: -1, closed: false };
        case "lazy": return { x: 0, y: -maxPupilY, closed: false };
        default: return { x: -maxPupilX, y: -2, closed: false };
      }
    }
    const px = Math.max(-maxPupilX, Math.min(maxPupilX, dx * 45));
    const py = Math.max(-maxPupilY, Math.min(maxPupilY, dy * 35));
    return { x: px, y: py, closed: false };
  }, [isPrivacy, personality, dx, dy]);

  const isEyeClosed = pupilTarget.closed || (isSlacking && effectivelyLazy);

  // ── Posture (amplified) ──
  const postureY = isBossHere ? -8 : isSuccess ? -5 : isSlacking
    ? (pokedAwake ? -2 : 6) : 0;
  const postureScaleY = isBossHere ? 1.06 : isSuccess ? 1.03 : isSlacking
    ? (effectivelyLazy ? 0.82 : pokedAwake ? 1.0 : 0.88) : 0.96;

  // ── Dimensions (TALLER) ──
  const headSize = 50;
  const torsoW = 48;
  const torsoH = 54;
  const bodyH = 100;
  const W = 64;

  // Eye dimensions
  const eyeW = 17;
  const eyeH = 15;
  const pupilSize = 8;

  return (
    <motion.div
      className="absolute flex flex-col items-center"
      style={{
        left: `${config.position.x}%`,
        top: `${config.position.y}%`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.round(config.position.y),
        cursor: personality === "lazy" && isSlacking ? "pointer" : "default",
      }}
      onClick={handleClick}
      initial={{ opacity: 0, scale: 0.5, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        delay: 0.3 + index * 0.12,
        duration: 0.8,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileTap={personality === "lazy" && isSlacking ? { scale: 0.95 } : undefined}
    >
      {/* Poked awake bubble */}
      <motion.div
        className="absolute whitespace-nowrap rounded-xl px-3.5 py-1.5 text-xs font-semibold"
        style={{
          top: -22,
          backgroundColor: "rgba(245, 158, 11, 0.12)",
          color: "#fbbf24",
          border: "1px solid rgba(245, 158, 11, 0.25)",
          backdropFilter: "blur(12px)",
          zIndex: 20,
        }}
        initial={{ opacity: 0, y: 10, scale: 0.7 }}
        animate={
          pokedAwake
            ? { opacity: 1, y: 0, scale: 1 }
            : { opacity: 0, y: 10, scale: 0.7 }
        }
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        Huh?! I&apos;m awake!
        <div
          className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45"
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.12)",
            borderRight: "1px solid rgba(245, 158, 11, 0.25)",
            borderBottom: "1px solid rgba(245, 158, 11, 0.25)",
          }}
        />
      </motion.div>

      {/* Greeting bubble */}
      <motion.div
        className="absolute whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold"
        style={{
          top: -22,
          backgroundColor: "rgba(16, 185, 129, 0.12)",
          color: "#34d399",
          border: "1px solid rgba(16, 185, 129, 0.25)",
          backdropFilter: "blur(12px)",
          zIndex: 20,
        }}
        initial={{ opacity: 0, y: 10, scale: 0.7 }}
        animate={
          isBossHere
            ? { opacity: 1, y: 0, scale: 1 }
            : { opacity: 0, y: 10, scale: 0.7 }
        }
        transition={{
          delay: isBossHere ? reactionDelay + 0.3 : 0,
          duration: 0.35,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        {greeting}
        <div
          className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45"
          style={{
            backgroundColor: "rgba(16, 185, 129, 0.12)",
            borderRight: "1px solid rgba(16, 185, 129, 0.25)",
            borderBottom: "1px solid rgba(16, 185, 129, 0.25)",
          }}
        />
      </motion.div>

      {/* Gossip bubble */}
      {gossip && (
        <motion.div
          className="absolute whitespace-nowrap rounded-lg px-2.5 py-1 text-xs"
          style={{
            top: -14,
            backgroundColor: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.35)",
            border: "1px solid rgba(255,255,255,0.06)",
            zIndex: 15,
          }}
          animate={
            isSlacking
              ? { opacity: [0, 0.8, 0.8, 0], y: [6, 0, 0, -6] }
              : { opacity: 0 }
          }
          transition={
            isSlacking
              ? { duration: 4.5, repeat: Infinity, delay: reactionDelay * 3 }
              : { duration: 0.2 }
          }
        >
          {gossip}
        </motion.div>
      )}

      {/* Slacking activity emoji */}
      <motion.div
        className="absolute -right-5 -top-3 text-base"
        style={{ zIndex: 15 }}
        animate={
          isSlacking
            ? { opacity: [0, 0.8, 0.8, 0], scale: [0.7, 1, 1, 0.7], y: [3, 0, 0, -3] }
            : { opacity: 0, scale: 0.7 }
        }
        transition={
          isSlacking
            ? { duration: 3.5, repeat: Infinity, delay: index * 0.6 }
            : { duration: 0.2 }
        }
      >
        {slackActivity}
      </motion.div>

      {/* ── Character body ── */}
      <motion.div
        className="relative"
        style={{
          x: springBodyX,
          rotate: springBodyRotate,
        }}
        animate={
          isSlacking
            ? {
                y: sway.y,
                scaleY: postureScaleY,
              }
            : {
                scaleY: postureScaleY,
                y: postureY,
              }
        }
        transition={
          isSlacking
            ? { duration: sway.dur, repeat: Infinity, ease: "easeInOut" as const }
            : { delay: reactionDelay, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }
        }
      >
        {/* Ground shadow */}
        <motion.div
          className="absolute left-1/2 -translate-x-1/2 rounded-full"
          style={{ bottom: -5, width: W * 0.7, height: 8 }}
          animate={{
            backgroundColor: isBossHere || isSuccess
              ? "rgba(16, 185, 129, 0.12)"
              : isSlacking ? "rgba(245, 158, 11, 0.05)" : `${color}08`,
            boxShadow: isBossHere || isSuccess
              ? "0 0 24px rgba(16, 185, 129, 0.15)" : "none",
          }}
          transition={{ delay: reactionDelay, duration: 0.4 }}
        />

        <div className="relative mx-auto" style={{ width: W, height: bodyH }}>
          {/* ── Torso (taller) ── */}
          <motion.div
            className="absolute bottom-0 left-1/2 -translate-x-1/2"
            style={{
              width: torsoW,
              height: torsoH,
              borderRadius: "16px 16px 12px 12px",
              background: `linear-gradient(160deg, ${color}50, ${color}25)`,
              border: `1.5px solid ${color}40`,
              boxShadow: `0 6px 28px ${color}12, inset 0 1px 0 ${color}30`,
            }}
            animate={
              isBossHere
                ? { scaleY: 1, scaleX: 1 }
                : isSlacking
                  ? { scaleY: 0.85, scaleX: 1.08 }
                  : { scaleY: 0.95, scaleX: 1 }
            }
            transition={{ delay: reactionDelay, duration: 0.5 }}
          >
            {/* ID badge */}
            <div
              className="absolute left-1/2 top-3 -translate-x-1/2 rounded"
              style={{
                width: 12, height: 7,
                backgroundColor: `${color}30`,
                border: `0.5px solid ${color}50`,
              }}
            />
          </motion.div>

          {/* ── Head ── */}
          <motion.div
            className="absolute left-1/2 top-0 -translate-x-1/2"
            style={{
              width: headSize,
              height: headSize,
              borderRadius: "50%",
              background: `linear-gradient(170deg, ${color}70, ${color}40)`,
              border: `2px solid ${color}55`,
              boxShadow: `0 4px 20px ${color}20, inset 0 -5px 10px ${color}12`,
            }}
            animate={{ rotate: headTrackRotate }}
            transition={{
              type: "spring",
              stiffness: 150,
              damping: 15,
              mass: 0.8,
            }}
          >
            {/* ── Face visor ── */}
            <div
              className="absolute left-1/2 -translate-x-1/2 overflow-visible"
              style={{
                top: "22%",
                width: 42,
                height: 28,
                borderRadius: 10,
                backgroundColor: `${color}10`,
                border: `1px solid ${color}20`,
                boxShadow: `inset 0 0 8px ${color}08`,
              }}
            >
              {/* ── Eyes ── */}
              <div className="flex items-center justify-center gap-2" style={{ paddingTop: 3 }}>
                <RobotEye
                  pupilX={pupilTarget.x}
                  pupilY={pupilTarget.y}
                  closed={isEyeClosed}
                  half={isSlacking && personality !== "lazy"}
                  eyeW={eyeW}
                  eyeH={eyeH}
                  pupilSize={pupilSize}
                />
                <RobotEye
                  pupilX={pupilTarget.x}
                  pupilY={pupilTarget.y}
                  closed={isEyeClosed}
                  half={isSlacking && personality !== "lazy"}
                  eyeW={eyeW}
                  eyeH={eyeH}
                  pupilSize={pupilSize}
                />
              </div>

              {/* ── Mouth ── */}
              <div className="flex justify-center" style={{ marginTop: 2 }}>
                <RobotMouth
                  shape={mouthShape}
                  color={color}
                  reactionDelay={reactionDelay}
                />
              </div>
            </div>

            {/* Antenna */}
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{ top: -5, width: 3, height: 10 }}
            >
              <div style={{
                width: 3, height: 10,
                backgroundColor: `${color}50`, borderRadius: 2,
              }} />
              <motion.div
                className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full"
                style={{ width: 7, height: 7 }}
                animate={{
                  backgroundColor: isBossHere || isSuccess
                    ? "#10b981" : isSlacking ? "#f59e0b" : `${color}80`,
                  boxShadow: isBossHere || isSuccess
                    ? "0 0 12px #10b98180"
                    : isSlacking ? "0 0 8px #f59e0b40" : `0 0 5px ${color}30`,
                  scale: isBossHere ? [1, 1.4, 1] : 1,
                }}
                transition={{
                  delay: reactionDelay,
                  duration: isBossHere ? 0.8 : 0.3,
                  repeat: isBossHere ? Infinity : 0,
                }}
              />
            </div>

            {/* Ear accents */}
            <div
              className="absolute left-0 top-1/2 -translate-x-[60%] -translate-y-1/2 rounded-full"
              style={{ width: 7, height: 10, backgroundColor: `${color}30`, border: `1px solid ${color}40` }}
            />
            <div
              className="absolute right-0 top-1/2 translate-x-[60%] -translate-y-1/2 rounded-full"
              style={{ width: 7, height: 10, backgroundColor: `${color}30`, border: `1px solid ${color}40` }}
            />
          </motion.div>

          {/* ── Arms (longer for taller body) ── */}
          <motion.div
            className="absolute"
            style={{
              width: 8, height: 34, left: -4, top: 42,
              background: `linear-gradient(180deg, ${color}40, ${color}20)`,
              border: `1px solid ${color}35`, borderRadius: 5,
              transformOrigin: "top center",
            }}
            animate={
              showHandCover
                ? { rotate: -75, y: -22, x: 16 }
                : showWave
                  ? { rotate: [-45, -80, -45], y: -16 }
                  : isSlacking && effectivelyLazy
                    ? { rotate: 22, y: 4, x: -4 }
                    : isSlacking
                      ? { rotate: 12, y: 0, x: 0 }
                      : { rotate: dx * 8, y: 0, x: 0 }
            }
            transition={
              showWave
                ? { duration: 0.5, repeat: 4, delay: reactionDelay, ease: "easeInOut" as const }
                : { delay: reactionDelay, duration: 0.45 }
            }
          />
          <motion.div
            className="absolute"
            style={{
              width: 8, height: 34, right: -4, top: 42,
              background: `linear-gradient(180deg, ${color}40, ${color}20)`,
              border: `1px solid ${color}35`, borderRadius: 5,
              transformOrigin: "top center",
            }}
            animate={
              showHandCover
                ? { rotate: 75, y: -22, x: -16 }
                : isSlacking && personality === "pretender"
                  ? { rotate: [-8, -18, -8], y: [-2, -5, -2] }
                  : isSlacking
                    ? { rotate: -10, y: 0, x: 0 }
                    : { rotate: -dx * 8, y: 0, x: 0 }
            }
            transition={
              isSlacking && personality === "pretender"
                ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" as const }
                : { delay: reactionDelay, duration: 0.45 }
            }
          />

          {/* ── Legs (longer) ── */}
          <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            <div style={{
              width: 10, height: 10, borderRadius: "0 0 5px 5px",
              backgroundColor: `${color}22`, border: `1px solid ${color}28`, borderTop: "none",
            }} />
            <div style={{
              width: 10, height: 10, borderRadius: "0 0 5px 5px",
              backgroundColor: `${color}22`, border: `1px solid ${color}28`, borderTop: "none",
            }} />
          </div>
        </div>
      </motion.div>

      {/* Name tag */}
      <motion.div
        className="mt-2.5 rounded-md px-2.5 py-0.5 text-center"
        style={{
          fontSize: 11, fontWeight: 600,
          color: `${color}aa`, backgroundColor: `${color}08`,
          border: `1px solid ${color}15`, letterSpacing: "0.02em",
        }}
        animate={
          isBossHere
            ? { opacity: 1, borderColor: "rgba(16, 185, 129, 0.2)", color: "#34d399" }
            : { opacity: 0.7, borderColor: `${color}15`, color: `${color}aa` }
        }
        transition={{ delay: reactionDelay + 0.2 }}
      >
        {config.name}
      </motion.div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════
// ── Robot Eye: white sclera + BLACK pupil ──
// ══════════════════════════════════════════════════
function RobotEye({
  pupilX,
  pupilY,
  closed,
  half,
  eyeW,
  eyeH,
  pupilSize,
}: {
  pupilX: number;
  pupilY: number;
  closed: boolean;
  half: boolean;
  eyeW: number;
  eyeH: number;
  pupilSize: number;
}) {
  const springConfig = { stiffness: 200, damping: 20, mass: 0.5 };
  const springX = useSpring(pupilX, springConfig);
  const springY = useSpring(pupilY, springConfig);

  springX.set(pupilX);
  springY.set(pupilY);

  if (closed) {
    return (
      <motion.div
        style={{
          width: eyeW, height: 2.5, borderRadius: 2,
          backgroundColor: "rgba(255,255,255,0.3)",
        }}
        animate={{ scaleX: [1, 0.8, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" as const }}
      />
    );
  }

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: eyeW,
        height: half ? eyeH * 0.55 : eyeH,
        borderRadius: "50%",
        backgroundColor: "rgba(255, 255, 255, 0.92)",
        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.12), 0 0 6px rgba(255,255,255,0.1)",
        transition: "height 0.3s ease",
      }}
    >
      {/* Black pupil (spring-animated) */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: pupilSize,
          height: pupilSize,
          left: "50%",
          top: "50%",
          marginLeft: -pupilSize / 2,
          marginTop: -pupilSize / 2,
          backgroundColor: "#111111",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          x: springX,
          y: springY,
        }}
      >
        {/* Specular highlight */}
        <div
          className="absolute rounded-full"
          style={{
            width: 3,
            height: 3,
            top: 1,
            right: 1,
            backgroundColor: "rgba(255,255,255,0.85)",
          }}
        />
        {/* Secondary smaller highlight */}
        <div
          className="absolute rounded-full"
          style={{
            width: 1.5,
            height: 1.5,
            bottom: 2,
            left: 1.5,
            backgroundColor: "rgba(255,255,255,0.4)",
          }}
        />
      </motion.div>
    </div>
  );
}

// ══════════════════════════════════════════════════
// ── Robot Mouth ──
// ══════════════════════════════════════════════════
function RobotMouth({
  shape,
  color: _color,
  reactionDelay,
}: {
  shape: MouthShape;
  color: string;
  reactionDelay: number;
}) {
  const mouthColor = "rgba(255,255,255,0.5)";

  switch (shape) {
    case "bigSmile":
      return (
        <motion.div
          style={{
            width: 16, height: 8, borderRadius: "0 0 8px 8px",
            borderBottom: `2px solid ${mouthColor}`,
            borderLeft: `1.5px solid ${mouthColor}`,
            borderRight: `1.5px solid ${mouthColor}`,
          }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: reactionDelay + 0.2, duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
        />
      );
    case "smile":
      return (
        <motion.div
          style={{
            width: 12, height: 5, borderRadius: "0 0 6px 6px",
            borderBottom: `2px solid ${mouthColor}`,
            borderLeft: `1px solid transparent`,
            borderRight: `1px solid transparent`,
          }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: reactionDelay + 0.2, duration: 0.3 }}
        />
      );
    case "open":
      return (
        <motion.div
          style={{
            width: 10, height: 6, borderRadius: "50%",
            backgroundColor: "rgba(0,0,0,0.3)",
            border: `1px solid ${mouthColor}`,
          }}
          animate={{ scaleY: [1, 1.2, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" as const }}
        />
      );
    case "nervous":
      return (
        <motion.svg width="14" height="6" viewBox="0 0 14 6" style={{ overflow: "visible" }}>
          <motion.path
            d="M1 3 Q3.5 1, 5 3 Q7 5, 9 3 Q11 1, 13 3"
            stroke={mouthColor}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: reactionDelay + 0.2, duration: 0.4 }}
          />
        </motion.svg>
      );
    case "yawn":
      return (
        <motion.div
          style={{
            width: 8, height: 8, borderRadius: "50%",
            backgroundColor: "rgba(0,0,0,0.25)",
            border: `1.5px solid ${mouthColor}`,
          }}
          animate={{ scaleY: [0.8, 1.3, 0.8], scaleX: [1, 0.9, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" as const }}
        />
      );
    case "whistle":
      return (
        <motion.div
          style={{
            width: 6, height: 6, borderRadius: "50%",
            backgroundColor: "rgba(0,0,0,0.2)",
            border: `1.5px solid ${mouthColor}`,
          }}
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" as const }}
        />
      );
    case "flat":
    default:
      return (
        <motion.div
          style={{
            width: 10, height: 0,
            borderBottom: `2px solid rgba(255,255,255,0.3)`,
            borderRadius: 1,
          }}
          animate={{ scaleX: [0.9, 1, 0.9] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" as const }}
        />
      );
  }
}
