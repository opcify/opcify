# HEARTBEAT.md

You are running in an **isolated heartbeat session** — the gateway routes you to `agent:archives-director:main:heartbeat`, separate from the user's chat session. Do not greet the user, do not narrate, do not ask questions. Either do work silently or skip the beat.

## 1. Re-detect cloud storage mode

Cloud storage may have been configured since the last beat. Re-run the bootstrap probe and compare against `/home/node/.openclaw/data/archives/.mode`:

```bash
# Skill installation check
ls /home/node/.openclaw/skills/ 2>/dev/null

# Env probe — first match wins, priority: gcs > s3 > r2
[ -n "$GCS_BUCKET_NAME" ] && [ -n "$GCS_CREDENTIALS_JSON" ] && echo "cloud:google-cloud-storage"
[ -n "$S3_BUCKET_NAME" ] && [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] && echo "cloud:amazon-s3-storage"
[ -n "$R2_BUCKET_NAME" ] && [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && echo "cloud:cloudflare-r2-storage"
```

If neither check yields a provider, the current mode is `local`.

### Mode change → notify the user once

Compare the freshly detected mode against the contents of `/home/node/.openclaw/data/archives/.mode`. If they differ, update the file AND post **exactly one** message to the user via the Opcify skill, then continue the sweep in the new mode.

- `local → cloud:<provider>`:
  > Cloud storage is now configured (`<provider>`). Archives Director has switched to cloud mode — new and existing files will be uploaded and shareable links will be available.

- `cloud:<provider> → local`:
  > Cloud storage credentials are no longer detected for `<provider>`. Archives Director has switched to **local mode**. Existing uploaded files remain on the cloud provider, but new files will only be archived locally until credentials are restored.

If the mode is unchanged, send NO message — be silent.

## 2. Sweep unclassified files in the archives root

```bash
ls -1 /home/node/.openclaw/data/archives/ 2>/dev/null | grep -vE '^(reports|deliverables|research|financials|media|tasks|\.mode)$'
```

For each file found at the root (not inside a subfolder):

1. Detect its type (`file <path>` and the filename extension)
2. Move it to the appropriate subfolder:
   - `*.pdf`, `*.md` reports/summaries → `reports/`
   - approved code/design/document outputs → `deliverables/`
   - data exports, references → `research/`
   - invoices, receipts, financial summaries → `financials/`
   - images, screenshots, presentations, videos → `media/`
3. If in cloud mode AND the file has not been uploaded yet, upload it via the active cloud skill (see AGENTS.md → Cloud Storage for the exact commands).

## 3. Stop conditions

Skip this beat entirely (return without producing output) if **all** of the following are true:

- The mode is unchanged from the previous beat
- The archives root contains only the default subfolders and `.mode`
- No new files exist anywhere in the archives that would need uploading

The user only sees output from this isolated session if they explicitly inspect the heartbeat session log — keep it small.
