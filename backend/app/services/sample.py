"""Sample workspace: realistic portfolios priced from actual market history.

Dates are relative to today so the data never looks stale, and every trade
is booked at that day's real traded price.
"""
from __future__ import annotations

import math
from datetime import timedelta

import pandas as pd

from ..quant.backtest import PRESETS
from . import book as books
from .book import Ctx

# (months ago, symbol, rupees) — buys
LONG_TERM = [
    (34, "RELIANCE", 60000), (34, "HDFCBANK", 50000), (33, "TCS", 45000), (32, "ITC", 30000),
    (31, "BHARTIARTL", 40000), (30, "HAL", 45000), (29, "LT", 40000), (28, "NIFTYBEES", 60000),
    (27, "SUNPHARMA", 30000), (26, "TITAN", 30000), (24, "GOLDBEES", 40000), (23, "BHARTIARTL", 25000),
    (22, "INFY", 35000), (20, "HAL", 30000), (19, "NIFTYBEES", 40000), (18, "ICICIBANK", 45000),
    (16, "RELIANCE", 30000), (14, "GOLDBEES", 25000), (13, "M&M", 35000), (11, "BEL", 30000),
    (9, "NIFTYBEES", 30000), (7, "HDFCBANK", 30000), (5, "ICICIBANK", 25000), (3, "TCS", 25000),
    (2, "LIQUIDBEES", 20000),
]
EXPERIMENTAL = [
    (16, "ETERNAL", 20000), (15, "DIXON", 25000), (14, "IRFC", 15000), (13, "TRENT", 20000),
    (12, "PERSISTENT", 25000), (10, "MAZDOCK", 20000), (9, "ETERNAL", 15000), (7, "POLYCAB", 20000),
    (6, "BSE", 20000), (4, "CGPOWER", 15000), (2, "NYKAA", 10000),
]
RETIREMENT_EXTRA = [(38, "HDFCBANK", 40000), (30, "ITC", 30000), (21, "POWERGRID", 30000), (12, "SBIN", 35000)]
PAPER = [
    (5, "RELIANCE", 150000), (5, "SBIN", 100000), (4, "TATASTEEL", 80000), (4, "INFY", 100000),
    (3, "ADANIPORTS", 90000), (2, "MARUTI", 120000), (1, "COALINDIA", 60000),
]
# (months ago, symbol, fraction of the position sold)
SELLS = {
    "long": [(15, "ITC", 0.4), (8, "TITAN", 1.0), (4, "HAL", 0.25)],
    "experimental": [(5, "IRFC", 1.0), (3, "DIXON", 0.5)],
    "paper": [(2, "TATASTEEL", 1.0), (1, "INFY", 0.5)],
}

