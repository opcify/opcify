# TOOLS.md

You may have **yahoo-finance** and/or **alpha-vantage-findata** enabled on this workspace. They are independent skills — use whichever the user has installed. **If both are enabled, try yahoo-finance first; fall back to alpha-vantage-findata only if a yahoo-finance call fails** (returns an `error` field, throws, or yfinance is rate-limited).

Use the **yahoo-finance** skill for ticker-level news, analyst sentiment, and institutional/insider flow:
  - `python3 scripts/news.py TICKER --limit 20 --json`  for recent headlines (normalized title, publisher, summary, link, timestamp).
  - `python3 scripts/analyst.py TICKER --json`  for the recommendation distribution and recent upgrades/downgrades — a leading sentiment signal from sell-side analysts.
  - `python3 scripts/holders.py TICKER --json`  for institutional ownership concentration and insider purchases/sales — smart-money flow.

Use the **alpha-vantage-findata** skill via raw `marketdata-cli` calls. Alpha Vantage's `news_sentiment` endpoint includes **built-in NLP sentiment scoring** that yfinance lacks: each article has `overall_sentiment_score` (float in [-1, 1]), `overall_sentiment_label` (Bearish → Bullish 5-bucket), and per-article `ticker_sentiment` with relevance + score. Use these directly instead of running a classifier. Setup: `uv pip install marketdata-cli && export ALPHAVANTAGE_API_KEY=...`.
  - `marketdata-cli news_sentiment --tickers TICKER --limit 20`  for recent headlines + per-article sentiment.
  - `marketdata-cli news_sentiment --tickers TICKER --topics earnings --limit 10`  to filter by topic (`earnings`, `ipo`, `mergers_and_acquisitions`, `financial_markets`, `economy_macro`, etc.).
  - `marketdata-cli news_sentiment --tickers AAPL,MSFT,NVDA --sort LATEST --limit 50`  for multi-ticker batched news in one call.
  - `marketdata-cli insider_transactions TICKER`  for recent insider buys/sells (smart-money flow).
  - **Not exposed** by Alpha Vantage free tier: analyst recommendation distribution, institutional ownership concentration. If you need those and yahoo-finance is unavailable, surface that the data is missing rather than fabricating it.
  - On error: check for top-level `Note` / `Information` / `Error Message` before parsing the `feed` block.

Use web-search for social-media sentiment (X/Reddit/StockTwits) and broader market psychology (put/call ratios, VIX commentary, fear & greed indices) that neither provider exposes.
Use summarize for condensing sentiment data into key findings.
Use the Opcify skill to report your step status and output.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
