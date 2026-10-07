"""The market pulse: a confidence score for the market, for every sector and
for every tracked company, worked out from data alone.

A company is scored with the checks the trade check runs on it (trend,
valuation, the business, risk), so a score here and a score there agree. A
sector and the market as a whole have checks of their own. Company and sector
scores come in two readings: short term, which looks only at how prices are
behaving, and long term, which adds the business and what it costs.

Nothing here is specific to a user, so one snapshot is shared by everyone and
rebuilt about once a minute while the market is open.
"""
from __future__ import annotations

import math
import threading
import time

import numpy as np
import pandas as pd

from ..market.provider import MarketData, market_status
from ..market.universe import EQUITY_UNIVERSE, INDICES, INSTRUMENTS
from ..quant import risk
from ..quant.backtest import rsi
from ..quant.returns import annualized_volatility, max_drawdown
from . import analytics, assistant, tradecheck
from .assistant import PERIODS, _pct
from .book import Ctx
from .tradecheck import _check, tally

HORIZONS = ("short", "long")
# Short term reads price behaviour only; long term adds what the business earns and what it costs.
STOCK_GROUPS = {"short": ("trend", "risk"), "long": ("trend", "valuation", "business", "risk")}
SCORE_WORDS = {
    "company": ("Most checks are positive", "More checks are positive than negative", "The checks are evenly split",
                "More checks are negative than positive", "Most checks are negative"),
    "sector": ("The sector is in strong shape", "The sector is leaning positive", "The sector is mixed",
               "The sector is leaning negative", "The sector is weak"),
    "market": ("The market is in strong shape", "The market is leaning positive", "The market is mixed",
               "The market is leaning negative", "The market is weak"),
}


def _scored(checks: list[dict], kind: str) -> dict:
    """The score a set of checks adds up to, with words for it."""
    counted = tally(checks)
    value = counted["value"]
    words = SCORE_WORDS[kind]
    if value is None:
        label, tone = "Too little data to score", "unknown"
    elif value >= 70:
        label, tone = words[0], "for"
    elif value >= 56:
        label, tone = words[1], "for"
    elif value >= 45:
        label, tone = words[2], "mixed"
    elif value >= 31:
        label, tone = words[3], "against"
    else:
        label, tone = words[4], "against"
    return {**counted, "label": label, "tone": tone}


def _reasons(checks: list[dict], verdict: str, limit: int = 3) -> list[dict]:
    """The heaviest checks that fell one way, as short labels."""
    top = sorted((c for c in checks if c["verdict"] == verdict), key=lambda c: -c["weight"])[:limit]
    return [{"title": c["title"], "reading": c["reading"]} for c in top]


# ----------------------------------------------------------------- companies
def _facts(symbol: str, df: pd.DataFrame, info: dict, bench_daily: pd.Series, bench_returns: dict, bench_name: str, risk_free: float) -> dict:
    """What the checks need to know about one company, in the shape the trade check reads."""
    inst = INSTRUMENTS[symbol]
    close = df["Close"]
    quote = MarketData._quote(symbol, df)
    year = close.iloc[-253:].pct_change(fill_method=None).dropna()
    beta, _ = risk.beta_alpha(year, bench_daily, risk_free)
    gauge = rsi(close, 14).iloc[-1] if len(close) > 20 else None
    prior = df.iloc[-252:-1]
    return {
        "symbol": symbol,
        "name": inst.name,
        "sector": inst.sector,
        "industry": inst.industry,
        "benchmark_name": bench_name,
        "quote": quote,
        "returns": {label: assistant._change(close, n) for label, n in PERIODS.items()},
        "benchmark_returns": bench_returns,
        "trend": {
            "sma_50": float(close.iloc[-50:].mean()) if len(close) >= 50 else None,
            "sma_200": float(close.iloc[-200:].mean()) if len(close) >= 200 else None,
            "rsi_14": float(gauge) if gauge is not None and gauge == gauge else None,
            "volatility": annualized_volatility(year),
            "beta": beta,
            "drawdown": max_drawdown(year) if len(year) > 20 else {"value": None, "peak": None, "trough": None, "recovered": None},
        },
        "fundamentals": {
            k: info.get(k)
            for k in ("market_cap", "pe", "forward_pe", "eps", "roe", "debt_to_equity", "profit_margin", "revenue_growth", "earnings_growth")
        },
        # The annual statements are only fetched for a stock someone opens, so they are left out here.
        "financial_history": {},
        "new_high": bool(len(df) > 60 and df["High"].iloc[-1] >= prior["High"].max()),
        "new_low": bool(len(df) > 60 and df["Low"].iloc[-1] <= prior["Low"].min()),
    }


