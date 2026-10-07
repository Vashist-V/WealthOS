"""A `Book` is one portfolio (or all investment portfolios combined) with its
ledger replayed: the starting point for every valuation and analytic."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

import pandas as pd
from fastapi import HTTPException

from ..config import Settings
from ..market.provider import IST, MarketData
from ..quant import ledger
from ..quant.returns import xirr
from ..store.base import Store

ALL = "all"


@dataclass
class Ctx:
    store: Store
    market: MarketData
    settings: Settings
    mode: str  # "demo" | "supabase"
    email: str | None = None


@dataclass
class Book:
    id: str
    name: str
    kind: str  # investment | paper | combined
    benchmark: str
    portfolios: list[dict]
    transactions: list[dict]
    adjusted: list[dict]
    positions: dict[str, ledger.Position]
    cash: float
    initial_capital: float

    @property
    def symbols(self) -> list[str]:
        return sorted({t["symbol"] for t in self.transactions})

    @property
    def open_positions(self) -> list[ledger.Position]:
        return [p for p in self.positions.values() if p.is_open]


def today_ist() -> date:
    return datetime.now(IST).date()


def splits_for(market: MarketData, symbols: list[str]) -> ledger.Splits:
    out: ledger.Splits = {}
    for symbol, df in market.bars(symbols).items():
        s = df["Splits"]
        out[symbol] = [(d, float(v)) for d, v in s[s > 0].items()]
    return out


def load_book(ctx: Ctx, portfolio_id: str) -> Book:
    if portfolio_id == ALL:
        portfolios = [p for p in ctx.store.list("portfolios", order="created_at.asc") if p.get("kind") != "paper"]
        ids = [p["id"] for p in portfolios]
        transactions = ctx.store.list("transactions", {"portfolio_id": ids}) if ids else []
        name, kind = "All portfolios", "combined"
        benchmark = ctx.settings.benchmark
        cash = sum(float(p.get("cash_balance") or 0) for p in portfolios)
        initial = 0.0
    else:
        portfolio = ctx.store.get("portfolios", portfolio_id)
        if not portfolio:
            raise HTTPException(404, "Portfolio not found")
        portfolios = [portfolio]
        transactions = ctx.store.list("transactions", {"portfolio_id": portfolio_id})
        name, kind = portfolio["name"], portfolio.get("kind") or "investment"
        benchmark = portfolio.get("benchmark") or ctx.settings.benchmark
        initial = float(portfolio.get("initial_capital") or 0)
        cash = float(portfolio.get("cash_balance") or 0)

    symbols = sorted({t["symbol"] for t in transactions})
    adjusted = ledger.adjust_for_splits(transactions, splits_for(ctx.market, symbols))
    if kind == "paper":
        cash = initial + sum(amount for _, amount in ledger.cash_flows(adjusted))
    return Book(
        id=portfolio_id,
        name=name,
        kind=kind,
        benchmark=benchmark,
        portfolios=portfolios,
        transactions=transactions,
        adjusted=adjusted,
        positions=ledger.build_positions(adjusted),
        cash=cash,
        initial_capital=initial,
    )


def _day_pnl(symbol: str, quantity: float, quote: dict | None, adjusted: list[dict]) -> float:
    """Today's P&L for a symbol, crediting shares bought or sold in today's
    session from their trade price rather than yesterday's close."""
    if not quote:
        return 0.0
    price, prev = quote["price"], quote["prev_close"]
    pnl = quantity * (price - prev)
    for t in adjusted:
        if t["symbol"] != symbol or str(t["transaction_date"])[:10] != quote["as_of"]:
            continue
        if t["transaction_type"] == "BUY":
            pnl -= t["quantity"] * (t["price"] - prev)
        elif t["transaction_type"] == "SELL":
            pnl += t["quantity"] * (t["price"] - prev)
    return pnl