JOURNAL = [
    {
        "symbol": "HAL", "action": "BUY", "months": 30, "horizon": "5+ years", "conviction": 5,
        "thesis": "Long-term exposure to the defence sector. HAL is the sole domestic maker of fighter aircraft and helicopters, with a multi-year order book and a government push to indigenise procurement.",
        "reasons": ["Order book several times annual revenue", "Expected sector growth from indigenisation", "Improving margins as deliveries scale", "Net-cash balance sheet"],
        "exit_conditions": "Fundamental deterioration: order cancellations, sustained execution delays on Tejas deliveries, or margins falling back below 20%.",
        "tags": ["defence", "psu", "core"],
    },
    {
        "symbol": "BHARTIARTL", "action": "BUY", "months": 31, "horizon": "3-5 years", "conviction": 4,
        "thesis": "The telecom market has consolidated to three players and tariffs are still low by global standards. ARPU growth should flow almost directly to free cash flow as 5G capex peaks.",
        "reasons": ["Tariff hikes with little subscriber loss", "Capex intensity falling after 5G rollout", "Africa business adds diversification"],
        "exit_conditions": "A new price war, or regulatory action that caps tariffs.",
        "tags": ["telecom", "core"],
    },
    {
        "symbol": "GOLDBEES", "action": "BUY", "months": 24, "horizon": "Indefinite", "conviction": 3,
        "thesis": "A 5–10% gold allocation as a hedge against rupee depreciation and equity drawdowns. Not a return bet — it is here to be uncorrelated.",
        "reasons": ["Low correlation with equity holdings", "Central bank buying", "Rupee hedge"],
        "exit_conditions": "Rebalance only when the allocation moves outside 5–10% of the portfolio.",
        "tags": ["hedge", "allocation"],
    },
    {
        "symbol": "ITC", "action": "BUY", "months": 32, "horizon": "3 years", "conviction": 3,
        "thesis": "High dividend yield with a hotels demerger as a catalyst. FMCG margins were improving and the cigarette business funds everything else.",
        "reasons": ["Dividend yield above 3%", "Hotels demerger unlocks value", "FMCG scale-up"],
        "exit_conditions": "Trim if the yield compresses below 2.5% or FMCG growth stalls.",
        "tags": ["dividend", "fmcg"],
        "status": "closed", "closed_months": 15,
        "outcome_notes": "Trimmed 40% after the demerger. The thesis on yield held; the FMCG re-rating did not arrive as quickly as expected. Kept the rest for income.",
    },
    {
        "symbol": "TITAN", "action": "BUY", "months": 26, "horizon": "5 years", "conviction": 4,
        "thesis": "Shift from unorganised to organised jewellery, with Tanishq as the trusted brand. Premium valuation justified by growth.",
        "reasons": ["Market share gains in jewellery", "Strong brand", "New categories: eyewear, wearables"],
        "exit_conditions": "Valuation above 80x earnings without matching growth, or sustained margin pressure from gold price volatility.",
        "tags": ["consumer"],
        "status": "closed", "closed_months": 8,
        "outcome_notes": "Sold the full position. Growth was fine but margins compressed with gold prices and the multiple left no room for error. Lesson: I underweighted valuation risk at entry.",
    },
    {
        "symbol": "ETERNAL", "action": "BUY", "months": 16, "horizon": "2-3 years", "conviction": 3,
        "thesis": "Quick commerce is taking share from kirana and modern trade faster than expected. Blinkit's unit economics turn positive at scale; food delivery is already a cash machine.",
        "reasons": ["Blinkit store rollout", "Food delivery duopoly", "Operating leverage"],
        "exit_conditions": "Competitive intensity forcing sustained cash burn, or store-level profitability failing to improve for three quarters.",
        "tags": ["experimental", "internet"],
    },
]

# (key, name, description, kind, colour, cash balance, starting capital).
# Name, description and kind double as the fingerprint used to find these again.
PORTFOLIOS = [
    ("long", "Long-Term Investments", "Core holdings bought to keep for years.", "investment", "#6E7BFF", 42000, 0),
    ("experimental", "Experimental", "Smaller, higher-conviction ideas with a shorter leash.", "investment", "#E8A23B", 8000, 0),
    ("retirement", "Retirement", "Monthly index and gold SIPs. Never sold.", "investment", "#2FB67C", 15000, 0),
    ("paper", "Paper Trading", "Virtual capital for testing ideas at live prices.", "paper", "#D4669B", 0, 1000000),
]
ALERT_NOTES = {
    ("RELIANCE", "price_above"): "Review position size if it gets here",
    ("HAL", "price_below"): "Add zone from the journal thesis",
    ("ETERNAL", "pct_change"): "Unusual daily move",
    ("TCS", "earnings"): "Results coming up",
    ("ITC", "dividend"): "Ex-dividend date approaching",
}

WATCHLISTS = {
    "Defence & PSU": ["HAL", "BEL", "MAZDOCK", "BDL", "RVNL", "IRFC", "NTPC", "COALINDIA"],
    "Quality compounders": ["ASIANPAINT", "PIDILITIND", "NESTLEIND", "TITAN", "HDFCAMC", "DMART", "DIVISLAB", "BAJFINANCE"],
}


class _Pricer:
    def __init__(self, ctx: Ctx, symbols: list[str]):
        self.today = pd.Timestamp(books.today_ist())
        self.bars = ctx.market.bars(symbols)

    def trade(self, symbol: str, months_ago: float, jitter: int) -> tuple[str, float, float] | None:
        """(date, real traded price, split factor since) for a past session."""
        df = self.bars.get(symbol)
        if df is None or df.empty:
            return None
        target = self.today - timedelta(days=round(months_ago * 30.44) - jitter % 9)
        pos = min(int(df.index.searchsorted(target)), len(df) - 1)
        if months_ago > 0 and pos >= len(df) - 1:
            pos = max(len(df) - 2, 0)
        day = df.index[pos]
        row = df.iloc[pos]
        factor = float(df["Splits"][(df.index > day) & (df["Splits"] > 0)].prod()) or 1.0
        price = (float(row["Open"]) + float(row["Close"])) / 2 * factor
        return day.date().isoformat(), round(price * 20) / 20, factor


