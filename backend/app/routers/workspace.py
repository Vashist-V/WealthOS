"""Watchlists, alerts, the investment journal and the corporate-actions calendar."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import AfterValidator, BaseModel, Field

from ..deps import get_ctx, ok
from ..market.universe import normalize
from ..services import book as books
from ..services.analytics import benchmark_name
from ..services.book import ALL, Ctx

router = APIRouter(prefix="/api", tags=["workspace"])
_calendar_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="calendar")

AlertType = Literal["price_above", "price_below", "pct_change", "earnings", "dividend"]


Symbol = Annotated[str, Field(min_length=1, max_length=24), AfterValidator(normalize)]


# ------------------------------------------------------------- watchlists
class WatchlistIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class WatchlistStockIn(BaseModel):
    symbol: Symbol
    note: str = Field(default="", max_length=240)


def _watch_row(ctx: Ctx, item: dict, quote: dict | None) -> dict:
    inst = ctx.market.instrument(item["symbol"])
    info = ctx.market.info(item["symbol"], wait=False) or {}
    row = {**item, "name": inst["name"], "sector": inst["sector"], "priced": quote is not None}
    if quote:
        span = quote["high_52w"] - quote["low_52w"]
        row.update(
            price=round(quote["price"], 2), change=round(quote["change"], 2), change_pct=quote["change_pct"],
            volume=quote["volume"], relative_volume=quote["volume"] / quote["avg_volume"] if quote["avg_volume"] else None,
            high_52w=quote["high_52w"], low_52w=quote["low_52w"],
            range_position=(quote["price"] - quote["low_52w"]) / span * 100 if span > 0 else None,
            dividend_yield=ctx.market.trailing_dividend(item["symbol"]) / quote["price"] * 100 if quote["price"] else None,
            spark=ctx.market.spark(item["symbol"], 30),
        )
    row.update(market_cap=info.get("market_cap"), pe=info.get("pe"), pb=info.get("pb"))
    return row


@router.get("/watchlists")
def list_watchlists(ctx: Ctx = Depends(get_ctx)):
    lists = ctx.store.list("watchlists", order="created_at.asc")
    items = ctx.store.list("watchlist_stocks", order="created_at.asc")
    quotes = ctx.market.quotes({i["symbol"] for i in items})
    return ok(
        [
            {**w, "stocks": [_watch_row(ctx, i, quotes.get(i["symbol"])) for i in items if i["watchlist_id"] == w["id"]]}
            for w in lists
        ]
    )


@router.post("/watchlists")
def create_watchlist(body: WatchlistIn, ctx: Ctx = Depends(get_ctx)):
    return ok({**ctx.store.insert("watchlists", {"name": body.name})[0], "stocks": []}, 201)


@router.patch("/watchlists/{watchlist_id}")
def rename_watchlist(watchlist_id: str, body: WatchlistIn, ctx: Ctx = Depends(get_ctx)):
    updated = ctx.store.update("watchlists", watchlist_id, {"name": body.name})
    if not updated:
        raise HTTPException(404, "Watchlist not found")
    return ok(updated)


@router.delete("/watchlists/{watchlist_id}")
def delete_watchlist(watchlist_id: str, ctx: Ctx = Depends(get_ctx)):
    ctx.store.delete("watchlist_stocks", {"watchlist_id": watchlist_id})
    if not ctx.store.delete("watchlists", {"id": watchlist_id}):
        raise HTTPException(404, "Watchlist not found")
    return ok({"deleted": True})


@router.post("/watchlists/{watchlist_id}/stocks")
def add_to_watchlist(watchlist_id: str, body: WatchlistStockIn, ctx: Ctx = Depends(get_ctx)):
    if not ctx.store.get("watchlists", watchlist_id):
        raise HTTPException(404, "Watchlist not found")
    if ctx.store.list("watchlist_stocks", {"watchlist_id": watchlist_id, "symbol": body.symbol}):
        raise HTTPException(409, f"{body.symbol} is already on this watchlist.")
    if not ctx.market.quote(body.symbol):
        raise HTTPException(422, f"No market data found for {body.symbol}.")
    row = ctx.store.insert("watchlist_stocks", {"watchlist_id": watchlist_id, "symbol": body.symbol, "note": body.note})[0]
    return ok(_watch_row(ctx, row, ctx.market.quote(body.symbol)), 201)


@router.delete("/watchlists/{watchlist_id}/stocks/{symbol}")
def remove_from_watchlist(watchlist_id: str, symbol: str, ctx: Ctx = Depends(get_ctx)):
    ctx.store.delete("watchlist_stocks", {"watchlist_id": watchlist_id, "symbol": normalize(symbol)})
    return ok({"deleted": True})


# ----------------------------------------------------------------- alerts
class AlertIn(BaseModel):
    symbol: Symbol
    alert_type: AlertType
    threshold: float = Field(gt=0)
    note: str = Field(default="", max_length=240)


class AlertPatch(BaseModel):
    is_active: bool | None = None
    threshold: float | None = Field(default=None, gt=0)
    note: str | None = Field(default=None, max_length=240)


def _days_until(iso: str | None) -> int | None:
    if not iso:
        return None
    return (date.fromisoformat(iso[:10]) - books.today_ist()).days


def _trigger_message(alert: dict, value: float) -> str:
    """What happened, in words, for an alert that fired at `value`."""
    symbol, kind, threshold = alert["symbol"], alert["alert_type"], float(alert["threshold"])
    if kind == "price_above":
        return f"{symbol} rose to ₹{value:,.2f}, at or above your ₹{threshold:,.2f} level"
    if kind == "price_below":
        return f"{symbol} fell to ₹{value:,.2f}, at or below your ₹{threshold:,.2f} level"
    if kind == "pct_change":
        return f"{symbol} moved {'+' if value > 0 else '−'}{abs(value):.2f}% in a day"
    days = int(value)
    when = "today" if days == 0 else f"in {days} day{'s' if days != 1 else ''}"
    return f"{symbol} {'results are expected' if kind == 'earnings' else 'goes ex-dividend'} {when}"


def _evaluate(ctx: Ctx, alert: dict, quote: dict | None) -> tuple[bool, float | None]:
    """(condition met right now, the value being watched) for one alert."""
    kind, threshold = alert["alert_type"], float(alert["threshold"])
    if kind in ("price_above", "price_below", "pct_change"):
        if not quote:
            return False, None
        if kind == "price_above":
            return quote["price"] >= threshold, quote["price"]
        if kind == "price_below":
            return quote["price"] <= threshold, quote["price"]
        return abs(quote["change_pct"]) >= threshold, quote["change_pct"]
    calendar = ctx.market.calendar(alert["symbol"], wait=False) or {}
    if kind == "earnings":
        days = min((d for d in (_days_until(x) for x in calendar.get("earnings_dates", [])) if d is not None and d >= 0), default=None)
    else:
        days = _days_until(calendar.get("ex_dividend_date"))
        days = days if days is not None and days >= 0 else None
    if days is None:
        return False, None
    return days <= threshold, float(days)


def _alert_rows(ctx: Ctx, evaluate: bool) -> tuple[list[dict], list[dict]]:
    alerts = ctx.store.list("alerts", order="created_at.desc")
    quotes = ctx.market.quotes({a["symbol"] for a in alerts})
    fired: list[dict] = []
    rows = []
    for a in alerts:
        quote = quotes.get(a["symbol"])
        hit, value = _evaluate(ctx, a, quote)
        if evaluate and a.get("is_active") and hit and value is not None:
            a = ctx.store.update(
                "alerts", a["id"],
                {"is_active": False, "triggered_at": datetime.now(timezone.utc).isoformat(), "last_value": value},
            ) or a
            fired.append({"id": a["id"], "symbol": a["symbol"], "message": _trigger_message(a, value)})
        # A fired alert keeps describing the moment it fired, from the value stored then.
        message = _trigger_message(a, float(a["last_value"])) if a.get("triggered_at") and a.get("last_value") is not None else ""
        rows.append(
            {
                **a,
                "name": ctx.market.instrument(a["symbol"])["name"],
                "price": round(quote["price"], 2) if quote else None,
                "change_pct": quote["change_pct"] if quote else None,
                "current_value": value,
                "message": message,
            }
        )
    return rows, fired


@router.get("/alerts")
def list_alerts(ctx: Ctx = Depends(get_ctx)):
    rows, _ = _alert_rows(ctx, evaluate=False)
    return ok(rows)


@router.post("/alerts/evaluate")
def evaluate_alerts(ctx: Ctx = Depends(get_ctx)):
    rows, fired = _alert_rows(ctx, evaluate=True)
    return ok({"alerts": rows, "fired": fired})


@router.post("/alerts")
def create_alert(body: AlertIn, ctx: Ctx = Depends(get_ctx)):
    if not ctx.market.quote(body.symbol):
        raise HTTPException(422, f"No market data found for {body.symbol}.")
    row = {**body.model_dump(), "is_active": True, "triggered_at": None, "last_value": None}
    return ok(ctx.store.insert("alerts", row)[0], 201)


@router.patch("/alerts/{alert_id}")
def update_alert(alert_id: str, body: AlertPatch, ctx: Ctx = Depends(get_ctx)):
    patch = body.model_dump(exclude_none=True)
    if patch.get("is_active"):
        patch["triggered_at"] = None  # re-arming clears the last trigger
    updated = ctx.store.update("alerts", alert_id, patch) if patch else None
    if not updated:
        raise HTTPException(404, "Alert not found")
    return ok(updated)


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: str, ctx: Ctx = Depends(get_ctx)):
    ctx.store.delete("alerts", {"id": alert_id})
    return ok({"deleted": True})


# ---------------------------------------------------------------- journal
class JournalIn(BaseModel):
    symbol: Symbol
    portfolio_id: str | None = None
    action: Literal["BUY", "SELL", "HOLD", "WATCH"] = "BUY"
    entry_price: float | None = Field(default=None, ge=0)
    entry_date: date
    horizon: str = Field(default="", max_length=60)
    thesis: str = Field(default="", max_length=4000)
    reasons: list[str] = Field(default_factory=list, max_length=12)
    exit_conditions: str = Field(default="", max_length=2000)
    conviction: int = Field(default=3, ge=1, le=5)
    tags: list[str] = Field(default_factory=list, max_length=12)
    status: Literal["open", "closed"] = "open"
    outcome_notes: str = Field(default="", max_length=4000)
    closed_at: date | None = None

    def row(self) -> dict:
        data = self.model_dump()
        data["portfolio_id"] = self.portfolio_id or None
        data["entry_date"] = self.entry_date.isoformat()
        data["closed_at"] = self.closed_at.isoformat() if self.closed_at else None
        data["reasons"] = [r.strip() for r in self.reasons if r.strip()]
        data["tags"] = [t.strip().lower() for t in self.tags if t.strip()]
        if self.status == "closed" and not data["closed_at"]:
            data["closed_at"] = books.today_ist().isoformat()
        if self.status == "open":
            data["closed_at"] = None
        return data


def _journal_row(ctx: Ctx, entry: dict, quotes: dict, bench: pd.Series, positions: dict) -> dict:
    quote = quotes.get(entry["symbol"])
    start = pd.Timestamp(str(entry["entry_date"])[:10])
    end = pd.Timestamp(str(entry["closed_at"])[:10]) if entry.get("closed_at") else None
    out = {
        **entry,
        "name": ctx.market.instrument(entry["symbol"])["name"],
        "current_price": round(quote["price"], 2) if quote else None,
        "days": ((end or pd.Timestamp(books.today_ist())) - start).days,
        "return_pct": None,
        "benchmark_return_pct": None,
        "benchmark_name": benchmark_name(ctx.settings.benchmark),
        "held": entry["symbol"] in positions,
    }
    df = ctx.market.bars([entry["symbol"]]).get(entry["symbol"])
    if df is not None and len(df):
        window = df["Close"][df.index >= start]
        if end is not None:
            window = window[window.index <= end]
        if len(window):
            # Entry prices are stored as traded; restate for any split since.
            factor = float(df["Splits"][(df.index > start) & (df["Splits"] > 0)].prod()) or 1.0
            base = float(entry["entry_price"]) / factor if entry.get("entry_price") else float(window.iloc[0])
            out["reference_price"] = round(base, 2)
            out["end_price"] = round(float(window.iloc[-1]), 2)
            out["return_pct"] = (float(window.iloc[-1]) / base - 1) * 100 if base else None
    b = bench[bench.index >= start]
    if end is not None:
        b = b[b.index <= end]
    if len(b) > 1:
        out["benchmark_return_pct"] = float(b.iloc[-1] / b.iloc[0] - 1) * 100
    return out


def _bench_series(ctx: Ctx) -> pd.Series:
    closes = ctx.market.closes([ctx.settings.benchmark])
    return closes[ctx.settings.benchmark].dropna() if not closes.empty else pd.Series(dtype=float)


@router.get("/journal")
def list_journal(ctx: Ctx = Depends(get_ctx)):
    entries = ctx.store.list("journal_entries", order="entry_date.desc")
    quotes = ctx.market.quotes({e["symbol"] for e in entries})
    positions = {s for s, p in books.load_book(ctx, ALL).positions.items() if p.is_open}
    bench = _bench_series(ctx)
    return ok([_journal_row(ctx, e, quotes, bench, positions) for e in entries])


@router.get("/journal/{entry_id}/review")
def review_journal(entry_id: str, ctx: Ctx = Depends(get_ctx)):
    """Price path since the entry, against the benchmark, to weigh the thesis."""
    entry = ctx.store.get("journal_entries", entry_id)
    if not entry:
        raise HTTPException(404, "Journal entry not found")
    start = pd.Timestamp(str(entry["entry_date"])[:10])
    closes = ctx.market.closes([entry["symbol"], ctx.settings.benchmark]).ffill()
    window = closes[closes.index >= start - pd.Timedelta(days=45)]
    symbol, bench = entry["symbol"], ctx.settings.benchmark
    if window.empty or symbol not in window:
        return ok({"dates": [], "price": [], "stock": [], "benchmark": [], "entry_date": str(entry["entry_date"])[:10]})
    since = window[window.index >= start]
    base = since.iloc[0] if len(since) else window.iloc[-1]
    # Measure the stock from the recorded entry price (restated for later
    # splits), the same reference the entry's return figure uses.
    reference = float(base[symbol])
    if entry.get("entry_price"):
        bars = ctx.market.bars([symbol]).get(symbol)
        factor = float(bars["Splits"][(bars.index > start) & (bars["Splits"] > 0)].prod()) or 1.0 if bars is not None else 1.0
        reference = float(entry["entry_price"]) / factor
    return ok(
        {
            "dates": [d.date().isoformat() for d in window.index],
            "price": [round(float(v), 2) if v == v else None for v in window[symbol]],
            "stock": [round(float(v / reference - 1) * 100, 2) if v == v else None for v in window[symbol]],
            "benchmark": [round(float(v / base[bench] - 1) * 100, 2) if v == v else None for v in window[bench]] if bench in window else [],
            "benchmark_name": benchmark_name(bench),
            "reference_price": round(reference, 2),
            "entry_date": str(entry["entry_date"])[:10],
            "closed_at": str(entry["closed_at"])[:10] if entry.get("closed_at") else None,
        }
    )


@router.post("/journal")
def create_journal(body: JournalIn, ctx: Ctx = Depends(get_ctx)):
    return ok(ctx.store.insert("journal_entries", body.row())[0], 201)


@router.patch("/journal/{entry_id}")
def update_journal(entry_id: str, body: JournalIn, ctx: Ctx = Depends(get_ctx)):
    updated = ctx.store.update("journal_entries", entry_id, body.row())
    if not updated:
        raise HTTPException(404, "Journal entry not found")
    return ok(updated)


@router.delete("/journal/{entry_id}")
def delete_journal(entry_id: str, ctx: Ctx = Depends(get_ctx)):
    ctx.store.delete("journal_entries", {"id": entry_id})
    return ok({"deleted": True})


# --------------------------------------------------------------- calendar
@router.get("/calendar")
def calendar(ctx: Ctx = Depends(get_ctx)):
    """Corporate actions for everything held or watched: the past year of
    dividends and splits, plus upcoming results and ex-dividend dates."""
    held: dict[str, float] = {}
    for p in ctx.store.list("portfolios"):
        for position in books.load_book(ctx, p["id"]).open_positions:
            held[position.symbol] = held.get(position.symbol, 0.0) + position.quantity
    watched = {i["symbol"] for i in ctx.store.list("watchlist_stocks")}
    symbols = sorted(set(held) | watched)
    today = pd.Timestamp(books.today_ist())
    since = today - timedelta(days=365)
    events: list[dict] = []

    def add(symbol: str, when: str, kind: str, title: str, detail: str = "", amount: float | None = None) -> None:
        events.append(
            {
                "symbol": symbol, "name": ctx.market.instrument(symbol)["name"], "date": when, "type": kind,
                "title": title, "detail": detail, "amount": amount,
                "source": "portfolio" if symbol in held else "watchlist",
                "upcoming": when >= today.date().isoformat(),
            }
        )

    ctx.market.bars(symbols)
    for symbol in symbols:
        for when, per_share in ctx.market.dividends(symbol):
            if when >= since:
                qty = held.get(symbol)
                add(symbol, when.date().isoformat(), "dividend", f"Dividend ₹{per_share:g} per share",
                    f"Ex-date. About ₹{per_share * qty:,.0f} on the current holding." if qty else "Ex-date.", per_share)
        for when, ratio in ctx.market.splits(symbol):
            if when >= since:
                add(symbol, when.date().isoformat(), "split", f"Split / bonus {ratio:g}:1",
                    f"Each share became {ratio:g}. Earlier transactions are restated automatically.")

    for symbol, cal in zip(symbols, _calendar_pool.map(lambda s: ctx.market.calendar(s), symbols)):
        for when in (cal or {}).get("earnings_dates", [])[:1]:
            if when >= today.date().isoformat():
                add(symbol, when, "results", "Quarterly results", "Expected earnings announcement date.")
        ex_div = (cal or {}).get("ex_dividend_date")
        if ex_div and ex_div > today.date().isoformat():
            add(symbol, ex_div, "dividend", "Upcoming ex-dividend date", "Shares must be held before this date to receive the dividend.")

    events.sort(key=lambda e: e["date"])
    return ok({"today": today.date().isoformat(), "symbols": len(symbols), "events": events})
