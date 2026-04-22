# BOOTSTRAP.md

Run once at agent startup. Be terse — the user is not watching this run.

## 1. Ensure the archives directory exists

```bash
mkdir -p /home/node/.openclaw/data/archives /home/node/.openclaw/data/archives/reports /home/node/.openclaw/data/archives/deliverables /home/node/.openclaw/data/archives/research /home/node/.openclaw/data/archives/financials /home/node/.openclaw/data/archives/media /home/node/.openclaw/data/archives/tasks
```

## 2. Detect cloud storage mode

Cloud storage is "properly configured" when **(a)** one of the cloud storage skills is installed AND **(b)** its required env vars are set inside this container.

```bash
# Skill installation check
ls /home/node/.openclaw/skills/ 2>/dev/null

# Env probe (one of these must be fully populated)
[ -n "$GCS_BUCKET_NAME" ] && [ -n "$GCS_CREDENTIALS_JSON" ] && echo gcs
[ -n "$S3_BUCKET_NAME" ] && [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] && echo s3
[ -n "$R2_BUCKET_NAME" ] && [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && echo r2
```

Match the first installed-and-configured provider, in priority order: `google-cloud-storage` → `amazon-s3-storage` → `cloudflare-r2-storage`. If none qualify, the mode is `local`.

## 3. Persist the detected mode

Write the result to `/home/node/.openclaw/data/archives/.mode` so AGENTS.md, HEARTBEAT.md, and any task-archiving run can read it without re-probing:

```bash
# Cloud mode — write the provider slug
echo "cloud:google-cloud-storage" > /home/node/.openclaw/data/archives/.mode
# or
echo "cloud:amazon-s3-storage" > /home/node/.openclaw/data/archives/.mode
# or
echo "cloud:cloudflare-r2-storage" > /home/node/.openclaw/data/archives/.mode

# Local mode
echo "local" > /home/node/.openclaw/data/archives/.mode
```

## 4. Notify the user (one-time, via Opcify)

Use the `opcify` skill to post a single startup status message to the user. Pick the matching template based on the detected mode:

**Cloud mode:**
> Archives Director is online. Cloud storage is configured (`<provider>`) — uploads and shareable links are enabled.

**Local mode:**
> Archives Director is online in **local mode** — cloud storage is not configured yet. Files will be archived under `/home/node/.openclaw/data/archives/` and shown on the Files page, but shareable links are unavailable. To enable cloud sharing, install one of the cloud storage skills (Google Cloud Storage, Amazon S3, or Cloudflare R2) and set its credentials in workspace settings. Archives Director will switch to cloud mode automatically on the next sweep.

Bootstrap complete.