def holdings(ctx: Ctx, book: Book) -> list[dict]:
    positions = book.open_positions
    quotes = ctx.market.quotes([p.symbol for p in positions])
    today = today_ist()
    rows = []
    for p in positions:
        q = quotes.get(p.symbol)
        inst = ctx.market.instrument(p.symbol)
        price = q["price"] if q else p.avg_cost
        value = p.quantity * price
        day_pnl = _day_pnl(p.symbol, p.quantity, q, book.adjusted)
        trailing_dps = ctx.market.trailing_dividend(p.symbol) if q else 0.0
        rows.append(
            {
                "symbol": p.symbol,
                "name": inst["name"],
                "sector": inst["sector"],
                "industry": inst["industry"],
                "asset_class": inst["asset_class"],
                "quantity": round(p.quantity, 4),
                "avg_cost": round(p.avg_cost, 2),
                "invested": round(p.cost_basis, 2),
                "price": round(price, 2),
                "prev_close": round(q["prev_close"], 2) if q else None,
                "value": round(value, 2),
                "pnl": round(value - p.cost_basis, 2),
                "pnl_pct": (value / p.cost_basis - 1) * 100 if p.cost_basis > 0 else 0.0,
                "day_change_pct": q["change_pct"] if q else 0.0,
                "day_pnl": round(day_pnl, 2),
                "realized_pnl": round(p.realized_pnl, 2),
                "dividends": round(p.dividends, 2),
                "holding_days": round(p.holding_days(today)),
                "first_buy": p.first_buy.isoformat() if p.first_buy else None,
                "high_52w": q["high_52w"] if q else None,
                "low_52w": q["low_52w"] if q else None,
                "dividend_yield": trailing_dps / price * 100 if price else 0.0,
                "priced": q is not None,
                "as_of": q["as_of"] if q else None,
                "spark": ctx.market.spark(p.symbol, 30),
            }
        )
    total = sum(r["value"] for r in rows)
    for r in rows:
        r["weight"] = r["value"] / total * 100 if total else 0.0
    rows.sort(key=lambda r: r["value"], reverse=True)
    return rows


def summarize(ctx: Ctx, book: Book, rows: list[dict]) -> dict:
    invested = sum(r["invested"] for r in rows)
    value = sum(r["value"] for r in rows)
    day_pnl = sum(r["day_pnl"] for r in rows)
    closed_today = [p for p in book.positions.values() if not p.is_open and p.last_trade == today_ist()]
    if closed_today:
        quotes = ctx.market.quotes([p.symbol for p in closed_today])
        day_pnl += sum(_day_pnl(p.symbol, 0.0, quotes.get(p.symbol), book.adjusted) for p in closed_today)
    realized = sum(p.realized_pnl for p in book.positions.values())
    dividends = sum(p.dividends for p in book.positions.values())
    unrealized = value - invested
    flows = ledger.cash_flows(book.adjusted)
    if value > 0:
        flows = flows + [(today_ist(), value)]
    first = min((ledger.to_date(t["transaction_date"]) for t in book.adjusted), default=None)
    previous = value - day_pnl
    return {
        "invested": round(invested, 2),
        "value": round(value, 2),
        "cash": round(book.cash, 2),
        "net_worth": round(value + book.cash, 2),
        "unrealized_pnl": round(unrealized, 2),
        "unrealized_pct": unrealized / invested * 100 if invested > 0 else 0.0,
        "realized_pnl": round(realized, 2),
        "dividends": round(dividends, 2),
        "total_pnl": round(unrealized + realized + dividends, 2),
        "day_pnl": round(day_pnl, 2),
        "day_pct": day_pnl / previous * 100 if previous > 0 else 0.0,
        "xirr": xirr(flows),
        "holdings_count": len(rows),
        "transactions_count": len(book.transactions),
        "first_investment": first.isoformat() if first else None,
        "initial_capital": round(book.initial_capital, 2),
        "as_of": max((r["as_of"] for r in rows if r["as_of"]), default=None),
    }


def _group(rows: list[dict], key: str, total: float) -> list[dict]:
    buckets: dict[str, dict] = {}
    for r in rows:
        b = buckets.setdefault(r[key], {"name": r[key], "value": 0.0, "invested": 0.0, "day_pnl": 0.0, "count": 0})
        b["value"] += r["value"]
        b["invested"] += r["invested"]
        b["day_pnl"] += r["day_pnl"]
        b["count"] += 1
    out = []
    for b in buckets.values():
        out.append(
            {
                **b,
                "value": round(b["value"], 2),
                "invested": round(b["invested"], 2),
                "weight": b["value"] / total * 100 if total else 0.0,
                "pnl": round(b["value"] - b["invested"], 2),
                "pnl_pct": (b["value"] / b["invested"] - 1) * 100 if b["invested"] > 0 else 0.0,
            }
        )
    return sorted(out, key=lambda b: b["value"], reverse=True)