def score_company(b: dict, peers: dict, bench_volatility: float | None) -> tuple[dict, dict]:
    """A company's short and long-term scores, and the checks behind them by group."""
    extras = {"asset_class": "Equity", "peers": peers, "benchmark_volatility": bench_volatility, "var_95": None}
    groups = {
        "trend": tradecheck._trend(b, "BUY"),
        "valuation": tradecheck._valuation(b, extras, "BUY"),
        "business": [c for c in tradecheck._business(b, extras, "BUY") if c["id"] != "profit_trend"],
        "risk": tradecheck._risk(b, extras, "BUY", 0.0),
    }
    scores = {h: _scored([c for g in STOCK_GROUPS[h] for c in groups[g]], "company") for h in HORIZONS}
    return scores, groups


def _company(b: dict, scores: dict, groups: dict, live: bool) -> dict:
    q, t, f = b["quote"], b["trend"], b["fundamentals"]
    price = q["price"]
    why = {}
    for h in HORIZONS:
        checks = [c for g in STOCK_GROUPS[h] for c in groups[g]]
        why[h] = {"for": _reasons(checks, "for"), "against": _reasons(checks, "against")}
    return {
        "symbol": b["symbol"],
        "name": b["name"],
        "sector": b["sector"],
        "industry": b["industry"],
        "price": round(price, 2),
        "change_pct": q["change_pct"],
        "traded_value": q["volume"] * price,
        "avg_traded_value": q["avg_volume"] * price,
        "live": live,
        "returns": b["returns"],
        "market_cap": f["market_cap"],
        "pe": f["pe"],
        "roe": f["roe"],
        "revenue_growth": f["revenue_growth"],
        "earnings_growth": f["earnings_growth"],
        "above_50": price > t["sma_50"] if t["sma_50"] else None,
        "above_200": price > t["sma_200"] if t["sma_200"] else None,
        "rsi": t["rsi_14"],
        "volatility": t["volatility"],
        "from_high": (price / q["high_52w"] - 1) * 100 if q["high_52w"] else None,
        "from_low": (price / q["low_52w"] - 1) * 100 if q["low_52w"] else None,
        "new_high": b["new_high"],
        "new_low": b["new_low"],
        "score": scores,
        "why": why,
        "groups": groups,
    }


