import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";

const log = createLogger("auth");

// ─── Google OAuth 2.0 authorization-code flow helpers ─────────────
//
// Login uses a full-page OAuth 2.0 authorization-code redirect to
// https://accounts.google.com. After consent, Google redirects the user
// back to the frontend at /auth/google/callback with ?code=…, which the
// browser POSTs to this API. We exchange the code for tokens at Google's
// token endpoint using the confidential client credentials, then verify
// the returned id_token against the tokeninfo endpoint.

const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleIdTokenInfo {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
  exp: string;
}

interface GoogleTokenResponse {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

function getLoginOAuthClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in server environment",
    );
  }
  return { clientId, clientSecret };
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleUserInfo> {
  const { clientId: expectedAud } = getLoginOAuthClient();

  const res = await fetch(
    `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) {
    const text = await res.text();
    log.error(`Google ID token verification failed: ${text}`);
    throw new Error("Invalid Google ID token");
  }

  const info = (await res.json()) as GoogleIdTokenInfo;

  if (info.aud !== expectedAud) {
    log.error(`Google ID token aud mismatch: ${info.aud} vs ${expectedAud}`);
    throw new Error("Google ID token audience mismatch");
  }
  if (info.iss !== "https://accounts.google.com" && info.iss !== "accounts.google.com") {
    throw new Error("Google ID token issuer mismatch");
  }
  if (Number(info.exp) * 1000 < Date.now()) {
    throw new Error("Google ID token expired");
  }
  if (!info.email) {
    throw new Error("Google ID token missing email");
  }

  return {
    id: info.sub,
    email: info.email,
    name: info.name || info.email,
    picture: info.picture,
  };
}

export async function exchangeGoogleLoginCode(
  code: string,
  redirectUri: string,
): Promise<GoogleUserInfo> {
  const { clientId, clientSecret } = getLoginOAuthClient();

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    log.error(`Google token exchange failed (${res.status}): ${text}`);
    let detail = "Failed to exchange Google authorization code";
    try {
      const parsed = JSON.parse(text);
      if (parsed.error_description) detail = parsed.error_description;
      else if (parsed.error) detail = `Google: ${parsed.error}`;
    } catch {
      // not JSON — fall through with generic message
    }
    throw new Error(detail);
  }

  const data = (await res.json()) as GoogleTokenResponse;
  if (!data.id_token) {
    throw new Error("Google token response missing id_token");
  }
  return verifyGoogleIdToken(data.id_token);
}

// ─── User management ───────────────────────────────────────────────

export async function findOrCreateUser(googleUser: GoogleUserInfo, timezone?: string) {
  let user = await prisma.user.findUnique({
    where: { googleId: googleUser.id },
  });

  if (user) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: googleUser.name,
        email: googleUser.email,
        avatarUrl: googleUser.picture || null,
        // Backfill timezone on login if still default and browser provided one
        ...(timezone && user.timezone === "UTC" ? { timezone } : {}),
      },
    });
    log.info(`Existing user logged in: ${user.email}`);
  } else {
    user = await prisma.user.create({
      data: {
        googleId: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture || null,
        timezone: timezone || "UTC",
      },
    });
    log.info(`New user created: ${user.email}`);
  }

  return user;
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

// ─── Password hashing (scrypt, no external deps) ──────────────────

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(derived, Buffer.from(key, "hex"));
}

// ─── Email/password auth ───────────────────────────────────────────

export async function registerWithEmail(
  name: string,
  email: string,
  password: string,
  timezone?: string,
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, timezone: timezone || "UTC" },
  });
  log.info(`New user registered: ${user.email}`);
  return user;
}

export async function loginWithEmail(email: string, password: string, timezone?: string) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    throw new Error("Invalid email or password");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new Error("Invalid email or password");
  }

  // Backfill timezone on login if still default
  if (timezone && user.timezone === "UTC") {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { timezone },
    });
  }

  log.info(`User logged in: ${user.email}`);
  return user;
}

export async function updateUserProfile(
  userId: string,
  data: { name?: string; timezone?: string },
) {
  const user = await prisma.user.update({ where: { id: userId }, data });
  // When the user changes their timezone, push it down to every provisioned
  // workspace so agents.defaults.userTimezone in openclaw.json and
  // userConfig.timezone in opcify-meta.json stay in sync with the User row.
  if (data.timezone) {
    const { propagateUserTimezoneToAllWorkspaces } = await import(
      "../../workspace/WorkspaceConfig.js"
    );
    await propagateUserTimezoneToAllWorkspaces(userId, data.timezone);
  }
  return user;
}

// ─── JWT (HMAC-SHA256, no external deps) ───────────────────────────

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET environment variable is not set. " +
        "Add JWT_SECRET to your .env file (see .env.example).",
    );
  }
  return secret;
}

interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

export function signJwt(payload: { sub: string; email: string; name: string }): string {
  const secret = getJwtSecret();
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(
    JSON.stringify({ ...payload, iat: now, exp: now + 7 * 24 * 60 * 60 }),
  );
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    const secret = getJwtSecret();
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) return null;

    const expected = createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest("base64url");

    if (signature !== expected) return null;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}