def allocation(book: Book, rows: list[dict]) -> dict:
    holdings_value = sum(r["value"] for r in rows)
    net_worth = holdings_value + max(book.cash, 0.0)

    asset_rows = rows
    if book.cash > 0:
        cash_row = {"asset_class": "Cash", "value": book.cash, "invested": book.cash, "day_pnl": 0.0}
        asset_rows = rows + [cash_row]
    weights = sorted((r["weight"] for r in rows), reverse=True)
    sectors = _group(rows, "sector", holdings_value)
    hhi = sum((w / 100) ** 2 for w in weights)
    return {
        "asset_classes": _group(asset_rows, "asset_class", net_worth),
        "sectors": sectors,
        "industries": _group(rows, "industry", holdings_value),
        "concentration": {
            "largest_holding": {"symbol": rows[0]["symbol"], "weight": rows[0]["weight"]} if rows else None,
            "top_3": sum(weights[:3]),
            "top_5": sum(weights[:5]),
            "top_10": sum(weights[:10]),
            "largest_sector": {"name": sectors[0]["name"], "weight": sectors[0]["weight"]} if sectors else None,
            "effective_holdings": 1 / hhi if hhi > 0 else 0.0,
            "hhi": hhi,
        },
    }


def contributions(rows: list[dict]) -> list[dict]:
    invested = sum(r["invested"] for r in rows)
    out = [
        {
            "symbol": r["symbol"],
            "name": r["name"],
            "pnl": r["pnl"],
            "pnl_pct": r["pnl_pct"],
            "contribution": r["pnl"] / invested * 100 if invested else 0.0,
            "day_pnl": r["day_pnl"],
            "weight": r["weight"],
        }
        for r in rows
    ]
    return sorted(out, key=lambda r: r["pnl"], reverse=True)


def sync_holdings(ctx: Ctx, portfolio_id: str) -> None:
    """Rewrite the cached `holdings` rows for a portfolio from its ledger."""
    book = load_book(ctx, portfolio_id)
    ctx.store.delete("holdings", {"portfolio_id": portfolio_id})
    rows = [
        {
            "portfolio_id": portfolio_id,
            "symbol": p.symbol,
            "quantity": round(p.quantity, 6),
            "avg_cost": round(p.avg_cost, 4),
            "invested": round(p.cost_basis, 2),
            "realized_pnl": round(p.realized_pnl, 2),
            "first_buy_date": p.first_buy.isoformat() if p.first_buy else None,
        }
        for p in book.open_positions
    ]
    if rows:
        ctx.store.upsert("holdings", rows, on_conflict="portfolio_id,symbol")


_snapshots: dict[str, tuple[str, float]] = {}


def record_snapshot(ctx: Ctx, book: Book, summary: dict) -> None:
    """Keep one valuation row per portfolio per day."""
    if book.id == ALL or not book.transactions:
        return
    today = today_ist().isoformat()
    last = _snapshots.get(f"{ctx.store.user_id}:{book.id}")
    if last and last[0] == today and abs(last[1] - summary["value"]) < max(1.0, summary["value"] * 0.001):
        return
    try:
        ctx.store.upsert(
            "portfolio_snapshots",
            [
                {
                    "portfolio_id": book.id,
                    "snapshot_date": today,
                    "total_value": summary["value"],
                    "invested": summary["invested"],
                    "cash": summary["cash"],
                    "unrealized_pnl": summary["unrealized_pnl"],
                    "realized_pnl": summary["realized_pnl"],
                }
            ],
            on_conflict="portfolio_id,snapshot_date",
        )
        _snapshots[f"{ctx.store.user_id}:{book.id}"] = (today, summary["value"])
    except HTTPException:
        pass  # a failed snapshot must never break a read


def price_frame(ctx: Ctx, book: Book) -> tuple[pd.DataFrame, pd.DatetimeIndex]:
    """Closing prices for the book's symbols plus its benchmark, and the
    trading calendar from the first transaction to the latest session."""
    first = pd.Timestamp(min(ledger.to_date(t["transaction_date"]) for t in book.adjusted))
    closes = ctx.market.closes(book.symbols + [book.benchmark]).ffill()
    index = closes.index[closes.index >= first]
    if len(index) == 0:
        index = pd.DatetimeIndex([first])
        closes = closes.reindex(closes.index.union(index)).ffill()
    return closes, index
