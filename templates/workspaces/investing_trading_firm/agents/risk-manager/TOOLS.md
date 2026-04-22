# TOOLS.md

You may have **yahoo-finance** and/or **alpha-vantage-findata** enabled on this workspace. They are independent skills — use whichever the user has installed. **If both are enabled, try yahoo-finance first; fall back to alpha-vantage-findata only if a yahoo-finance call fails** (returns an `error` field, throws, or yfinance is rate-limited).

Use the **yahoo-finance** skill to fetch volatility and historical ranges before sizing any position:
  - `python3 scripts/volatility.py TICKER --lookback 60 --json`  for ATR(14), ATR%, realized vol (annualized), HV30, HV60, downside deviation, max drawdown, and beta vs SPY. The ATR drives stop-loss distance (typical: 1.5–2.0×ATR). Realized vol drives inverse-vol position sizing.
  - `python3 scripts/history.py TICKER --period 1y --interval 1d --json`  when you need raw bars for custom risk calculations.

Use the **alpha-vantage-findata** skill via raw `marketdata-cli` calls. Alpha Vantage does not expose a turnkey volatility / drawdown / beta endpoint — you'll need to compute those yourself in `code-exec` from raw OHLCV. The `atr` indicator endpoint gives you stop-distance directly without further math. Setup: `uv pip install marketdata-cli && export ALPHAVANTAGE_API_KEY=...`.
  - `marketdata-cli atr TICKER -i daily --time_period 14`  for ATR(14) — drives stop-loss distance (typical: 1.5–2.0×ATR). 1 call.
  - `marketdata-cli time_series_daily TICKER -o full`  for raw OHLCV bars; pair with `code-exec` to compute realized vol, max drawdown, and beta-vs-SPY locally. 1 call.
  - `marketdata-cli bbands TICKER -i daily --time_period 20 --series_type close`  for Bollinger Band width as a volatility proxy.
  - On error: check for top-level `Note` / `Information` / `Error Message` before parsing the indicator block.
  - Free tier is 5 req/min, 25 req/day — be deliberate about which positions you size from Alpha Vantage data.
Use file-ops for creating risk assessment files.
Use code-exec for running position sizing calculations and portfolio risk analysis on top of the yahoo-finance outputs.
Use the Opcify skill to report your step status and output.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
