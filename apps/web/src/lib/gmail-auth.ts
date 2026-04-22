/**
 * Gmail OAuth helper — requests mail access via Google Identity Services popup.
 * Separate from login flow: uses mail scope + offline access to get refresh_token.
 */

// Dedicated Gmail OAuth client — SEPARATE from the login client so that
// the mail scope is not listed on the /login or /signup consent screen.
// Register a second OAuth 2.0 Client in Google Cloud Console with only
// https://mail.google.com/ as its scope, and set NEXT_PUBLIC_GOOGLE_GMAIL_CLIENT_ID.
const GOOGLE_GMAIL_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_GMAIL_CLIENT_ID;

let gsiLoadPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (typeof window !== "undefined" && window.google) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;

  gsiLoadPromise = new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      if (window.google) resolve();
      else
        reject(
          new Error("Google Sign-In script loaded but window.google is missing"),
        );
    };
    const onFailed = () => {
      gsiLoadPromise = null;
      reject(new Error("Failed to load Google Sign-In"));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="accounts.google.com/gsi/client"]',
    );
    if (existing) {
      if (window.google) {
        resolve();
        return;
      }
      existing.addEventListener("load", onLoaded, { once: true });
      existing.addEventListener("error", onFailed, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.addEventListener("load", onLoaded, { once: true });
    script.addEventListener("error", onFailed, { once: true });
    document.head.appendChild(script);
  }).catch((err) => {
    gsiLoadPromise = null;
    throw err;
  });

  return gsiLoadPromise;
}

/**
 * Opens a Google OAuth popup requesting Gmail access.
 * Returns the authorization code to be exchanged by the backend.
 */
export async function requestGmailAccess(): Promise<string> {
  if (!GOOGLE_GMAIL_CLIENT_ID) {
    throw new Error(
      "Gmail OAuth client is not configured (NEXT_PUBLIC_GOOGLE_GMAIL_CLIENT_ID)",
    );
  }
  await loadGoogleScript();

  const google = window.google;
  if (!google) throw new Error("Google Sign-In not available");

  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_GMAIL_CLIENT_ID,
      scope: "https://mail.google.com/",
      ux_mode: "popup",
      access_type: "offline",
      prompt: "consent",
      callback: (response) => {
        if (response.error || !response.code) {
          reject(
            new Error(response.error || "No authorization code"),
          );
        } else {
          resolve(response.code);
        }
      },
    });
    client.requestCode();
  });
}