# ------------------------------------------------------------------- sectors
def sector_checks(name: str, members: list[dict], market: dict) -> dict[str, list[dict]]:
    """The checks for one sector, for each horizon. `market` carries the index's returns and the middle P/E of all companies."""
    total = len(members)

    def middle(key: str) -> float | None:
        values = [m[key] for m in members if m[key] is not None]
        return float(np.median(values)) if len(values) >= 3 else None

    def average(period: str) -> float | None:
        values = [m["returns"][period] for m in members if m["returns"].get(period) is not None]
        return float(np.mean(values)) if values else None

    def breadth(days: int, weight: int) -> dict:
        which = "recent" if days == 50 else "longer"
        title = f"Companies above their {days}-day average"
        learn = (
            f"How many of the sector's companies trade above their own {days}-day average price. "
            f"When most do, the {which} uptrend is shared across the sector and not carried by one or two names."
        )
        known = [m[f"above_{days}"] for m in members if m[f"above_{days}"] is not None]
        if len(known) < 3:
            return _check(f"above_{days}", title, learn, "unknown", "Not enough history", "Too few companies have enough price history.", weight)
        up = sum(known)
        part = up / len(known) * 100
        verdict = "for" if part >= 65 else "against" if part <= 35 else "neutral"
        tail = {"for": f"so the {which} uptrend is broad", "neutral": "a mixed picture", "against": f"so most of the sector is in a {which} downtrend"}[verdict]
        return _check(f"above_{days}", title, learn, verdict, f"{up} of {len(known)}",
                      f"{up} of the {len(known)} {name} companies tracked here are above their {days}-day average, {tail}.", weight)

    def versus(period: str, need: float, weight: int) -> dict:
        title = f"Against the market over {period}"
        learn = "The sector's average return beside the index over the same stretch. Money has been moving toward a sector that is ahead, and away from one that is behind."
        own, index = average(period), market["returns"].get(period)
        id = f"vs_{period.replace(' ', '_')}"
        if own is None or index is None:
            return _check(id, title, learn, "unknown", "Not enough history", "There is not enough price history to compare.", weight)
        gap = own - index
        verdict = "for" if gap > need else "against" if gap < -need else "neutral"
        reading = f"{abs(gap):.1f} points {'ahead' if gap >= 0 else 'behind'}"
        return _check(id, title, learn, verdict, reading,
                      f"Over {period} the sector averaged {_pct(own)} and {market['benchmark_name']} {_pct(index)}: {reading} {'of ' if gap >= 0 else ''}the market.", weight)

    def stretch() -> dict:
        title = "Short-term stretch (RSI)"
        learn = "RSI is a 0 to 100 gauge of recent buying against selling. Above 70 prices have risen fast and often pause; below 30 they have fallen fast and often steady."
        value = middle("rsi")
        if value is None:
            return _check("stretch", title, learn, "unknown", "Not enough history", "Too few companies have enough price history.", 1)
        verdict = "against" if value > 70 else "for" if value < 30 else "neutral"
        tail = {"against": "prices have run up fast and often pause from here", "for": "prices have dropped fast, and selling this heavy often eases",
                "neutral": "neither stretched nor washed out"}[verdict]
        return _check("stretch", title, learn, verdict, f"{value:.0f}", f"The middle RSI across the sector is {value:.0f}: {tail}.", 1)

    def highs() -> dict:
        near_high = sum(m["from_high"] is not None and m["from_high"] >= -5 for m in members)
        near_low = sum(m["from_low"] is not None and m["from_low"] <= 5 for m in members)
        verdict = "for" if near_high / total >= 0.3 and near_high > near_low else "against" if near_low / total >= 0.3 and near_low > near_high else "neutral"
        return _check(
            "highs", "Near 52-week highs or lows",
            "Counts the companies sitting close to their highest or lowest price of the past year. Many near highs is strength; many near lows means the sector is out of favour.",
            verdict, f"{near_high} near highs, {near_low} near lows",
            f"{near_high} of the {total} companies are within 5% of their 52-week high and {near_low} are within 5% of their low.", 1,
        )

    def swings() -> dict:
        title = "How much prices swing"
        learn = "The middle yearly volatility of the sector's companies. The bigger it is, the larger the day-to-day moves you have to sit through."
        value = middle("volatility")
        if value is None:
            return _check("swings", title, learn, "unknown", "Not enough history", "There is under a year of prices to measure it.", 1)
        verdict = "for" if value < 0.25 else "against" if value > 0.40 else "neutral"
        tail = {"for": "calm for single stocks", "neutral": "an ordinary amount for single stocks", "against": "a rough ride"}[verdict]
        return _check("swings", title, learn, verdict, f"{value * 100:.0f}% a year",
                      f"A typical company here swings about {value * 100:.0f}% a year, or {value * 100 / 15.9:.1f}% on a normal day: {tail}.", 1)

    def growth() -> dict:
        title = "Sales and profit growth"
        learn = "The middle growth in sales and in profit across the sector, against a year earlier. Growing businesses give share prices something to follow."
        figures = [(label, v * 100) for label, v in (("sales", middle("revenue_growth")), ("profit", middle("earnings_growth"))) if v is not None]
        if not figures:
            return _check("growth", title, learn, "unknown", "No figures", "Too few companies report recent growth figures.", 2)
        down = [label for label, v in figures if v < -5]
        verdict = "for" if all(v > 5 for _, v in figures) else "against" if down else "neutral"
        reading = ", ".join(f"{label} {_pct(v, 0)}" for label, v in figures)
        tail = {"for": "The sector's businesses are growing.", "neutral": "Growth is slow or mixed.",
                "against": f"{' and '.join(down).capitalize()} {'is' if down == ['profit'] else 'are'} shrinking at the typical company."}[verdict]
        return _check("growth", title, learn, verdict, reading, f"At the middle company, against a year earlier: {reading}. {tail}", 2)

    def profitability() -> dict:
        title = "Profit on shareholders' money (ROE)"
        learn = "Return on equity is a year's profit as a share of the money shareholders have in the business. Above about 15% is a strong earner; in single digits the money is working slowly."
        value = middle("roe")
        if value is None:
            return _check("profitability", title, learn, "unknown", "No figures", "Too few companies report a return on equity.", 2)
        verdict = "for" if value > 0.15 else "against" if value < 0.08 else "neutral"
        return _check("profitability", title, learn, verdict, f"{value * 100:.1f}%",
                      f"The middle company earns {value * 100:.1f} rupees a year on every 100 rupees of shareholders' money.", 2)

    def valuation() -> dict:
        title = "Price against earnings (P/E)"
        learn = (
            "P/E is the share price divided by a year of profit per share. A sector priced far above the rest has a lot of growth "
            "already expected of it; one priced far below is cheap, sometimes for a reason."
        )
        value, everyone = middle("pe_clean"), market["median_pe"]
        if value is None or not everyone:
            return _check("valuation", title, learn, "unknown", "No figures", "Too few companies have a usable P/E.", 1)
        ratio = value / everyone
        verdict = "against" if ratio > 1.5 else "for" if ratio < 0.75 else "neutral"
        tail = {"against": "a clear premium, so a lot of growth is already in the price", "neutral": "about the going rate",
                "for": "noticeably less than elsewhere"}[verdict]
        return _check("valuation", title, learn, verdict, f"{value:.1f} vs {everyone:.1f}",
                      f"The middle P/E in {name} is {value:.1f} against {everyone:.1f} across all tracked companies: {tail}.", 1)

    return {
        "short": [breadth(50, 2), breadth(200, 1), versus("1 month", 2.0, 2), versus("3 months", 4.0, 1), stretch(), highs(), swings()],
        "long": [breadth(200, 2), versus("1 year", 6.0, 1), growth(), profitability(), valuation(), swings()],
    }


