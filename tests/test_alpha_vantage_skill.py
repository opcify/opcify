#!/home/node/.openclaw-env/bin/python3
# SPDX-License-Identifier: MIT
"""
test_alpha_vantage_skill.py — exercise every marketdata-cli command documented
in the alpha-vantage-findata skill against a real Alpha Vantage API key,
report which ones work, persist results across runs.

Usage
-----
    # Smoke test (~13 calls, ~3 minutes)
    python3 tests/test_alpha_vantage_skill.py --smoke

    # Full sweep — exhausts free-tier quota (25/day) partway through;
    # re-run on subsequent days to resume from where state left off
    python3 tests/test_alpha_vantage_skill.py --all

    # Verify the catalog parses without burning quota
    python3 tests/test_alpha_vantage_skill.py --dry-run --all

    # Run only a single category
    python3 tests/test_alpha_vantage_skill.py --category indicators

    # Re-run only previously-failed cases
    python3 tests/test_alpha_vantage_skill.py --retry-failed

    # Premium key — disable the 13s pacing between calls
    python3 tests/test_alpha_vantage_skill.py --all --no-pace

API key resolution priority: --api-key flag → $ALPHAVANTAGE_API_KEY → DEFAULT_API_KEY constant.

This script is intentionally standalone — Python stdlib only, no installs.
It assumes `marketdata-cli` is on $PATH; if not, it falls back to
`uvx --from marketdata-cli marketdata-cli`.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Free-tier test key supplied by the user. Override via $ALPHAVANTAGE_API_KEY
# or --api-key. Embedded for low-friction local runs.
DEFAULT_API_KEY = "ZQC02N2F4G40NIC1"

# Persistent state file — gitignored. Tracks per-command pass/fail across runs
# so the multi-day --all sweep can resume from where the daily quota cut it off.
STATE_FILE = Path(__file__).parent / ".alpha_vantage_test_state.json"

# 5 req/min on free tier ⇒ 12s minimum between calls; +1s safety.
PACE_SECONDS = 13

# Per-call subprocess timeout. Most endpoints respond in <2s; full history
# pulls can take 5-10s. 30s is generous.
SUBPROCESS_TIMEOUT = 30

# Categories used to group test cases in the summary table.
CAT_QUOTES = "quotes"
CAT_HISTORY = "history"
CAT_CORPACT = "corporate-actions"
CAT_SEARCH = "symbol-search"
CAT_FUNDAMENTALS = "fundamentals"
CAT_INDICATORS = "indicators"
CAT_ANALYTICS = "portfolio-analytics"
CAT_NEWS = "news-sentiment"
CAT_MACRO = "macro"
CAT_CALENDAR = "calendar"
CAT_FOREX = "forex"
CAT_CRYPTO = "crypto"
CAT_COMMODITIES = "commodities"

# Status values stored in the state file
STATUS_PASS = "pass"
STATUS_PASS_PREMIUM = "pass_premium_gated"
STATUS_FAIL = "fail"
STATUS_RATE_LIMITED = "rate_limited"
STATUS_QUOTA_EXHAUSTED = "quota_exhausted"
STATUS_UNTESTED = "untested"

PASSING_STATUSES = {STATUS_PASS, STATUS_PASS_PREMIUM}


# ---------------------------------------------------------------------------
# TestCase definition
# ---------------------------------------------------------------------------


@dataclass
class TestCase:
    """One documented marketdata-cli invocation to verify."""

    name: str  # short identifier (e.g. "global_quote", "sma_daily_50")
    category: str  # one of CAT_*
    args: list[str]  # full arg list passed after `marketdata-cli`
    expected_keys: list[str] = field(default_factory=list)
    # If non-empty, the response must contain at least one of these top-level
    # keys to count as healthy. Empty = any non-error response counts.
    subcategory: str | None = None  # for indicators (momentum, trend, etc.)
    expected_premium_gate: bool = False
    # True = endpoint is premium-only on Alpha Vantage; on a free key it MUST
    # come back with an Information envelope mentioning "premium". Counts as
    # pass_premium_gated.
    smoke: bool = False  # included in --smoke run


# ---------------------------------------------------------------------------
# Test catalog (111 commands documented in templates/skills/alpha-vantage-findata)
# ---------------------------------------------------------------------------


def _build_test_cases() -> list[TestCase]:
    cases: list[TestCase] = []

    # ── Quotes ──────────────────────────────────────────────────────────
    cases += [
        TestCase(
            name="global_quote",
            category=CAT_QUOTES,
            args=["global_quote", "AAPL"],
            expected_keys=["Global Quote"],
            smoke=True,
        ),
        TestCase(
            name="realtime_bulk_quotes",
            category=CAT_QUOTES,
            args=["realtime_bulk_quotes", "AAPL,MSFT,GOOGL,NVDA,TSLA"],
            expected_keys=["data", "message"],
            # SKILL.md labels this premium-only, but live testing on free key
            # 4AMDUNE7IR532ZGD returned real data — it's actually free.
        ),
    ]

    # ── History (daily / intraday / weekly / monthly) ───────────────────
    cases += [
        TestCase(
            name="time_series_daily",
            category=CAT_HISTORY,
            args=["time_series_daily", "AAPL", "-o", "compact"],
            expected_keys=["Time Series (Daily)"],
        ),
        TestCase(
            name="time_series_daily_adjusted",
            category=CAT_HISTORY,
            args=["time_series_daily_adjusted", "AAPL", "-o", "compact"],
            expected_keys=["Time Series (Daily)"],
            # CONFIRMED PREMIUM-ONLY by live test against keys ZQC02N2F4G40NIC1
            # and 4AMDUNE7IR532ZGD on 2026-04-10. SKILL.md incorrectly lists it
            # as the canonical free-tier OHLCV source — see docs-bug list.
            expected_premium_gate=True,
            smoke=True,
        ),
        TestCase(
            name="time_series_intraday_5min",
            category=CAT_HISTORY,
            args=["time_series_intraday", "AAPL", "-i", "5min", "-o", "compact"],
            expected_keys=["Time Series (5min)"],
            # CONFIRMED PREMIUM-ONLY by live test 2026-04-10. SKILL.md says free.
            expected_premium_gate=True,
            smoke=True,
        ),
        TestCase(
            name="time_series_weekly_adjusted",
            category=CAT_HISTORY,
            args=["time_series_weekly_adjusted", "AAPL"],
            expected_keys=["Weekly Adjusted Time Series"],
        ),
        TestCase(
            name="time_series_monthly_adjusted",
            category=CAT_HISTORY,
            args=["time_series_monthly_adjusted", "AAPL"],
            expected_keys=["Monthly Adjusted Time Series"],
        ),
    ]

    # ── Corporate actions ───────────────────────────────────────────────
    cases += [
        TestCase(
            name="dividends",
            category=CAT_CORPACT,
            args=["dividends", "AAPL"],
            expected_keys=["data", "symbol"],
        ),
        TestCase(
            name="splits",
            category=CAT_CORPACT,
            args=["splits", "AAPL"],
            expected_keys=["data", "symbol"],
        ),
    ]

    # ── Symbol search ───────────────────────────────────────────────────
    cases += [
        TestCase(
            name="symbol_search",
            category=CAT_SEARCH,
            args=["symbol_search", "-e", "tencent"],
            expected_keys=["bestMatches"],
            smoke=True,
        ),
    ]

    # ── Fundamentals ────────────────────────────────────────────────────
    cases += [
        TestCase(
            name="company_overview",
            category=CAT_FUNDAMENTALS,
            args=["company_overview", "AAPL"],
            expected_keys=["Symbol"],
            smoke=True,
        ),
        TestCase(
            name="income_statement",
            category=CAT_FUNDAMENTALS,
            args=["income_statement", "AAPL"],
            expected_keys=["annualReports", "quarterlyReports"],
        ),
        TestCase(
            name="balance_sheet",
            category=CAT_FUNDAMENTALS,
            args=["balance_sheet", "AAPL"],
            expected_keys=["annualReports", "quarterlyReports"],
        ),
        TestCase(
            name="cash_flow",
            category=CAT_FUNDAMENTALS,
            args=["cash_flow", "AAPL"],
            expected_keys=["annualReports", "quarterlyReports"],
        ),
        TestCase(
            name="earnings",
            category=CAT_FUNDAMENTALS,
            args=["earnings", "AAPL"],
            expected_keys=["annualEarnings", "quarterlyEarnings"],
            smoke=True,
        ),
        TestCase(
            name="earnings_estimates",
            category=CAT_FUNDAMENTALS,
            args=["earnings_estimates", "AAPL"],
            expected_keys=["estimates"],
            expected_premium_gate=True,
        ),
        TestCase(
            name="earnings_call_transcript",
            category=CAT_FUNDAMENTALS,
            args=["earnings_call_transcript", "AAPL", "-q", "2024Q3"],
            expected_keys=["transcript", "symbol"],
        ),
        TestCase(
            name="insider_transactions",
            category=CAT_FUNDAMENTALS,
            args=["insider_transactions", "AAPL"],
            expected_keys=["data"],
        ),
        TestCase(
            name="etf_profile",
            category=CAT_FUNDAMENTALS,
            args=["etf_profile", "XLF"],
            expected_keys=["holdings", "sectors", "asset_allocation", "net_assets"],
        ),
    ]

    # ── Technical indicators ────────────────────────────────────────────
    # Each indicator is its own quota slot; the catalog needs them all to
    # verify flag layouts and response shapes.

    def indicator(
        name: str,
        cmd: str,
        sub: str,
        *extras: str,
    ) -> TestCase:
        """Helper: build an indicator test case with daily interval defaults."""
        return TestCase(
            name=name,
            category=CAT_INDICATORS,
            subcategory=sub,
            args=[cmd, "AAPL", "-i", "daily", *extras],
            expected_keys=[],  # set per-call below
        )

    # The expected_keys for indicators are all "Technical Analysis: <NAME>"
    # where <NAME> is the upper-cased command. Set them below in a loop.

    # Moving averages
    ma_specs = [
        ("sma", ["--time_period", "50", "--series_type", "close"]),
        ("ema", ["--time_period", "21", "--series_type", "close"]),
        ("wma", ["--time_period", "20", "--series_type", "close"]),
        ("dema", ["--time_period", "20", "--series_type", "close"]),
        ("tema", ["--time_period", "20", "--series_type", "close"]),
        ("trima", ["--time_period", "20", "--series_type", "close"]),
        ("kama", ["--time_period", "20", "--series_type", "close"]),
        ("mama", ["--series_type", "close"]),
        ("t3", ["--time_period", "20", "--series_type", "close"]),
    ]
    for cmd, extras in ma_specs:
        cases.append(indicator(cmd, cmd, "moving-averages", *extras))

    # Momentum oscillators
    osc_specs = [
        ("rsi", ["--time_period", "14", "--series_type", "close"], True),
        ("stoch", [], False),
        ("stochf", [], False),
        ("stochrsi", ["--time_period", "14", "--series_type", "close"], False),
        ("willr", ["--time_period", "14"], False),
        ("cci", ["--time_period", "20"], False),
        ("cmo", ["--time_period", "14", "--series_type", "close"], False),
        ("mom", ["--time_period", "10", "--series_type", "close"], False),
        ("roc", ["--time_period", "10", "--series_type", "close"], False),
        ("rocr", ["--time_period", "10", "--series_type", "close"], False),
        ("mfi", ["--time_period", "14"], False),
        ("ultosc", [], False),
        ("bop", [], False),
    ]
    for cmd, extras, in_smoke in osc_specs:
        c = indicator(cmd, cmd, "momentum", *extras)
        c.smoke = in_smoke
        cases.append(c)

    # MACD family. Note: `macd` itself is CONFIRMED PREMIUM-ONLY despite
    # SKILL.md listing it as free — see docs-bug list. The other MACD-family
    # endpoints (macdext, ppo, apo) are still untested as of 2026-04-10.
    macd_specs = [
        ("macd", ["--series_type", "close"], True),
        ("macdext", ["--series_type", "close"], False),
        ("ppo", ["--series_type", "close"], False),
        ("apo", ["--series_type", "close"], False),
    ]
    for cmd, extras, premium in macd_specs:
        c = indicator(cmd, cmd, "macd", *extras)
        c.expected_premium_gate = premium
        cases.append(c)

    # Trend / DMI
    trend_specs = [
        ("adx", ["--time_period", "14"]),
        ("adxr", ["--time_period", "14"]),
        ("dx", ["--time_period", "14"]),
        ("plus_di", ["--time_period", "14"]),
        ("minus_di", ["--time_period", "14"]),
        ("plus_dm", ["--time_period", "14"]),
        ("minus_dm", ["--time_period", "14"]),
        ("aroon", ["--time_period", "25"]),
        ("aroonosc", ["--time_period", "25"]),
        ("trix", ["--time_period", "30", "--series_type", "close"]),
        ("sar", []),
    ]
    for cmd, extras in trend_specs:
        cases.append(indicator(cmd, cmd, "trend", *extras))

    # Volatility
    vol_specs = [
        ("atr", ["--time_period", "14"]),
        ("natr", ["--time_period", "14"]),
        ("trange", []),
        ("bbands", ["--time_period", "20", "--series_type", "close"]),
        ("midpoint", ["--time_period", "14", "--series_type", "close"]),
        ("midprice", ["--time_period", "14"]),
    ]
    for cmd, extras in vol_specs:
        cases.append(indicator(cmd, cmd, "volatility", *extras))

    # Volume. Note: `vwap` is CONFIRMED PREMIUM-ONLY despite SKILL.md saying
    # it's free — see docs-bug list. It requires intraday data, which is itself
    # premium-gated.
    vol_v_specs = [
        ("obv", "daily", [], False),
        ("vwap", "15min", [], True),  # premium-only
        ("ad", "daily", [], False),
        ("adosc", "daily", [], False),
    ]
    for cmd, interval, extras, premium in vol_v_specs:
        cases.append(
            TestCase(
                name=cmd,
                category=CAT_INDICATORS,
                subcategory="volume",
                args=[cmd, "AAPL", "-i", interval, *extras],
                expected_keys=[],
                expected_premium_gate=premium,
            )
        )

    # Hilbert transform
    ht_specs = [
        ("ht_trendline", ["--series_type", "close"]),
        ("ht_sine", ["--series_type", "close"]),
        ("ht_trendmode", ["--series_type", "close"]),
        ("ht_dcperiod", ["--series_type", "close"]),
        ("ht_dcphase", ["--series_type", "close"]),
        ("ht_phasor", ["--series_type", "close"]),
    ]
    for cmd, extras in ht_specs:
        cases.append(indicator(cmd, cmd, "hilbert", *extras))

    # Set expected_keys for every indicator: "Technical Analysis: <UPPER>"
    for c in cases:
        if c.category == CAT_INDICATORS and not c.expected_keys:
            c.expected_keys = [f"Technical Analysis: {c.name.upper()}"]

    # ── Portfolio analytics ─────────────────────────────────────────────
    cases += [
        TestCase(
            name="analytics_fixed_window",
            category=CAT_ANALYTICS,
            args=[
                "analytics_fixed_window",
                "-s",
                "AAPL,MSFT",
                "-r",
                "1year",
                "-i",
                "DAILY",
                "-o",
                "close",
                "-c",
                "MEAN,STDDEV",
            ],
            expected_keys=["payload", "meta_data"],
            smoke=True,
        ),
        TestCase(
            name="analytics_sliding_window",
            category=CAT_ANALYTICS,
            args=[
                "analytics_sliding_window",
                "-s",
                "AAPL",
                "-r",
                "1year",
                "-i",
                "DAILY",
                "-w",
                "30",
                "-o",
                "close",
                "-c",
                "STDDEV(annualized=True)",
            ],
            expected_keys=["payload", "meta_data"],
        ),
    ]

    # ── News & sentiment ────────────────────────────────────────────────
    cases += [
        TestCase(
            name="news_sentiment",
            category=CAT_NEWS,
            args=["news_sentiment", "--tickers", "AAPL", "--limit", "5"],
            expected_keys=["feed", "items"],
            smoke=True,
        ),
    ]

    # ── Macro indicators ────────────────────────────────────────────────
    macro_cmds = [
        ("real_gdp", False),
        ("real_gdp_per_capita", False),
        ("cpi", True),  # smoke
        ("inflation", False),
        ("retail_sales", False),
        ("durables", False),
        ("unemployment", False),
        ("nonfarm_payroll", False),
        ("federal_funds_rate", False),
        ("treasury_yield", False),
    ]
    for cmd, in_smoke in macro_cmds:
        cases.append(
            TestCase(
                name=cmd,
                category=CAT_MACRO,
                args=[cmd],
                expected_keys=["data", "name"],
                smoke=in_smoke,
            )
        )

    # ── Calendar / market structure ─────────────────────────────────────
    # earnings_calendar / ipo_calendar / listing_status return CSV by default,
    # not JSON. We tolerate that by allowing empty expected_keys (any
    # non-error response counts as success).
    cases += [
        TestCase(
            name="earnings_calendar",
            category=CAT_CALENDAR,
            args=["earnings_calendar"],
            expected_keys=[],  # CSV response
        ),
        TestCase(
            name="ipo_calendar",
            category=CAT_CALENDAR,
            args=["ipo_calendar"],
            expected_keys=[],  # CSV response
        ),
        TestCase(
            name="listing_status",
            category=CAT_CALENDAR,
            args=["listing_status"],
            expected_keys=[],  # CSV response
        ),
        TestCase(
            name="market_status",
            category=CAT_CALENDAR,
            args=["market_status"],
            expected_keys=["markets", "endpoint"],
        ),
        TestCase(
            name="top_gainers_losers",
            category=CAT_CALENDAR,
            args=["top_gainers_losers"],
            expected_keys=["top_gainers", "top_losers", "most_actively_traded"],
        ),
    ]

    # ── Forex ───────────────────────────────────────────────────────────
    cases += [
        TestCase(
            name="currency_exchange_rate",
            category=CAT_FOREX,
            args=[
                "currency_exchange_rate",
                "--from_currency",
                "USD",
                "--to_currency",
                "JPY",
            ],
            expected_keys=["Realtime Currency Exchange Rate"],
            smoke=True,
        ),
        TestCase(
            name="fx_intraday_5min",
            category=CAT_FOREX,
            args=[
                "fx_intraday",
                "--from_symbol",
                "EUR",
                "--to_symbol",
                "USD",
                "-i",
                "5min",
            ],
            expected_keys=["Time Series FX (5min)"],
            # CONFIRMED PREMIUM-ONLY by live test 2026-04-10. SKILL.md says free.
            # Intraday FX appears to share the same premium gate as intraday equity.
            expected_premium_gate=True,
        ),
        TestCase(
            name="fx_daily",
            category=CAT_FOREX,
            args=["fx_daily", "--from_symbol", "EUR", "--to_symbol", "USD"],
            expected_keys=["Time Series FX (Daily)"],
        ),
        TestCase(
            name="fx_weekly",
            category=CAT_FOREX,
            args=["fx_weekly", "--from_symbol", "EUR", "--to_symbol", "USD"],
            expected_keys=["Time Series FX (Weekly)"],
        ),
        TestCase(
            name="fx_monthly",
            category=CAT_FOREX,
            args=["fx_monthly", "--from_symbol", "EUR", "--to_symbol", "USD"],
            expected_keys=["Time Series FX (Monthly)"],
        ),
    ]

    # ── Crypto ──────────────────────────────────────────────────────────
    cases += [
        TestCase(
            name="digital_currency_daily",
            category=CAT_CRYPTO,
            args=["digital_currency_daily", "BTC", "--market", "USD"],
            expected_keys=["Time Series (Digital Currency Daily)"],
            smoke=True,
        ),
        TestCase(
            name="digital_currency_weekly",
            category=CAT_CRYPTO,
            args=["digital_currency_weekly", "BTC", "--market", "USD"],
            expected_keys=["Time Series (Digital Currency Weekly)"],
        ),
        TestCase(
            name="digital_currency_monthly",
            category=CAT_CRYPTO,
            args=["digital_currency_monthly", "BTC", "--market", "USD"],
            expected_keys=["Time Series (Digital Currency Monthly)"],
        ),
        TestCase(
            name="crypto_intraday_5min",
            category=CAT_CRYPTO,
            args=["crypto_intraday", "ETH", "--market", "USD", "-i", "5min"],
            expected_keys=["Time Series Crypto (5min)"],
        ),
    ]

    # ── Commodities ─────────────────────────────────────────────────────
    commodity_cmds = [
        ("wti", True),  # smoke
        ("brent", False),
        ("natural_gas", False),
        ("gold_silver_spot", False),
        ("gold_silver_history", False),
        ("copper", False),
        ("aluminum", False),
        ("wheat", False),
        ("corn", False),
        ("cotton", False),
        ("sugar", False),
        ("coffee", False),
    ]
    for cmd, in_smoke in commodity_cmds:
        cases.append(
            TestCase(
                name=cmd,
                category=CAT_COMMODITIES,
                args=[cmd],
                expected_keys=["data", "name"],
                smoke=in_smoke,
            )
        )

    return cases


TEST_CASES: list[TestCase] = _build_test_cases()


# ---------------------------------------------------------------------------
# CLI resolution
# ---------------------------------------------------------------------------


def resolve_cli() -> list[str]:
    """Find a runnable marketdata-cli invocation prefix.

    Returns the command list to prepend to args. Hard-fails if neither a
    PATH binary nor `uvx` is available.
    """
    if shutil.which("marketdata-cli"):
        return ["marketdata-cli"]
    if shutil.which("uvx"):
        return ["uvx", "--from", "marketdata-cli", "marketdata-cli"]
    print(
        "ERROR: marketdata-cli is not installed and `uvx` is not available.\n"
        "       Install one of:\n"
        "         uv pip install marketdata-cli\n"
        "         brew install uv  (then this script will use `uvx --from marketdata-cli ...`)",
        file=sys.stderr,
    )
    sys.exit(2)


# ---------------------------------------------------------------------------
# State persistence
# ---------------------------------------------------------------------------


def load_state() -> dict:
    """Load the persistent state file. Empty if it doesn't exist."""
    if not STATE_FILE.exists():
        return {"runs": [], "results": {}}
    try:
        return json.loads(STATE_FILE.read_text())
    except (json.JSONDecodeError, OSError) as e:
        print(f"WARN: state file corrupt ({e}), starting fresh", file=sys.stderr)
        return {"runs": [], "results": {}}


