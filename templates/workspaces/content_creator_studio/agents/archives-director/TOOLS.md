# TOOLS.md

Use Bash for all local file operations (ls, cp, mv, rm, file, head, find).
Use the Opcify skill to report your step status and output.

For cloud storage operations, check which cloud skill is installed:
  - **Google Cloud Storage** → `python3 scripts/upload.py`, `scripts/signed_url.py`, `scripts/list.py`, `scripts/download.py`, `scripts/delete.py`
  - **Amazon S3** → `python3 scripts/upload.py`, `scripts/presigned_url.py`, `scripts/list.py`, `scripts/download.py`, `scripts/delete.py`
  - **Cloudflare R2** → same script names as S3 (S3-compatible API)

All cloud scripts support `--json` for machine-readable output. Always use `--json` when you need to parse the response (e.g. extracting a signed URL).

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