def _sector(name: str, members: list[dict], market: dict) -> dict:
    live = [m for m in members if m["live"]]
    checks = sector_checks(name, members, market)
    ranked = {
        h: [m["symbol"] for m in sorted((m for m in members if m["score"][h]["value"] is not None),
                                        key=lambda m: (-m["score"][h]["value"], -(m["market_cap"] or 0)))]
        for h in HORIZONS
    }
    periods = ("1 week", "1 month", "3 months", "1 year")
    return {
        "name": name,
        "count": len(members),
        "change_pct": float(np.mean([m["change_pct"] for m in live])) if live else None,
        "advances": sum(m["change_pct"] > 0 for m in live),
        "declines": sum(m["change_pct"] < 0 for m in live),
        "returns": {p: (float(np.mean(v)) if (v := [m["returns"][p] for m in members if m["returns"].get(p) is not None]) else None) for p in periods},
        # Three companies is the least a sector score can stand on.
        "score": {h: _scored(checks[h] if len(members) >= 3 else [], "sector") for h in HORIZONS},
        "checks": checks,
        "ranked": ranked,
    }


# ---------------------------------------------------------------- the market
def mood_checks(m: dict) -> list[dict]:
    """The checks behind the market mood. `m` has the index, breadth across the tracked companies, and the VIX."""
    out = []
    index, name, b = m["index"], m["benchmark_name"], m["breadth"]
    for days, weight, which, span in ((200, 2, "longer", "about ten months"), (50, 1, "recent", "about ten weeks")):
        title = f"{name} against its {days}-day average"
        learn = f"The index beside its average close over {span}. Above it, the {which} trend of the whole market is up."
        average = index.get(f"sma_{days}")
        if not average:
            out.append(_check(f"index_{days}", title, learn, "unknown", "Not enough history", "There is not enough index history.", weight))
            continue
        gap = (index["price"] / average - 1) * 100
        verdict = "for" if gap > 2 else "against" if gap < -2 else "neutral"
        where = f"{abs(gap):.1f}% {'above' if gap >= 0 else 'below'}"
        shape = {"for": "is up", "neutral": "is flat", "against": "is down"}[verdict]
        out.append(_check(f"index_{days}", title, learn, verdict, where,
                          f"{name} at {index['price']:,.0f} is {where} its {days}-day average of {average:,.0f}, so the market's {which} trend {shape}.", weight))

    total = b["total"]
    for days, key in ((50, "above_50"), (200, "above_200")):
        title = f"Stocks above their {days}-day average"
        learn = (
            "Breadth: how many companies are taking part. An index can rise on a few giants while most stocks fall; "
            "when most stocks are above their own average, the move is real and wide."
        )
        if not total:
            out.append(_check(f"breadth_{days}", title, learn, "unknown", "No prices", "Today's prices are not in yet.", 2))
            continue
        part = b[key] / total * 100
        verdict = "for" if part >= 60 else "against" if part <= 40 else "neutral"
        tail = {"for": "most of the market is taking part", "neutral": "about half the market is taking part", "against": "most stocks are not taking part"}[verdict]
        out.append(_check(f"breadth_{days}", title, learn, verdict, f"{part:.0f}%",
                          f"{b[key]} of the {total} tracked companies are above their {days}-day average: {tail}.", 2))

    highs, lows = b["new_highs"], b["new_lows"]
    verdict = "for" if highs >= 3 and highs >= 2 * max(lows, 1) else "against" if lows >= 3 and lows >= 2 * max(highs, 1) else "neutral"
    out.append(_check(
        "highs_lows", "New 52-week highs against lows",
        "How many companies touched their highest price in a year today, against how many touched their lowest. More highs than lows is a market with buyers in charge.",
        verdict, f"{highs} highs, {lows} lows",
        f"{highs} {'company' if highs == 1 else 'companies'} made a new 52-week high today and {lows} made a new low.", 1,
    ))

    vix = m["vix"]
    learn = (
        "India VIX is the market's own estimate of how much the NIFTY will swing over the next month, taken from option prices. "
        "Under about 14 the market is calm; over 20 it is nervous."
    )
    if not vix:
        out.append(_check("vix", "Fear gauge (India VIX)", learn, "unknown", "No reading", "There is no VIX reading in the data.", 1))
    else:
        level = vix["price"]
        verdict = "for" if level < 14 else "against" if level > 20 else "neutral"
        tail = {"for": "the market is calm", "neutral": "ordinary nerves", "against": "the market is nervous, and large daily moves are more likely"}[verdict]
        out.append(_check("vix", "Fear gauge (India VIX)", learn, verdict, f"{level:.1f}", f"India VIX is at {level:.1f}: {tail}.", 1))

    if total:
        out.append(_check(
            "today", "Today's session",
            "What happened today alone. One day says little about where things are heading, so it is noted but not scored.",
            "info", f"{b['advances']} up, {b['declines']} down",
            f"{name} is {_pct(index['change_pct'], 2)} today; {b['advances']} of the {total} tracked companies are up and {b['declines']} are down.",
        ))
    return out


