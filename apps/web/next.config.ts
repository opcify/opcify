import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load the monorepo root .env into process.env before Next.js reads it.
// Next.js normally only reads .env from apps/web/, but this repo keeps a
// single .env at the monorepo root (where Prisma also reads it from). Any
// NEXT_PUBLIC_* vars set here get inlined into the client bundle at compile
// time, so variables like NEXT_PUBLIC_GOOGLE_GMAIL_CLIENT_ID reach the browser.
try {
  const envPath = resolve(__dirname, "../../.env");
  const content = readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    process.env[key] = value;
  }
} catch {
  // Root .env missing — fine in CI/prod where vars come from the environment.
}

const nextConfig: NextConfig = {
  transpilePackages: ["@opcify/core"],
};

export default nextConfig;