def _transactions(pricer: _Pricer, portfolio_id: str, buys: list, sells: list) -> list[dict]:
    events = [(m, s, "BUY", amount) for m, s, amount in buys] + [(m, s, "SELL", frac) for m, s, frac in sells]
    events.sort(key=lambda e: -e[0])
    held: dict[str, float] = {}  # in today's share terms
    rows = []
    for i, (months, symbol, kind, amount) in enumerate(events):
        priced = pricer.trade(symbol, months, i * 5)
        if not priced:
            continue
        when, price, factor = priced
        if kind == "BUY":
            qty = max(math.floor(amount / price), 1)
            held[symbol] = held.get(symbol, 0.0) + qty * factor
            note = ""
        else:
            qty = math.floor(held.get(symbol, 0.0) * amount / factor)
            if qty < 1:
                continue
            held[symbol] -= qty * factor
            note = "Booked partial profits" if amount < 1 else "Exited position"
        rows.append(
            {
                "portfolio_id": portfolio_id,
                "symbol": symbol,
                "transaction_type": kind,
                "quantity": qty,
                "price": price,
                "fees": round(qty * price * 0.0012, 2),
                "transaction_date": when,
                "notes": note,
                "source": "sample",
            }
        )
    return rows


def seed(ctx: Ctx) -> dict:
    """Populate the caller's workspace with sample data."""
    sip = [(m, s, a) for m in range(40, 0, -1) for s, a in (("NIFTYBEES", 10000), ("JUNIORBEES", 5000), ("GOLDBEES", 3000))]
    symbols = sorted(
        {s for _, s, _ in LONG_TERM + EXPERIMENTAL + RETIREMENT_EXTRA + PAPER + sip}
        | {j["symbol"] for j in JOURNAL}
        | {s for group in WATCHLISTS.values() for s in group}
        | {ctx.settings.benchmark}
    )
    pricer = _Pricer(ctx, symbols)
    if not pricer.bars:
        raise RuntimeError("Market data is unavailable, so the sample portfolios cannot be priced.")

    plans = {"long": LONG_TERM, "experimental": EXPERIMENTAL, "retirement": sip + RETIREMENT_EXTRA, "paper": PAPER}
    specs = PORTFOLIOS
    ids: dict[str, str] = {}
    total = 0
    for key, name, description, kind, color, cash, capital in specs:
        buys = plans[key]
        portfolio = ctx.store.insert(
            "portfolios",
            {"name": name, "description": description, "kind": kind, "color": color, "benchmark": ctx.settings.benchmark,
             "cash_balance": cash, "initial_capital": capital},
        )[0]
        ids[key] = portfolio["id"]
        rows = _transactions(pricer, portfolio["id"], buys, SELLS.get(key, []))
        if key == "paper":
            for r in rows:
                r["fees"] = 0.0
        for i in range(0, len(rows), 200):
            ctx.store.insert("transactions", rows[i : i + 200])
        total += len(rows)
        books.sync_holdings(ctx, portfolio["id"])

    for name, members in WATCHLISTS.items():
        watchlist = ctx.store.insert("watchlists", {"name": name})[0]
        ctx.store.insert("watchlist_stocks", [{"watchlist_id": watchlist["id"], "symbol": s, "note": ""} for s in members])

    entries = []
    for j in JOURNAL:
        priced = pricer.trade(j["symbol"], j["months"], 0)
        if not priced:
            continue
        when, price, _ = priced
        closed = j.get("closed_months")
        entries.append(
            {
                "portfolio_id": ids["experimental"] if "experimental" in j["tags"] else ids["long"],
                "symbol": j["symbol"],
                "action": j["action"],
                "entry_price": price,
                "entry_date": when,
                "horizon": j["horizon"],
                "thesis": j["thesis"],
                "reasons": j["reasons"],
                "exit_conditions": j["exit_conditions"],
                "conviction": j["conviction"],
                "tags": j["tags"],
                "status": j.get("status", "open"),
                "outcome_notes": j.get("outcome_notes", ""),
                "closed_at": (pricer.today - timedelta(days=round(closed * 30.44))).date().isoformat() if closed else None,
            }
        )
    ctx.store.insert("journal_entries", entries)

    quotes = ctx.market.quotes(["RELIANCE", "HAL", "ETERNAL"])
    alerts = []
    if "RELIANCE" in quotes:
        alerts.append(("RELIANCE", "price_above", round(quotes["RELIANCE"]["price"] * 1.06 / 5) * 5))
    if "HAL" in quotes:
        alerts.append(("HAL", "price_below", round(quotes["HAL"]["price"] * 0.9 / 10) * 10))
    alerts += [("ETERNAL", "pct_change", 4), ("TCS", "earnings", 7), ("ITC", "dividend", 10)]
    alerts = [(s, t, v, ALERT_NOTES[(s, t)]) for s, t, v in alerts]
    ctx.store.insert(
        "alerts",
        [{"symbol": s, "alert_type": t, "threshold": v, "note": n, "is_active": True, "triggered_at": None, "last_value": None}
         for s, t, v, n in alerts],
    )

    ctx.store.insert(
        "backtest_strategies",
        [{"name": p["name"], "description": p["description"], "config": p["config"]} for p in PRESETS[:2]],
    )
    return {"portfolios": len(specs), "transactions": total, "journal_entries": len(entries), "watchlists": len(WATCHLISTS)}