# ------------------------------------------------------------------ snapshot
def build(ctx: Ctx) -> dict:
    """Score everything from the prices and company figures in the cache."""
    bars = ctx.market.bars(list(INDICES) + EQUITY_UNIVERSE)
    bench_symbol = ctx.settings.benchmark
    bench_name = analytics.benchmark_name(bench_symbol)
    bench_df = bars.get(bench_symbol)
    bench_close = bench_df["Close"].dropna() if bench_df is not None else pd.Series(dtype=float)
    bench_daily = bench_close.pct_change(fill_method=None).dropna()
    bench_returns = {label: assistant._change(bench_close, n) for label, n in PERIODS.items()}
    bench_volatility = annualized_volatility(bench_daily.iloc[-252:])

    facts = {}
    for symbol in EQUITY_UNIVERSE:
        df = bars.get(symbol)
        if df is None or len(df) < 60:
            continue
        facts[symbol] = _facts(symbol, df, ctx.market.info(symbol, wait=False), bench_daily, bench_returns, bench_name, ctx.settings.risk_free_rate)
    latest = max((b["quote"]["as_of"] for b in facts.values()), default=None)

    # A P/E in the hundreds is a rounding accident, not a valuation, and would drag the middle.
    usable = {s: b["fundamentals"]["pe"] for s, b in facts.items() if b["fundamentals"]["pe"] is not None and 0 < b["fundamentals"]["pe"] < 200}
    companies: dict[str, dict] = {}
    for symbol, b in facts.items():
        others = [pe for s, pe in usable.items() if s != symbol and facts[s]["sector"] == b["sector"]]
        peers = {"count": len(others), "median_pe": float(np.median(others)) if len(others) >= 3 else None}
        scores, groups = score_company(b, peers, bench_volatility)
        companies[symbol] = {**_company(b, scores, groups, b["quote"]["as_of"] == latest), "pe_clean": usable.get(symbol)}

    market = {"benchmark_name": bench_name, "returns": bench_returns, "median_pe": float(np.median(list(usable.values()))) if len(usable) >= 10 else None}
    names = sorted({c["sector"] for c in companies.values()})
    sectors = [_sector(name, [c for c in companies.values() if c["sector"] == name], market) for name in names]

    live = [c for c in companies.values() if c["live"]]
    breadth = {
        "advances": sum(c["change_pct"] > 0 for c in live),
        "declines": sum(c["change_pct"] < 0 for c in live),
        "unchanged": sum(c["change_pct"] == 0 for c in live),
        "total": len(live),
        "above_50": sum(bool(c["above_50"]) for c in live),
        "above_200": sum(bool(c["above_200"]) for c in live),
        "new_highs": sum(c["new_high"] for c in live),
        "new_lows": sum(c["new_low"] for c in live),
    }
    traded, usual = sum(c["traded_value"] for c in live), sum(c["avg_traded_value"] for c in live)

    indices = []
    for symbol, (name, short) in INDICES.items():
        df = bars.get(symbol)
        if df is None or len(df) < 30:
            continue
        close = df["Close"]
        quote = MarketData._quote(symbol, df)
        indices.append({
            "symbol": symbol, "name": name, "short": short, "price": quote["price"], "change_pct": quote["change_pct"],
            "high_52w": quote["high_52w"], "low_52w": quote["low_52w"],
            "returns": {p: assistant._change(close, PERIODS[p]) for p in ("1 week", "1 month", "3 months", "1 year")},
            "sma_50": float(close.iloc[-50:].mean()) if len(close) >= 50 else None,
            "sma_200": float(close.iloc[-200:].mean()) if len(close) >= 200 else None,
        })
    index = next((i for i in indices if i["symbol"] == bench_symbol), None)
    vix = next((i for i in indices if i["symbol"] == "^INDIAVIX"), None)
    checks = mood_checks({"index": index, "benchmark_name": bench_name, "breadth": breadth, "vix": vix}) if index else []

    by_move = sorted(live, key=lambda c: c["change_pct"], reverse=True)
    return {
        "as_of": latest,
        "benchmark": bench_name,
        "benchmark_returns": bench_returns,
        "index": index,
        "indices": indices,
        "vix": vix,
        "breadth": breadth,
        "turnover_ratio": traded / usual if usual else None,
        "mood": {"score": _scored(checks, "market"), "checks": checks},
        "sectors": sectors,
        "companies": companies,
        "movers": {
            "gainers": [c["symbol"] for c in by_move[:5]],
            "losers": [c["symbol"] for c in by_move[::-1][:5]],
            "active": [c["symbol"] for c in sorted(live, key=lambda c: c["traded_value"], reverse=True)[:5]],
        },
    }


