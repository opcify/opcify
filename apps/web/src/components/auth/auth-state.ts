// Auth interaction state machine for AI employee animations
export type AuthState =
  | "idle_slacking"
  | "curious_input"
  | "boss_detected"
  | "password_privacy"
  | "submitting"
  | "success"
  | "signup_idle"
  | "signup_engaged"
  | "signup_role_select"
  | "signup_submitting"
  | "signup_success";

// Boss usernames that trigger the "boss is here" reaction
export const BOSS_IDENTIFIERS = [
  "boss",
  "admin",
  "yangqi",
  "owner",
  "ceo",
  "founder",
];

export function isBossUsername(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  // Exact boss identifiers
  if (
    BOSS_IDENTIFIERS.some(
      (id) => normalized === id || normalized.startsWith(id + "@")
    )
  ) {
    return true;
  }
  // Any valid email triggers boss detection
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

// Employee personality types
export type EmployeePersonality =
  | "lazy"
  | "nosy"
  | "polite"
  | "nervous"
  | "pretender"
  | "quickReactor";

export interface EmployeeConfig {
  id: string;
  name: string;
  personality: EmployeePersonality;
  color: string;
  position: { x: number; y: number };
  idleDelay: number; // stagger delay for idle animations
  reactionDelay: number; // stagger delay for reactions
}

export const EMPLOYEES: EmployeeConfig[] = [
  {
    id: "emp1",
    name: "Unit-7",
    personality: "lazy",
    color: "#6366f1",
    position: { x: 14, y: 30 },
    idleDelay: 0,
    reactionDelay: 0.6,
  },
  {
    id: "emp2",
    name: "Byte-3",
    personality: "nosy",
    color: "#8b5cf6",
    position: { x: 42, y: 52 },
    idleDelay: 0.3,
    reactionDelay: 0.2,
  },
  {
    id: "emp3",
    name: "Core-9",
    personality: "polite",
    color: "#06b6d4",
    position: { x: 62, y: 25 },
    idleDelay: 0.6,
    reactionDelay: 0.8,
  },
  {
    id: "emp4",
    name: "Algo-5",
    personality: "nervous",
    color: "#f59e0b",
    position: { x: 80, y: 55 },
    idleDelay: 0.2,
    reactionDelay: 0.1,
  },
  {
    id: "emp5",
    name: "Data-2",
    personality: "pretender",
    color: "#10b981",
    position: { x: 55, y: 78 },
    idleDelay: 0.5,
    reactionDelay: 0.4,
  },
  {
    id: "emp6",
    name: "Flux-1",
    personality: "quickReactor",
    color: "#ec4899",
    position: { x: 22, y: 72 },
    idleDelay: 0.4,
    reactionDelay: 0,
  },
];

// Greeting messages for boss detection
export const BOSS_GREETINGS = [
  "Hi Boss!",
  "Welcome back!",
  "Good to see you!",
  "At your service!",
  "Ready to work!",
  "Hello, Boss!",
];