# ------------------------------------------------------------------ removal
def _fingerprint(portfolio: dict) -> bool:
    return any(
        portfolio.get("name") == name and (portfolio.get("description") or "") == description and portfolio.get("kind") == kind
        for _, name, description, kind, *_ in PORTFOLIOS
    )


def _seeded(transaction: dict) -> bool:
    # Paper trades seeded by earlier versions were tagged "paper"; real paper orders carry this note.
    source = transaction.get("source")
    return source == "sample" or (source == "paper" and transaction.get("notes") != "Simulated market order")


def has_sample(ctx: Ctx) -> bool:
    """Whether the workspace holds a sample portfolio that `remove` would delete."""
    return any(
        _fingerprint(p) and all(_seeded(t) for t in ctx.store.list("transactions", {"portfolio_id": p["id"]}))
        for p in ctx.store.list("portfolios")
    )


def remove(ctx: Ctx, forget_share=None) -> dict:
    """Delete the sample data from a workspace, leaving anything the user made
    or changed. A sample portfolio the user has added their own trades to, or
    renamed, is kept and reported back."""
    removed = {"portfolios": 0, "transactions": 0, "watchlists": 0, "journal_entries": 0, "alerts": 0, "strategies": 0}
    kept: list[str] = []

    for portfolio in ctx.store.list("portfolios"):
        if not _fingerprint(portfolio):
            continue
        transactions = ctx.store.list("transactions", {"portfolio_id": portfolio["id"]})
        if not all(_seeded(t) for t in transactions):
            kept.append(portfolio["name"])
            continue
        if forget_share:
            for share in ctx.store.list("portfolio_shares", {"portfolio_id": portfolio["id"]}):
                forget_share(share["id"])
        for table in ("transactions", "holdings", "portfolio_snapshots", "portfolio_shares"):
            ctx.store.delete(table, {"portfolio_id": portfolio["id"]})
        ctx.store.delete("portfolios", {"id": portfolio["id"]})
        removed["portfolios"] += 1
        removed["transactions"] += len(transactions)

    theses = {j["thesis"] for j in JOURNAL}
    for entry in ctx.store.list("journal_entries"):
        if entry.get("thesis") in theses:
            ctx.store.delete("journal_entries", {"id": entry["id"]})
            removed["journal_entries"] += 1

    stocks = ctx.store.list("watchlist_stocks")
    for watchlist in ctx.store.list("watchlists"):
        members = {s["symbol"] for s in stocks if s["watchlist_id"] == watchlist["id"]}
        if watchlist["name"] in WATCHLISTS and members <= set(WATCHLISTS[watchlist["name"]]):
            ctx.store.delete("watchlist_stocks", {"watchlist_id": watchlist["id"]})
            ctx.store.delete("watchlists", {"id": watchlist["id"]})
            removed["watchlists"] += 1

    for alert in ctx.store.list("alerts"):
        if ALERT_NOTES.get((alert["symbol"], alert["alert_type"])) == alert.get("note"):
            ctx.store.delete("alerts", {"id": alert["id"]})
            removed["alerts"] += 1

    presets = {p["name"]: p for p in PRESETS[:2]}
    for strategy in ctx.store.list("backtest_strategies"):
        preset = presets.get(strategy["name"])
        if preset and strategy.get("description") == preset["description"] and strategy.get("config") == preset["config"]:
            ctx.store.delete("backtest_results", {"strategy_id": strategy["id"]})
            ctx.store.delete("backtest_strategies", {"id": strategy["id"]})
            removed["strategies"] += 1

    return {**removed, "kept_portfolios": kept}
