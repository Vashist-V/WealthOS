from __future__ import annotations

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from ..deps import get_ctx, ok
from ..market.provider import market_status
from ..market.universe import (
    BENCHMARKS,
    EQUITY_UNIVERSE,
    HEADLINE_INDICES,
    INDICES,
    INSTRUMENTS,
    SECTOR_INDICES,
    is_index,
    normalize,
)
from ..quant import risk
from ..quant.returns import annualized_volatility
from ..services import book as books, pulse
from ..services.book import ALL, Ctx

router = APIRouter(prefix="/api/market", tags=["market"])

PERIODS = {"1W": 5, "1M": 21, "3M": 63, "6M": 126, "1Y": 252, "3Y": 756, "5Y": 1260}
DAILY_RANGES = {"1M": 31, "3M": 92, "6M": 183, "1Y": 366, "3Y": 1096, "5Y": 1827}


def _change(close: pd.Series, sessions: int) -> float | None:
    if len(close) <= sessions:
        return None
    return float(close.iloc[-1] / close.iloc[-1 - sessions] - 1) * 100


def _ytd(close: pd.Series) -> float | None:
    prior = close[close.index.year < close.index[-1].year]
    return float(close.iloc[-1] / prior.iloc[-1] - 1) * 100 if len(prior) else None


def _stock_row(ctx: Ctx, symbol: str, quote: dict) -> dict:
    inst = INSTRUMENTS[symbol]
    return {
        "symbol": symbol,
        "name": inst.name,
        "sector": inst.sector,
        "price": round(quote["price"], 2),
        "change": round(quote["change"], 2),
        "change_pct": quote["change_pct"],
        "volume": quote["volume"],
        "traded_value": quote["volume"] * quote["price"],
        "relative_volume": quote["volume"] / quote["avg_volume"] if quote["avg_volume"] else None,
        "high_52w": quote["high_52w"],
        "low_52w": quote["low_52w"],
    }


@router.get("/overview")
def overview(ctx: Ctx = Depends(get_ctx)):
    bars = ctx.market.bars(list(INDICES) + EQUITY_UNIVERSE)
    quotes = {s: ctx.market._quote(s, df) for s, df in bars.items() if not df.empty}

    indices = []
    for symbol, (name, short) in INDICES.items():
        q, df = quotes.get(symbol), bars.get(symbol)
        if not q or df is None or len(df) < 30:  # a level with no history says nothing
            continue
        close = df["Close"]
        indices.append(
            {
                "symbol": symbol, "name": name, "short": short,
                "price": round(q["price"], 2), "change": round(q["change"], 2), "change_pct": q["change_pct"],
                "high_52w": q["high_52w"], "low_52w": q["low_52w"],
                "returns": {"1W": _change(close, 5), "1M": _change(close, 21), "3M": _change(close, 63),
                            "YTD": _ytd(close), "1Y": _change(close, 252)},
                "spark": [round(float(v), 2) for v in close.iloc[-60:]],
                "headline": symbol in HEADLINE_INDICES,
                "sector": symbol in SECTOR_INDICES,
            }
        )

    stocks = [_stock_row(ctx, s, quotes[s]) for s in EQUITY_UNIVERSE if s in quotes]
    latest = max((quotes[s]["as_of"] for s in EQUITY_UNIVERSE if s in quotes), default=None)
    live = [r for r in stocks if quotes[r["symbol"]]["as_of"] == latest]

    above_50 = above_200 = 0
    highs, lows = [], []
    for r in live:
        df = bars[r["symbol"]]
        close = df["Close"]
        if len(close) >= 50 and close.iloc[-1] > close.iloc[-50:].mean():
            above_50 += 1
        if len(close) >= 200 and close.iloc[-1] > close.iloc[-200:].mean():
            above_200 += 1
        if len(df) > 60:
            prior = df.iloc[-252:-1]
            if df["High"].iloc[-1] >= prior["High"].max():
                highs.append(r)
            elif df["Low"].iloc[-1] <= prior["Low"].min():
                lows.append(r)

    sectors: dict[str, dict] = {}
    for r in live:
        s = sectors.setdefault(r["sector"], {"name": r["sector"], "changes": [], "advances": 0, "declines": 0, "traded_value": 0.0})
        s["changes"].append(r["change_pct"])
        s["advances"] += r["change_pct"] > 0
        s["declines"] += r["change_pct"] < 0
        s["traded_value"] += r["traded_value"]
    sector_rows = sorted(
        (
            {"name": s["name"], "change_pct": float(np.mean(s["changes"])), "count": len(s["changes"]),
             "advances": s["advances"], "declines": s["declines"], "traded_value": s["traded_value"]}
            for s in sectors.values()
        ),
        key=lambda s: s["change_pct"],
        reverse=True,
    )

    turnover = sum(r["traded_value"] for r in live)
    avg_turnover = sum(quotes[r["symbol"]]["avg_volume"] * r["price"] for r in live)
    heat = []
    for r in live:
        cap = (ctx.market.info(r["symbol"], wait=False) or {}).get("market_cap")
        heat.append({"symbol": r["symbol"], "name": r["name"], "sector": r["sector"], "change_pct": r["change_pct"],
                     "size": cap or r["traded_value"] * 50})

    by_change = sorted(live, key=lambda r: r["change_pct"], reverse=True)
    return ok(
        {
            "status": market_status(),
            "as_of": latest,
            "indices": indices,
            "breadth": {
                "advances": sum(r["change_pct"] > 0 for r in live),
                "declines": sum(r["change_pct"] < 0 for r in live),
                "unchanged": sum(r["change_pct"] == 0 for r in live),
                "total": len(live),
                "above_50dma": above_50,
                "above_200dma": above_200,
                "new_highs": len(highs),
                "new_lows": len(lows),
            },
            "gainers": by_change[:8],
            "losers": by_change[::-1][:8],
            "most_active": sorted(live, key=lambda r: r["traded_value"], reverse=True)[:8],
            "volume_shockers": sorted((r for r in live if r["relative_volume"]), key=lambda r: r["relative_volume"], reverse=True)[:8],
            "new_highs": sorted(highs, key=lambda r: r["change_pct"], reverse=True)[:10],
            "new_lows": sorted(lows, key=lambda r: r["change_pct"])[:10],
            "sectors": sector_rows,
            "turnover": {"today": turnover, "average": avg_turnover,
                         "ratio": turnover / avg_turnover if avg_turnover else None},
            "heatmap": heat,
        }
    )


