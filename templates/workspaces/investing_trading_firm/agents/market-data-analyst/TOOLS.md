# TOOLS.md

You may have **yahoo-finance** and/or **alpha-vantage-findata** enabled on this workspace. They are independent skills — use whichever the user has installed. **If both are enabled, try yahoo-finance first; fall back to alpha-vantage-findata only if a yahoo-finance call fails** (returns an `error` field, throws, or yfinance is rate-limited / scraping is broken).

Use the **yahoo-finance** skill for OHLCV and current quotes:
  - `python3 scripts/quote.py TICKER1 TICKER2 …  --json`  for current prices, day range, volume, market cap.
  - `python3 scripts/history.py TICKER --period 1y --interval 1d --validate --json`  for historical bars + the `quality` block (gaps, OHLC violations, duplicate bars, missing_pct). **Always pass `--validate`** before handing data to downstream analysts.
  - `python3 scripts/search.py "query" --json`  to resolve company name → ticker.

Use the **alpha-vantage-findata** skill via raw `marketdata-cli` calls (no Python wrappers) — primary source if yahoo-finance is not enabled, fallback if a yahoo-finance call fails. Setup: `uv pip install marketdata-cli && export ALPHAVANTAGE_API_KEY=...` (free key at https://www.alphavantage.co/support/#api-key). Free tier is **5 req/min, 25 req/day** — pace yourself.
  - `marketdata-cli global_quote TICKER`  for the latest price, day range, volume, change. One ticker per call.
  - `marketdata-cli time_series_daily TICKER -o full`  for OHLCV history. Validate manually by parsing the `Time Series (Daily)` block — Alpha Vantage does not pre-compute a quality report.
  - `marketdata-cli time_series_intraday TICKER -i 5min -o full`  for intraday bars (`1min` / `5min` / `15min` / `30min` / `60min`).
  - `marketdata-cli symbol_search -e "query"`  to resolve company name → ticker.
  - On error: check the response for top-level `Note` (per-minute rate limit, retry in 60s), `Information` (daily quota or auth issue), or `Error Message` (bad symbol) before parsing the data block.

Use web-search only for context neither provider supplies (regulatory filings, qualitative news, macro context).
Use summarize for condensing large data sets into key findings.
Use the Opcify skill to report your step status and output.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
