const TOKEN_KEY = "opcify_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export async function updateProfile(
  data: { name?: string; timezone?: string },
): Promise<AuthUser> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4210";
  const token = getToken();
  const res = await fetch(`${apiUrl}/auth/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update profile");
  return res.json();
}

// ─── Google OAuth 2.0 authorization-code flow (full-page redirect) ─
//
// The login button builds an authorization URL and navigates the browser
// to accounts.google.com. Google redirects back to /auth/google/callback
// with ?code=…&state=…, which the callback page exchanges for an Opcify
// session via the /auth/google backend endpoint. A random state value is
// stored in sessionStorage to protect against CSRF; the callback verifies
// it matches before exchanging the code.

const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "345610089778-rgga92qbmjvc5ia9h6kb1am7bjafkrhh.apps.googleusercontent.com";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE_STORAGE_KEY = "opcify_google_oauth_state";

export function getGoogleRedirectUri(): string {
  return `${window.location.origin}/auth/google/callback`;
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function beginGoogleSignIn(): void {
  const state = generateState();
  sessionStorage.setItem(STATE_STORAGE_KEY, state);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state,
  });
  window.location.href = `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function consumeGoogleOAuthState(): string | null {
  const stored = sessionStorage.getItem(STATE_STORAGE_KEY);
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  return stored;
}

export async function completeGoogleSignIn(
  code: string,
  redirectUri: string,
): Promise<{ token: string; user: AuthUser }> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4210";
  const res = await fetch(`${apiUrl}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      redirectUri,
      timezone: getBrowserTimezone(),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || "Authentication failed");
  }

  const data = await res.json();
  setToken(data.token);
  return data;
}

// The Gmail Inbox connect flow (apps/web/src/lib/gmail-auth.ts) still uses
// Google Identity Services' oauth2.initCodeClient popup. Keep the type
// declaration for that API here so the shared `window.google` augmentation
// lives in one place.
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode: string;
            access_type?: string;
            prompt?: string;
            callback: (response: { code?: string; error?: string }) => void;
          }) => { requestCode: () => void };
        };
      };
    };
  }
}