@router.get("/pulse")
def pulse_board(ctx: Ctx = Depends(get_ctx)):
    """Confidence scores for the market and for every sector, with the checks behind them and each sector's leaders."""
    return ok({**pulse.board(pulse.snapshot(ctx)), "status": market_status()})


@router.get("/universe")
def universe(ctx: Ctx = Depends(get_ctx)):
    quotes = ctx.market.quotes(list(INSTRUMENTS))
    rows = []
    for symbol, inst in INSTRUMENTS.items():
        q = quotes.get(symbol)
        if not q:
            continue
        info = ctx.market.info(symbol, wait=False) or {}
        rows.append(
            {
                **inst.as_dict(),
                "price": round(q["price"], 2), "change_pct": q["change_pct"], "volume": q["volume"],
                "high_52w": q["high_52w"], "low_52w": q["low_52w"],
                "market_cap": info.get("market_cap"), "pe": info.get("pe"), "pb": info.get("pb"),
                "dividend_yield": ctx.market.trailing_dividend(symbol) / q["price"] * 100 if q["price"] else None,
            }
        )
    return ok({"stocks": rows, "benchmarks": BENCHMARKS})


@router.get("/search")
def search(q: str = Query(min_length=1, max_length=40), ctx: Ctx = Depends(get_ctx)):
    results = ctx.market.search(q)
    known = ctx.market.quotes([r["symbol"] for r in results if r["symbol"] in INSTRUMENTS or r["symbol"] in INDICES])
    for r in results:
        quote = known.get(r["symbol"])
        r["price"] = round(quote["price"], 2) if quote else None
        r["change_pct"] = quote["change_pct"] if quote else None
    return ok(results)


@router.get("/quotes")
def quotes(symbols: str = Query(min_length=1), ctx: Ctx = Depends(get_ctx)):
    wanted = [normalize(s) for s in symbols.split(",") if s.strip()][:80]
    data = ctx.market.quotes(wanted)
    return ok({s: {**q, "name": ctx.market.instrument(s)["name"]} for s, q in data.items()})