def save_state(state: dict) -> None:
    """Persist the state file. Called after every test result."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Response classification
# ---------------------------------------------------------------------------


def classify_envelope(data: dict) -> tuple[str | None, str | None]:
    """Inspect a parsed JSON response for Alpha Vantage error envelopes.

    Returns (status, message) where status is one of:
        "rate_limited"      — per-minute cap (Note envelope)
        "quota_exhausted"   — daily 25/day cap (Information w/ "rate limit")
        "auth_error"        — bad/demo key (Information w/ "demo"/"api key")
        "premium_gated"     — premium-only endpoint (Information w/ "premium")
        "bad_request"       — bad symbol/function/params (Error Message)
        None                — looks like a real data response
    """
    if not isinstance(data, dict):
        return None, None

    # Note envelope ⇒ per-minute rate limit
    note = data.get("Note")
    if isinstance(note, str) and note:
        return "rate_limited", note

    # Information envelope ⇒ several distinct cases — disambiguate on substring.
    # ORDER MATTERS: quota-exhaustion responses contain BOTH "rate limit is 25
    # requests per day" AND "premium plans" (as remediation text), so the
    # quota-specific markers must be checked BEFORE the generic "premium" check.
    info = data.get("Information")
    if isinstance(info, str) and info:
        low = info.lower()
        # Most-specific quota markers first
        if "25 requests per day" in low or "rate limit is" in low or "rate limit." in low:
            return "quota_exhausted", info
        # Premium-only endpoint gate (vs. quota exhaustion suggesting an upgrade)
        if "premium endpoint" in low or "this is a premium" in low:
            return "premium_gated", info
        # Demo key being used
        if "demo" in low and "api key" in low:
            return "auth_error", info
        # Plain "rate limit" mention (without the more specific marker above)
        if "rate limit" in low:
            return "quota_exhausted", info
        # Fallback "premium" mention — could be a gate or remediation text;
        # err on the side of premium_gated since unambiguous quota markers
        # didn't match.
        if "premium" in low:
            return "premium_gated", info
        # Generic Information envelope — treat as quota_exhausted (the most
        # common cause) but include the message so triage is unambiguous.
        return "quota_exhausted", info

    err = data.get("Error Message")
    if isinstance(err, str) and err:
        return "bad_request", err

    return None, None


# ---------------------------------------------------------------------------
# Single test runner
# ---------------------------------------------------------------------------


def run_one(case: TestCase, api_key: str, cli: list[str], dry_run: bool) -> dict:
    """Execute one TestCase. Returns a result dict ready for the state file.

    Schema: {status, duration_ms, error, raw_size}
    """
    full_cmd = [*cli, *case.args, "-k", api_key]

    if dry_run:
        return {
            "status": "dry-run",
            "duration_ms": 0,
            "error": None,
            "raw_size": 0,
            "command": " ".join(case.args),
        }

    start = time.monotonic()
    try:
        proc = subprocess.run(
            full_cmd,
            capture_output=True,
            text=True,
            timeout=SUBPROCESS_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "status": STATUS_FAIL,
            "duration_ms": int((time.monotonic() - start) * 1000),
            "error": f"subprocess timed out after {SUBPROCESS_TIMEOUT}s",
            "raw_size": 0,
            "command": " ".join(case.args),
        }
    except FileNotFoundError as e:
        return {
            "status": STATUS_FAIL,
            "duration_ms": int((time.monotonic() - start) * 1000),
            "error": f"binary not found: {e}",
            "raw_size": 0,
            "command": " ".join(case.args),
        }

    duration_ms = int((time.monotonic() - start) * 1000)
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    raw_size = len(stdout)

    if proc.returncode != 0 and not stdout:
        return {
            "status": STATUS_FAIL,
            "duration_ms": duration_ms,
            "error": f"exit {proc.returncode}: {stderr or '(no stderr)'}",
            "raw_size": 0,
            "command": " ".join(case.args),
        }

    if not stdout:
        return {
            "status": STATUS_FAIL,
            "duration_ms": duration_ms,
            "error": "empty stdout",
            "raw_size": 0,
            "command": " ".join(case.args),
        }

    # Try to parse as JSON. Some endpoints (earnings_calendar, ipo_calendar,
    # listing_status) return CSV by default — for those we accept any non-empty
    # response that isn't an error envelope. The first character tells us.
    parsed: dict | None = None
    if stdout.lstrip().startswith("{"):
        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError as e:
            return {
                "status": STATUS_FAIL,
                "duration_ms": duration_ms,
                "error": f"invalid JSON: {e}",
                "raw_size": raw_size,
                "command": " ".join(case.args),
            }

    # Classify the envelope
    if parsed is not None:
        env_status, env_msg = classify_envelope(parsed)
        if env_status == "rate_limited":
            return {
                "status": STATUS_RATE_LIMITED,
                "duration_ms": duration_ms,
                "error": env_msg,
                "raw_size": raw_size,
                "command": " ".join(case.args),
            }
        if env_status == "quota_exhausted":
            return {
                "status": STATUS_QUOTA_EXHAUSTED,
                "duration_ms": duration_ms,
                "error": env_msg,
                "raw_size": raw_size,
                "command": " ".join(case.args),
            }
        if env_status == "auth_error":
            return {
                "status": STATUS_FAIL,
                "duration_ms": duration_ms,
                "error": f"auth error: {env_msg}",
                "raw_size": raw_size,
                "command": " ".join(case.args),
            }
        if env_status == "premium_gated":
            if case.expected_premium_gate:
                return {
                    "status": STATUS_PASS_PREMIUM,
                    "duration_ms": duration_ms,
                    "error": None,
                    "raw_size": raw_size,
                    "command": " ".join(case.args),
                    "note": "premium-gated as expected",
                }
            return {
                "status": STATUS_FAIL,
                "duration_ms": duration_ms,
                "error": f"unexpected premium gate: {env_msg}",
                "raw_size": raw_size,
                "command": " ".join(case.args),
            }
        if env_status == "bad_request":
            return {
                "status": STATUS_FAIL,
                "duration_ms": duration_ms,
                "error": f"bad request: {env_msg}",
                "raw_size": raw_size,
                "command": " ".join(case.args),
            }

    # If this case was supposed to be premium-gated but the response was a
    # real data envelope, that's surprising — flag it as fail so the user
    # knows to update the catalog.
    if case.expected_premium_gate:
        return {
            "status": STATUS_FAIL,
            "duration_ms": duration_ms,
            "error": "expected premium gate but got real data response",
            "raw_size": raw_size,
            "command": " ".join(case.args),
        }

    # Validate expected keys (if any). For JSON responses, at least one key
    # in expected_keys must be present at the top level.
    if case.expected_keys and parsed is not None:
        if not any(k in parsed for k in case.expected_keys):
            return {
                "status": STATUS_FAIL,
                "duration_ms": duration_ms,
                "error": (
                    f"missing expected key — wanted any of {case.expected_keys}, "
                    f"got top-level keys {sorted(parsed.keys())[:8]}"
                ),
                "raw_size": raw_size,
                "command": " ".join(case.args),
            }

    return {
        "status": STATUS_PASS,
        "duration_ms": duration_ms,
        "error": None,
        "raw_size": raw_size,
        "command": " ".join(case.args),
    }


# ---------------------------------------------------------------------------
# Summary table formatting
# ---------------------------------------------------------------------------

ICON = {
    STATUS_PASS: "✅",
    STATUS_PASS_PREMIUM: "✅",
    STATUS_FAIL: "❌",
    STATUS_RATE_LIMITED: "⏸️ ",
    STATUS_QUOTA_EXHAUSTED: "⏸️ ",
    STATUS_UNTESTED: "⏭️ ",
    "dry-run": "🔍",
}


def format_summary(state: dict, attempted_cases: list[TestCase]) -> str:
    """Build the box-bordered summary table grouped by category.

    Mirrors the visual style of tests/run_all.sh.
    """
    results = state.get("results", {})
    lines: list[str] = []

    title = "Alpha Vantage Skill Test Results"
    border = "═" * 70
    lines.append("")
    lines.append(f"╔{border}╗")
    lines.append(f"║ {title:<68} ║")
    lines.append(f"╚{border}╝")
    lines.append("")

    # Group attempted cases by category
    by_cat: dict[str, list[TestCase]] = {}
    for case in attempted_cases:
        by_cat.setdefault(case.category, []).append(case)

    pass_count = 0
    fail_count = 0
    skip_count = 0

    for cat in sorted(by_cat.keys()):
        cat_cases = by_cat[cat]
        cat_passes = sum(
            1
            for c in cat_cases
            if results.get(c.name, {}).get("status") in PASSING_STATUSES
        )
        cat_total = len(cat_cases)
        lines.append(f"  {cat}  ({cat_passes}/{cat_total})")
        for case in cat_cases:
            res = results.get(case.name, {"status": STATUS_UNTESTED})
            status = res.get("status", STATUS_UNTESTED)
            icon = ICON.get(status, "?")
            duration = res.get("duration_ms", 0)
            err = res.get("error") or ""
            note = res.get("note") or ""

            line = f"    {icon} {case.name:<35} {duration:>6}ms"
            if note:
                line += f"  ({note})"
            elif err:
                # Truncate long error messages for the summary
                short_err = err if len(err) <= 60 else err[:57] + "…"
                line += f"  — {short_err}"
            lines.append(line)

            if status in PASSING_STATUSES:
                pass_count += 1
            elif status in (
                STATUS_RATE_LIMITED,
                STATUS_QUOTA_EXHAUSTED,
                STATUS_UNTESTED,
                "dry-run",
            ):
                skip_count += 1
            else:
                fail_count += 1
        lines.append("")

    lines.append("─" * 72)
    lines.append(
        f"  Total: {pass_count} passed · {fail_count} failed · {skip_count} skipped/quota"
    )
    lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------


def select_cases(
    args: argparse.Namespace, all_cases: list[TestCase]
) -> list[TestCase]:
    """Apply CLI mode flags to the catalog to produce the run set."""
    if args.retry_failed:
        state = load_state()
        results = state.get("results", {})
        retry_statuses = {STATUS_FAIL, STATUS_RATE_LIMITED}
        return [
            c
            for c in all_cases
            if results.get(c.name, {}).get("status") in retry_statuses
        ]

    if args.category:
        return [c for c in all_cases if c.category == args.category]

    if args.all:
        return list(all_cases)

    # Default: smoke
    return [c for c in all_cases if c.smoke]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify every marketdata-cli command documented in the "
        "alpha-vantage-findata skill against a real Alpha Vantage API key."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--smoke",
        action="store_true",
        default=True,
        help="Run a representative subset (~13 commands, fits in one day's quota). Default.",
    )
    mode.add_argument(
        "--all",
        action="store_true",
        help="Run every documented command. Will exhaust free-tier quota; resume across days.",
    )
    mode.add_argument(
        "--category",
        metavar="NAME",
        help=(
            "Run only one category. Choices: "
            + ", ".join(
                sorted(
                    {
                        CAT_QUOTES,
                        CAT_HISTORY,
                        CAT_CORPACT,
                        CAT_SEARCH,
                        CAT_FUNDAMENTALS,
                        CAT_INDICATORS,
                        CAT_ANALYTICS,
                        CAT_NEWS,
                        CAT_MACRO,
                        CAT_CALENDAR,
                        CAT_FOREX,
                        CAT_CRYPTO,
                        CAT_COMMODITIES,
                    }
                )
            )
        ),
    )
    mode.add_argument(
        "--retry-failed",
        action="store_true",
        help="Re-run only commands previously marked fail or rate_limited.",
    )

    parser.add_argument(
        "--api-key",
        default=os.environ.get("ALPHAVANTAGE_API_KEY") or DEFAULT_API_KEY,
        help="Alpha Vantage API key (defaults to $ALPHAVANTAGE_API_KEY or embedded constant)",
    )
    parser.add_argument(
        "--no-pace",
        action="store_true",
        help="Skip the 13s sleep between calls (use only with a premium key)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Don't actually call the API — just enumerate the test cases",
    )

    args = parser.parse_args()

    # In --all/--category/--retry-failed mode, --smoke isn't actually selected
    if args.all or args.category or args.retry_failed:
        args.smoke = False

    cli = resolve_cli()
    state = load_state()

    selected = select_cases(args, TEST_CASES)
    if not selected:
        print("No test cases match the selected mode.", file=sys.stderr)
        return 1

    # In --all mode, skip cases that already passed
    if args.all and not args.dry_run:
        results = state.get("results", {})
        already_done = [
            c
            for c in selected
            if results.get(c.name, {}).get("status") in PASSING_STATUSES
        ]
        if already_done:
            print(
                f"Skipping {len(already_done)} cases already marked passing in state. "
                "Use --retry-failed to re-run failures."
            )
        selected = [c for c in selected if c not in already_done]

    # Banner
    mode_name = (
        "DRY-RUN"
        if args.dry_run
        else (
            "ALL"
            if args.all
            else (
                f"CATEGORY={args.category}"
                if args.category
                else ("RETRY-FAILED" if args.retry_failed else "SMOKE")
            )
        )
    )
    print(f"Alpha Vantage skill test  ·  mode={mode_name}  ·  cases={len(selected)}  ·  cli={' '.join(cli)}")
    if not args.dry_run:
        est_seconds = len(selected) * (PACE_SECONDS if not args.no_pace else 1)
        print(f"  Estimated wall time: ~{est_seconds // 60}m {est_seconds % 60}s")
    print("")

    # Record this run in state
    state.setdefault("runs", []).append(
        {
            "started_at": now_iso(),
            "mode": mode_name,
            "case_count": len(selected),
            "dry_run": args.dry_run,
        }
    )
    save_state(state)

    quota_hit = False

    for i, case in enumerate(selected, 1):
        prefix = f"  [{i:>3}/{len(selected)}]"
        print(f"{prefix} {case.name:<35} ({case.category})", end=" ", flush=True)
        sys.stdout.flush()

        result = run_one(case, args.api_key, cli, args.dry_run)
        result["timestamp"] = now_iso()
        # Dry-run: don't touch state — the user might have real results from
        # prior runs that they don't want overwritten by an enumeration check.
        if not args.dry_run:
            state.setdefault("results", {})[case.name] = result
            save_state(state)  # save after each call so quota-death doesn't lose progress

        status = result["status"]
        icon = ICON.get(status, "?")
        if status in PASSING_STATUSES:
            note = result.get("note", "")
            extra = f" ({note})" if note else ""
            print(f"{icon} {result['duration_ms']:>5}ms{extra}", flush=True)
        elif status == "dry-run":
            print(f"{icon} would call: marketdata-cli {result['command']} -k <key>", flush=True)
        elif status == STATUS_RATE_LIMITED:
            # Per-minute rate limit. Sleep 65s and retry once.
            print(f"{icon} per-minute limit hit, sleeping 65s and retrying once...", flush=True)
            time.sleep(65)
            result2 = run_one(case, args.api_key, cli, args.dry_run)
            result2["timestamp"] = now_iso()
            state["results"][case.name] = result2
            save_state(state)
            status2 = result2["status"]
            icon2 = ICON.get(status2, "?")
            print(f"        retry → {icon2} {status2}  ({result2['duration_ms']}ms)", flush=True)
            if status2 == STATUS_QUOTA_EXHAUSTED:
                quota_hit = True
                break
        elif status == STATUS_QUOTA_EXHAUSTED:
            print(f"{icon} DAILY QUOTA EXHAUSTED — stopping run", flush=True)
            quota_hit = True
            break
        else:
            err = result.get("error") or "(no error message)"
            short_err = err if len(err) <= 80 else err[:77] + "…"
            print(f"{icon} {short_err}", flush=True)

        # Pace between calls (skip after the last one)
        if i < len(selected) and not args.no_pace and not args.dry_run:
            time.sleep(PACE_SECONDS)

    # Print the summary
    print(format_summary(state, selected))

    if quota_hit:
        print(
            "  Daily quota exhausted. Re-run with the same flags tomorrow to "
            "resume from where we left off — passing cases are skipped on resume."
        )
        print("")

    # Exit code
    failed = sum(
        1
        for c in selected
        if state.get("results", {}).get(c.name, {}).get("status") not in PASSING_STATUSES
        and state.get("results", {}).get(c.name, {}).get("status") != "dry-run"
    )
    if args.dry_run:
        return 0
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
