# TOOLS.md

Use file-ops for creating and managing files (scripts, metadata, SRT subtitles).
Use code-exec for running scripts (Python, Node.js, bash) and executing FFmpeg commands.
Use the Opcify skill to report your step status and output.

## Platform API Tokens (configured by user via Workspace Helper)

These environment variables may be available if the creator has set them up:

- `YOUTUBE_API_KEY` — YouTube Data API v3 for video uploads and metadata
- `TIKTOK_ACCESS_TOKEN` — TikTok Content Posting API
- `INSTAGRAM_ACCESS_TOKEN` — Instagram Graph API for posts and stories

Check if tokens exist before attempting API calls. If not configured, produce the
content package and note that manual upload is needed.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