@router.get("/stocks/{symbol}")
def stock(symbol: str, ctx: Ctx = Depends(get_ctx)):
    symbol = normalize(symbol)
    df = ctx.market.bars([symbol]).get(symbol)
    if df is None or df.empty:
        raise HTTPException(404, f"No market data found for {symbol}")
    quote = ctx.market._quote(symbol, df)
    info = {} if is_index(symbol) else ctx.market.info(symbol)
    inst = ctx.market.instrument(symbol)
    close = df["Close"]
    returns = {k: _change(close, n) for k, n in PERIODS.items()}
    returns["YTD"] = _ytd(close)

    year = close.iloc[-253:].pct_change(fill_method=None).dropna()
    bench = ctx.market.closes([ctx.settings.benchmark])
    bench_r = bench[ctx.settings.benchmark].pct_change(fill_method=None).dropna() if not bench.empty else pd.Series(dtype=float)
    beta, _ = risk.beta_alpha(year, bench_r, ctx.settings.risk_free_rate)
    trailing_dps = ctx.market.trailing_dividend(symbol)

    position = None
    if not is_index(symbol):
        book = books.load_book(ctx, ALL)
        held = book.positions.get(symbol)
        if held and held.is_open:
            value = held.quantity * quote["price"]
            position = {
                "quantity": round(held.quantity, 4), "avg_cost": round(held.avg_cost, 2), "invested": round(held.cost_basis, 2),
                "value": round(value, 2), "pnl": round(value - held.cost_basis, 2),
                "pnl_pct": (value / held.cost_basis - 1) * 100 if held.cost_basis else 0.0,
                "holding_days": round(held.holding_days(books.today_ist())),
            }
    return ok(
        {
            **inst,
            "is_index": is_index(symbol),
            "quote": quote,
            "about": {k: info.get(k) for k in ("summary", "website", "employees", "city", "exchange")},
            "fundamentals": {
                "market_cap": info.get("market_cap"), "pe": info.get("pe"), "forward_pe": info.get("forward_pe"),
                "pb": info.get("pb"), "eps": info.get("eps"), "book_value": info.get("book_value"),
                "roe": info.get("roe"), "roa": info.get("roa"), "debt_to_equity": info.get("debt_to_equity"),
                "profit_margin": info.get("profit_margin"), "operating_margin": info.get("operating_margin"),
                "revenue_growth": info.get("revenue_growth"), "earnings_growth": info.get("earnings_growth"),
                "dividend_yield": trailing_dps / quote["price"] if quote["price"] else None,
                "dividend_per_share": trailing_dps,
            },
            "technicals": {
                "sma_50": float(close.iloc[-50:].mean()) if len(close) >= 50 else None,
                "sma_200": float(close.iloc[-200:].mean()) if len(close) >= 200 else None,
                "volatility": annualized_volatility(year),
                "beta": beta,
                "from_high": (quote["price"] / quote["high_52w"] - 1) * 100 if quote["high_52w"] else None,
                "from_low": (quote["price"] / quote["low_52w"] - 1) * 100 if quote["low_52w"] else None,
            },
            "returns": returns,
            "position": position,
        }
    )


@router.get("/stocks/{symbol}/history")
def history(symbol: str, range: str = "1Y", ctx: Ctx = Depends(get_ctx)):
    symbol, key = normalize(symbol), range.upper()
    if key in ("1D", "5D"):
        rows = ctx.market.intraday(symbol, "1d" if key == "1D" else "5d", "5m" if key == "1D" else "15m")
        if rows:
            return ok({"symbol": symbol, "range": key, "intraday": True, "candles": rows})
        key = "1M"
    df = ctx.market.bars([symbol]).get(symbol)
    if df is None or df.empty:
        raise HTTPException(404, f"No market data found for {symbol}")
    end = df.index[-1]
    if key == "YTD":
        df = df[df.index >= pd.Timestamp(year=end.year, month=1, day=1) - pd.Timedelta(days=1)]
    elif key in DAILY_RANGES:
        df = df[df.index >= end - pd.Timedelta(days=DAILY_RANGES[key])]
    candles = [
        {"t": ts.date().isoformat(), "o": round(float(r.Open), 2), "h": round(float(r.High), 2), "l": round(float(r.Low), 2),
         "c": round(float(r.Close), 2), "v": float(r.Volume)}
        for ts, r in zip(df.index, df.itertuples())
    ]
    return ok({"symbol": symbol, "range": key, "intraday": False, "candles": candles})


@router.get("/stocks/{symbol}/financials")
def financials(symbol: str, ctx: Ctx = Depends(get_ctx)):
    return ok(ctx.market.financials(normalize(symbol)))


@router.get("/stocks/{symbol}/events")
def events(symbol: str, ctx: Ctx = Depends(get_ctx)):
    symbol = normalize(symbol)
    dividends = [{"date": d.date().isoformat(), "amount": round(v, 4)} for d, v in ctx.market.dividends(symbol)]
    by_year: dict[str, float] = {}
    for d in dividends:
        by_year[d["date"][:4]] = by_year.get(d["date"][:4], 0.0) + d["amount"]
    today = books.today_ist().isoformat()
    calendar = ctx.market.calendar(symbol)
    ex_dividend = calendar.get("ex_dividend_date")
    upcoming = {
        "earnings_dates": [d for d in calendar.get("earnings_dates", []) if d >= today],
        "ex_dividend_date": ex_dividend if ex_dividend and ex_dividend >= today else None,
    }
    return ok(
        {
            "dividends": dividends[::-1],
            "dividends_by_year": [{"year": y, "amount": round(a, 2)} for y, a in sorted(by_year.items())],
            "splits": [{"date": d.date().isoformat(), "ratio": v} for d, v in ctx.market.splits(symbol)][::-1],
            "upcoming": upcoming,
        }
    )