_lock = threading.Lock()
_held: dict = {"at": 0.0, "data": None}


def snapshot(ctx: Ctx) -> dict:
    """The latest pulse, rebuilt about once a minute while the market is open."""
    ttl = 60.0 if market_status()["is_open"] else 600.0
    if _held["data"] is not None and time.time() - _held["at"] < ttl:
        return _held["data"]
    with _lock:
        if _held["data"] is None or time.time() - _held["at"] >= ttl:
            _held.update(data=build(ctx), at=time.time())
    return _held["data"]


# --------------------------------------------------------------------- views
def sector_named(pulse: dict, name: str) -> dict | None:
    return next((s for s in pulse["sectors"] if s["name"] == name), None)


def ranked_sectors(pulse: dict, horizon: str) -> list[dict]:
    """Sectors with a score, strongest first."""
    scored = [s for s in pulse["sectors"] if s["score"][horizon]["value"] is not None]
    return sorted(scored, key=lambda s: (-s["score"][horizon]["value"], s["name"]))


def company_row(c: dict, horizon: str) -> dict:
    """One company as the chat and the scoreboard show it."""
    return {
        "symbol": c["symbol"], "name": c["name"], "sector": c["sector"], "price": c["price"], "change_pct": c["change_pct"],
        "month": c["returns"].get("1 month"), "score": c["score"][horizon]["value"], "tone": c["score"][horizon]["tone"],
        "label": c["score"][horizon]["label"], "for": c["why"][horizon]["for"], "against": c["why"][horizon]["against"],
    }


