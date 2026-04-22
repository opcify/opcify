# TOOLS.md

You may have **yahoo-finance** and/or **alpha-vantage-findata** enabled on this workspace. They are independent skills — use whichever the user has installed. **If both are enabled, try yahoo-finance first; fall back to alpha-vantage-findata only if a yahoo-finance call fails** (returns an `error` field, throws, or yfinance is rate-limited).

Use the **yahoo-finance** skill to fetch OHLCV and pre-computed indicators before running any code-exec analysis:
  - `python3 scripts/history.py TICKER --period 6mo --interval 1d --json`  for raw OHLCV bars when you need to run custom calculations.
  - `python3 scripts/indicators.py TICKER --period 6mo --interval 1d --json`  for RSI(14), MACD(12,26,9), Stochastic(14,3), ADX(14), ATR(14), SMA(9/21/50/200), EMA(9/21), golden/death cross flags, Fibonacci retracements, and a baseline `signal_summary` (BUY/HOLD/SELL with confidence). Override the baseline signal whenever your reasoning conflicts with it.

Use the **alpha-vantage-findata** skill via raw `marketdata-cli` calls (no Python wrappers). Each indicator endpoint is a separate API call — an 8-indicator dump on one ticker burns 8 of your 25 daily Alpha Vantage requests. Be deliberate. Setup: `uv pip install marketdata-cli && export ALPHAVANTAGE_API_KEY=...`.
  - `marketdata-cli time_series_daily TICKER -o full`  to pull raw OHLCV bars in 1 call. Pair with `code-exec` to compute multiple indicators locally and save quota.
  - `marketdata-cli rsi    TICKER -i daily --time_period 14 --series_type close`  for RSI(14).
  - `marketdata-cli macd   TICKER -i daily --series_type close`  for MACD(12,26,9).
  - `marketdata-cli stoch  TICKER -i daily`  for Stochastic.
  - `marketdata-cli adx    TICKER -i daily --time_period 14`  for ADX.
  - `marketdata-cli atr    TICKER -i daily --time_period 14`  for ATR.
  - `marketdata-cli sma    TICKER -i daily --time_period 50 --series_type close`  for SMA(50). Repeat for 9/21/200 as needed.
  - `marketdata-cli bbands TICKER -i daily --time_period 20 --series_type close`  for Bollinger Bands.
  - `marketdata-cli obv    TICKER -i daily`  for On-Balance Volume.
  - On error: check for top-level `Note` / `Information` / `Error Message` before parsing the indicator block.
Use file-ops for creating and managing analysis files.
Use code-exec for running custom indicator calculations beyond what `indicators.py` provides.
Use the Opcify skill to report your step status and output.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
