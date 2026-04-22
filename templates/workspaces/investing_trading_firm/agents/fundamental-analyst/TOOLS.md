# TOOLS.md

You may have **yahoo-finance** and/or **alpha-vantage-findata** enabled on this workspace. They are independent skills — use whichever the user has installed. **If both are enabled, try yahoo-finance first; fall back to alpha-vantage-findata only if a yahoo-finance call fails** (returns an `error` field, throws, or yfinance is rate-limited).

Use the **yahoo-finance** skill for company financials, valuation, earnings, and analyst data:
  - `python3 scripts/valuation.py TICKER --json`  for P/E (trailing+forward), P/S, PEG, EV/EBITDA, margins, ROE, ROA, beta, dividend yield, 52w range.
  - `python3 scripts/financials.py TICKER --statement income|balance|cashflow --period annual|quarterly|ttm --json`  for full statements.
  - `python3 scripts/earnings.py TICKER --json`  for next earnings date, EPS/revenue estimates, EPS revisions, growth estimates.
  - `python3 scripts/analyst.py TICKER --json`  for price targets and recommendation distribution.

Use the **alpha-vantage-findata** skill via raw `marketdata-cli` calls. Returns **GAAP-normalized line items** (stable field names like `totalRevenue` / `netIncome` / `operatingCashflow` across companies — unlike yfinance's `info` dict which shifts shape). A full fundamental workup costs ~5 of your 25 daily Alpha Vantage requests. Setup: `uv pip install marketdata-cli && export ALPHAVANTAGE_API_KEY=...`.
  - `marketdata-cli company_overview TICKER`  for sector, industry, market cap, P/E, P/S, PEG, EV/EBITDA, ROE, ROA, beta, 52w range, dividend yield, EPS, analyst target price.
  - `marketdata-cli income_statement TICKER`  for annual + quarterly income statement reports.
  - `marketdata-cli balance_sheet TICKER`  for annual + quarterly balance sheet reports.
  - `marketdata-cli cash_flow TICKER`  for annual + quarterly cash flow reports.
  - `marketdata-cli earnings TICKER`  for reported EPS vs. estimates, surprise %, fiscal date ending.
  - `marketdata-cli dividends TICKER` and `marketdata-cli splits TICKER`  for distribution and split history.
  - `marketdata-cli insider_transactions TICKER`  for recent insider buys and sells.
  - **Not exposed** by Alpha Vantage free tier: analyst recommendation distribution, EPS revisions, growth estimates. If you need those and yahoo-finance is unavailable, surface that the data is missing rather than fabricating it.
  - On error: check for top-level `Note` / `Information` / `Error Message` before parsing the report block.

Use web-search only for macro indicators (CPI/PPI, rates, employment, GDP) and sector context that neither provider offers.
Use summarize for condensing complex financial data into key findings.
Use the Opcify skill to report your step status and output.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