def top_companies(pulse: dict, horizon: str, sector: str | None = None, limit: int = 5, budget: float | None = None) -> list[dict]:
    """The highest-scoring companies, in one sector or across all of them. With a budget, only those a single share of which it can buy."""
    pool = [c for c in pulse["companies"].values() if c["score"][horizon]["value"] is not None and (sector is None or c["sector"] == sector)]
    if budget is not None:
        pool = [c for c in pool if c["price"] <= budget]
    pool.sort(key=lambda c: (-c["score"][horizon]["value"], -(c["market_cap"] or 0)))
    return [company_row(c, horizon) for c in pool[:limit]]


def ideas(pulse: dict, amount: float, horizon: str, sector: str | None = None, limit: int = 5) -> dict:
    """Where a sum of money could go: the strongest sector (or the one asked about) and its highest-scoring companies,
    with what the money buys of each. A ranking by score, not a recommendation."""
    # A sector with only three or four tracked companies cannot offer five, and its score rests on very little.
    leaders = [s for s in ranked_sectors(pulse, horizon) if s["count"] >= limit]
    chosen = sector or (leaders[0]["name"] if leaders else None)
    picks = top_companies(pulse, horizon, chosen, limit, budget=amount) if chosen else []
    everyone = [c for c in pulse["companies"].values() if c["sector"] == chosen and c["score"][horizon]["value"] is not None]
    each = amount / len(picks) if picks else 0.0
    for row in picks:
        row["shares"] = math.floor(amount / row["price"])
        row["split_shares"] = math.floor(each / row["price"])
    return {
        "amount": amount,
        "horizon": horizon,
        "sector": chosen,
        "asked": sector is not None,
        "sectors": [{"name": s["name"], "score": s["score"][horizon]["value"], "tone": s["score"][horizon]["tone"]} for s in leaders[:3]],
        "sector_score": next(({"score": s["score"][horizon]["value"], "tone": s["score"][horizon]["tone"], "label": s["score"][horizon]["label"]}
                              for s in pulse["sectors"] if s["name"] == chosen), None),
        "each": each,
        "companies": picks,
        # Left out because one share costs more than the whole sum.
        "too_dear": sum(c["price"] > amount for c in everyone),
    }


def board(pulse: dict) -> dict:
    """The scoreboard the Market page shows: the mood, and every sector with its scores, checks and leaders."""
    return {
        "as_of": pulse["as_of"],
        "benchmark": pulse["benchmark"],
        "mood": pulse["mood"],
        "sectors": [
            {
                "name": s["name"], "count": s["count"], "change_pct": s["change_pct"], "advances": s["advances"], "declines": s["declines"],
                "returns": s["returns"], "score": s["score"], "checks": s["checks"],
                "leaders": {h: [company_row(pulse["companies"][symbol], h) for symbol in s["ranked"][h][:3]] for h in HORIZONS},
            }
            for s in pulse["sectors"]
        ],
    }
