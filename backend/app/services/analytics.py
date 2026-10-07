"""Portfolio analytics built on a replayed `Book`."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..market.universe import BENCHMARKS, INDICES
from ..quant import ledger, risk
from ..quant.returns import (
    TRADING_DAYS,
    annualized_return,
    annualized_volatility,
    cumulative,
    drawdown_series,
    max_drawdown,
    time_weighted_returns,
)
from . import book as books
from .book import Book, Ctx

RANGES = {"1M": 30, "3M": 91, "6M": 182, "1Y": 365, "3Y": 1095, "5Y": 1826}
LOOKBACKS = {"6M": 126, "1Y": 252, "2Y": 504, "3Y": 756, "5Y": 1260}


def _day(iso: str | None) -> str:
    """'2026-01-29' -> '29 Jan 2026', for sentences shown to the user."""
    if not iso:
        return ""
    when = pd.Timestamp(iso)
    return f"{when.day} {when:%b %Y}"


def _signed(value: float, digits: int = 1) -> str:
    """Signed percentage with a typographic minus."""
    return f"{'−' if value < 0 else '+'}{abs(value):.{digits}f}%"


def benchmark_name(symbol: str) -> str:
    return BENCHMARKS.get(symbol) or INDICES.get(symbol, (symbol,))[0]


def _dates(index: pd.DatetimeIndex) -> list[str]:
    return [d.date().isoformat() for d in index]


def _pct(series: pd.Series) -> list[float]:
    return [round(float(v) * 100, 3) for v in series]


def _money(series: pd.Series) -> list[float]:
    return [round(float(v), 2) for v in series]


@dataclass
class History:
    index: pd.DatetimeIndex
    value: pd.Series  # market value of holdings
    equity: pd.Series  # value plus tracked cash (paper portfolios)
    invested: pd.Series
    returns: pd.Series  # daily, flow-adjusted
    benchmark: pd.Series  # daily benchmark returns
    net_flow: pd.Series
    realized: pd.Series


def history(ctx: Ctx, book: Book) -> History | None:
    """Daily value and flow-adjusted returns since the first transaction."""
    if not book.adjusted:
        return None
    closes, index = books.price_frame(ctx, book)
    timeline = ledger.build_timeline(book.adjusted, index)
    symbols = list(timeline.quantity.columns)
    prices = closes.reindex(columns=symbols).reindex(index).ffill().bfill()
    value = (timeline.quantity * prices).sum(axis=1)
    if book.kind == "paper":
        cash = book.initial_capital - timeline.inflow.cumsum() + timeline.outflow.cumsum() + timeline.dividends.cumsum()
        equity = value + cash
        returns = equity.pct_change()
        returns.iloc[0] = equity.iloc[0] / book.initial_capital - 1 if book.initial_capital > 0 else 0.0
        returns = returns.fillna(0.0)
    else:
        equity = value
        returns = time_weighted_returns(value, timeline.inflow, timeline.outflow)
    if book.benchmark in closes:
        bench = closes[book.benchmark].reindex(index).ffill().pct_change().fillna(0.0)
    else:
        bench = pd.Series(0.0, index=index)
    return History(index, value, equity, timeline.cost_basis, returns, bench, timeline.inflow - timeline.outflow, timeline.realized)


def performance(ctx: Ctx, book: Book, range_key: str = "ALL") -> dict:
    h = history(ctx, book)
    empty = {
        "range": range_key, "benchmark": benchmark_name(book.benchmark), "dates": [], "value": [], "invested": [],
        "portfolio_return": [], "benchmark_return": [], "drawdown": [], "monthly": [], "stats": None,
    }
    if h is None:
        return empty
    end = h.index[-1]
    if range_key == "YTD":
        start = pd.Timestamp(year=end.year, month=1, day=1)
    elif range_key in RANGES:
        start = end - pd.Timedelta(days=RANGES[range_key])
    else:
        start = h.index[0]
    mask = h.index >= start
    if mask.sum() < 2:
        mask = np.ones(len(h.index), dtype=bool)
    index = h.index[mask]
    returns, bench = h.returns[mask].copy(), h.benchmark[mask].copy()
    if index[0] != h.index[0]:  # rebase a mid-history window to zero
        returns.iloc[0] = 0.0
        bench.iloc[0] = 0.0
    else:
        bench.iloc[0] = 0.0
    cum_p, cum_b = cumulative(returns), cumulative(bench)
    value = h.equity[mask]
    days = (index[-1] - index[0]).days

    monthly_p = (1 + h.returns).groupby(h.index.to_period("M")).prod() - 1
    monthly_b = (1 + h.benchmark).groupby(h.index.to_period("M")).prod() - 1
    monthly = [
        {"month": str(period), "portfolio": round(float(monthly_p[period]) * 100, 2), "benchmark": round(float(monthly_b[period]) * 100, 2)}
        for period in monthly_p.index
    ]
    return {
        "range": range_key,
        "benchmark": benchmark_name(book.benchmark),
        "dates": _dates(index),
        "value": _money(value),
        "invested": _money(h.invested[mask] if book.kind != "paper" else pd.Series(book.initial_capital, index=index)),
        "portfolio_return": _pct(cum_p),
        "benchmark_return": _pct(cum_b),
        "drawdown": _pct(drawdown_series(returns)),
        "monthly": monthly,
        "stats": {
            "period_return": float(cum_p.iloc[-1]),
            "benchmark_return": float(cum_b.iloc[-1]),
            "excess_return": float(cum_p.iloc[-1] - cum_b.iloc[-1]),
            "cagr": annualized_return(returns) if days >= 365 else None,
            "benchmark_cagr": annualized_return(bench) if days >= 365 else None,
            "volatility": annualized_volatility(returns),
            "max_drawdown": max_drawdown(returns),
            "best_day": float(returns.max()),
            "worst_day": float(returns.min()),
            "value_change": round(float(value.iloc[-1] - value.iloc[0]), 2),
            "net_invested": round(float(h.net_flow[mask].iloc[1:].sum()), 2),
            "start_value": round(float(value.iloc[0]), 2),
            "end_value": round(float(value.iloc[-1]), 2),
            "days": days,
        },
    }


def lifetime_stats(ctx: Ctx, book: Book) -> dict:
    """Since-inception realised return statistics."""
    h = history(ctx, book)
    if h is None:
        return {"cagr": None, "total_return": None, "volatility": None, "max_drawdown": None, "sharpe": None, "beta": None}
    beta, _ = risk.beta_alpha(h.returns, h.benchmark, ctx.settings.risk_free_rate)
    days = (h.index[-1] - h.index[0]).days
    return {
        "cagr": annualized_return(h.returns) if days >= 365 else None,
        "total_return": float(cumulative(h.returns).iloc[-1]),
        "volatility": annualized_volatility(h.returns) if len(h.returns) > 20 else None,
        "max_drawdown": max_drawdown(h.returns)["value"],
        "sharpe": risk.sharpe(h.returns, ctx.settings.risk_free_rate) if len(h.returns) > 60 else None,
        "beta": beta,
        "days": days,
    }


def overview(ctx: Ctx, book: Book) -> dict:
    rows = books.holdings(ctx, book)
    summary = books.summarize(ctx, book, rows)
    stats = lifetime_stats(ctx, book)
    summary["cagr"] = stats["cagr"]
    summary["total_return"] = stats["total_return"]
    books.record_snapshot(ctx, book, summary)
    return {
        "portfolio": {"id": book.id, "name": book.name, "kind": book.kind, "benchmark": book.benchmark,
                      "benchmark_name": benchmark_name(book.benchmark)},
        "summary": summary,
        "holdings": rows,
        "allocation": books.allocation(book, rows),
        "contributions": books.contributions(rows),
    }


# ------------------------------------------------------------------- risk
def _holding_returns(ctx: Ctx, symbols: list[str], benchmark: str, lookback: str) -> tuple[pd.DataFrame, pd.Series]:
    window = LOOKBACKS.get(lookback, 252)
    closes = ctx.market.closes(symbols + [benchmark]).iloc[-(window + 1):]
    returns = closes.pct_change(fill_method=None).iloc[1:]
    bench = returns[benchmark].dropna() if benchmark in returns else pd.Series(dtype=float)
    return returns.reindex(columns=symbols), bench


def risk_report(ctx: Ctx, book: Book, lookback: str = "1Y") -> dict:
    """Risk of the *current* holdings, replayed over the lookback window."""
    rows = [r for r in books.holdings(ctx, book) if r["priced"] and r["value"] > 0]
    base = {"lookback": lookback, "benchmark": benchmark_name(book.benchmark), "risk_free_rate": ctx.settings.risk_free_rate}
    if not rows:
        return {**base, "empty": True}
    total = sum(r["value"] for r in rows)
    weights = pd.Series({r["symbol"]: r["value"] / total for r in rows})
    returns, bench = _holding_returns(ctx, list(weights.index), book.benchmark, lookback)
    portfolio = risk.weighted_returns(returns, weights)
    if len(portfolio) < 20:
        return {**base, "empty": True}
    bench = bench.reindex(portfolio.index).fillna(0.0)
    summary = risk.summarize(portfolio, bench, ctx.settings.risk_free_rate)
    contrib, variance, diversification = risk.risk_contributions(returns, weights)

    for level in ("var_95", "var_99"):
        summary[level] = {
            **summary[level],
            "historical_amount": round(summary[level]["historical"] * total, 2) if summary[level]["historical"] is not None else None,
            "cvar_amount": round(summary[level]["cvar"] * total, 2) if summary[level]["cvar"] is not None else None,
        }

    per_holding = []
    for r in rows:
        series = returns[r["symbol"]].dropna()
        beta, _ = risk.beta_alpha(series, bench, ctx.settings.risk_free_rate)
        per_holding.append(
            {
                "symbol": r["symbol"],
                "name": r["name"],
                "sector": r["sector"],
                "weight": r["weight"],
                "volatility": annualized_volatility(series),
                "beta": beta,
                "risk_contribution": float(contrib.get(r["symbol"], 0.0)) * 100,
                "period_return": float((1 + series).prod() - 1) if len(series) else None,
                "max_drawdown": max_drawdown(series)["value"] if len(series) else None,
            }
        )
    per_holding.sort(key=lambda r: r["risk_contribution"], reverse=True)

    top = [r["symbol"] for r in rows[:20]]
    rolling_p, rolling_b = risk.rolling_volatility(portfolio), risk.rolling_volatility(bench)
    return {
        **base,
        "empty": False,
        "value": round(total, 2),
        "summary": summary,
        "variance": {"annual": variance, "daily": variance / TRADING_DAYS, "diversification_ratio": float(diversification)},
        "holdings": per_holding,
        "correlation": risk.correlation(returns[top]),
        "series": {
            "dates": _dates(portfolio.index),
            "portfolio": _pct(cumulative(portfolio)),
            "benchmark": _pct(cumulative(bench)),
            "drawdown": _pct(drawdown_series(portfolio)),
            "benchmark_drawdown": _pct(drawdown_series(bench)),
        },
        "rolling_volatility": {
            "dates": _dates(rolling_p.index),
            "portfolio": _pct(rolling_p),
            "benchmark": _pct(rolling_b.reindex(rolling_p.index).ffill().fillna(0.0)),
        },
        "histogram": risk.histogram(portfolio),
    }


def portfolio_parameters(ctx: Ctx, book: Book, lookback: str = "3Y") -> dict:
    """Expected return, volatility and monthly return history of the current
    holdings: the default assumptions for simulations."""
    rows = [r for r in books.holdings(ctx, book) if r["priced"] and r["value"] > 0]
    if not rows:
        return {"value": 0.0, "expected_return": None, "volatility": None, "monthly_returns": [], "betas": {}, "rows": []}
    total = sum(r["value"] for r in rows)
    weights = pd.Series({r["symbol"]: r["value"] / total for r in rows})
    returns, bench = _holding_returns(ctx, list(weights.index), book.benchmark, lookback)
    portfolio = risk.weighted_returns(returns, weights)
    monthly = (1 + portfolio).groupby(portfolio.index.to_period("M")).prod() - 1
    betas = {}
    for symbol in weights.index:
        beta, _ = risk.beta_alpha(returns[symbol].dropna(), bench, ctx.settings.risk_free_rate)
        betas[symbol] = beta if beta is not None else 1.0
    return {
        "value": round(total, 2),
        "expected_return": float(portfolio.mean() * TRADING_DAYS) if len(portfolio) else None,
        "volatility": annualized_volatility(portfolio),
        "monthly_returns": [float(v) for v in monthly.iloc[1:-1]] if len(monthly) > 3 else [float(v) for v in monthly],
        "betas": betas,
        "rows": rows,
    }


# -------------------------------------------------------------- dividends
def dividend_report(ctx: Ctx, book: Book) -> dict:
    """Dividend income implied by the shares held on each ex-date."""
    rows = {r["symbol"]: r for r in books.holdings(ctx, book)}
    events: list[dict] = []
    trades: dict[str, list[tuple[pd.Timestamp, float]]] = {}
    for t in book.adjusted:
        if t["transaction_type"] == "DIVIDEND":
            continue
        signed = t["quantity"] if t["transaction_type"] == "BUY" else -t["quantity"]
        trades.setdefault(t["symbol"], []).append((pd.Timestamp(ledger.to_date(t["transaction_date"])), signed))

    for symbol, legs in trades.items():
        name = ctx.market.instrument(symbol)["name"]
        for ex_date, per_share in ctx.market.dividends(symbol):
            held = sum(q for d, q in legs if d < ex_date)
            if held > 1e-9:
                events.append(
                    {
                        "symbol": symbol,
                        "name": name,
                        "ex_date": ex_date.date().isoformat(),
                        "per_share": round(per_share, 4),
                        "quantity": round(held, 4),
                        "amount": round(held * per_share, 2),
                    }
                )
    events.sort(key=lambda e: e["ex_date"], reverse=True)

    by_year: dict[str, float] = {}
    by_month: dict[str, float] = {}
    by_symbol: dict[str, float] = {}
    for e in events:
        by_year[e["ex_date"][:4]] = by_year.get(e["ex_date"][:4], 0.0) + e["amount"]
        by_month[e["ex_date"][:7]] = by_month.get(e["ex_date"][:7], 0.0) + e["amount"]
        by_symbol[e["symbol"]] = by_symbol.get(e["symbol"], 0.0) + e["amount"]

    cutoff = (pd.Timestamp(books.today_ist()) - pd.Timedelta(days=365)).date().isoformat()
    trailing = sum(e["amount"] for e in events if e["ex_date"] >= cutoff)
    companies = []
    forward_total = 0.0
    for symbol in sorted(set(by_symbol) | set(rows)):
        row = rows.get(symbol)
        dps = ctx.market.trailing_dividend(symbol)
        forward = dps * row["quantity"] if row else 0.0
        forward_total += forward
        if not by_symbol.get(symbol) and not forward:
            continue
        companies.append(
            {
                "symbol": symbol,
                "name": row["name"] if row else ctx.market.instrument(symbol)["name"],
                "received": round(by_symbol.get(symbol, 0.0), 2),
                "trailing_dps": round(dps, 2),
                "forward_income": round(forward, 2),
                "yield": row["dividend_yield"] if row else None,
                "yield_on_cost": forward / row["invested"] * 100 if row and row["invested"] > 0 else None,
                "held": row is not None,
            }
        )
    companies.sort(key=lambda c: c["received"], reverse=True)
    value = sum(r["value"] for r in rows.values())
    invested = sum(r["invested"] for r in rows.values())
    return {
        "total": round(sum(by_symbol.values()), 2),
        "trailing_12m": round(trailing, 2),
        "forward_income": round(forward_total, 2),
        "portfolio_yield": forward_total / value * 100 if value else 0.0,
        "yield_on_cost": forward_total / invested * 100 if invested else 0.0,
        "recorded": round(sum(p.dividends for p in book.positions.values()), 2),
        "by_year": [{"year": y, "amount": round(a, 2)} for y, a in sorted(by_year.items())],
        "by_month": [{"month": m, "amount": round(a, 2)} for m, a in sorted(by_month.items())],
        "companies": companies,
        "events": events,
    }


# ------------------------------------------------------------------ x-ray
def xray(ctx: Ctx, book: Book) -> dict:
    view = overview(ctx, book)
    report = risk_report(ctx, book, "1Y")
    dividends = dividend_report(ctx, book)
    summary, alloc, rows = view["summary"], view["allocation"], view["holdings"]
    conc = alloc["concentration"]
    bench = benchmark_name(book.benchmark)
    facts: list[dict] = []

    def add(category: str, title: str, detail: str) -> None:
        facts.append({"category": category, "title": title, "detail": detail})

    if rows:
        top = conc["largest_holding"]
        add("Concentration", f"{top['symbol']} is the largest holding at {top['weight']:.1f}%",
            f"The top three holdings account for {conc['top_3']:.1f}% of invested value and the top five for {conc['top_5']:.1f}%.")
        add("Concentration", f"{len(rows)} holdings behave like {conc['effective_holdings']:.1f} equal positions",
            "Effective number of holdings is the inverse of the Herfindahl index of position weights.")
        sector = conc["largest_sector"]
        add("Sectors", f"{sector['name']} is the largest sector at {sector['weight']:.1f}%",
            f"The portfolio spans {len(alloc['sectors'])} sectors; the smallest is {alloc['sectors'][-1]['name']} at {alloc['sectors'][-1]['weight']:.1f}%.")
        winners = [r for r in rows if r["pnl"] > 0]
        add("Performance", f"{len(winners)} of {len(rows)} holdings are above their average cost",
            f"Best: {max(rows, key=lambda r: r['pnl_pct'])['symbol']} ({_signed(max(r['pnl_pct'] for r in rows))}). "
            f"Weakest: {min(rows, key=lambda r: r['pnl_pct'])['symbol']} ({_signed(min(r['pnl_pct'] for r in rows))}).")
        stocks = [r for r in rows if r["asset_class"] != "Cash"]
        near_high = [r["symbol"] for r in stocks if r["high_52w"] and r["price"] >= r["high_52w"] * 0.95]
        near_low = [r["symbol"] for r in stocks if r["low_52w"] and r["price"] <= r["low_52w"] * 1.05]
        if near_high or near_low:
            add("Price levels", f"{len(near_high)} holdings within 5% of a 52-week high, {len(near_low)} within 5% of a low",
                " · ".join(filter(None, [f"Near highs: {', '.join(near_high)}" if near_high else "",
                                         f"Near lows: {', '.join(near_low)}" if near_low else ""])))
    if not report.get("empty"):
        s = report["summary"]
        if s["volatility"] and s["benchmark_volatility"]:
            ratio = s["volatility"] / s["benchmark_volatility"]
            add("Risk", f"Volatility of {s['volatility'] * 100:.1f}% is {ratio:.2f}× that of {bench}",
                f"{bench} volatility over the same year was {s['benchmark_volatility'] * 100:.1f}%.")
        if s["beta"] is not None:
            add("Risk", f"Historical beta to {bench} is {s['beta']:.2f}",
                f"On average the current holdings moved {abs(s['beta']):.2f}% for each 1% move in {bench}.")
        dd = s["max_drawdown"]
        if dd["peak"]:
            add("Risk", f"Largest fall in the past year was {abs(dd['value']) * 100:.1f}%",
                f"From {_day(dd['peak'])} to {_day(dd['trough'])}"
                + (f", recovered by {_day(dd['recovered'])}." if dd["recovered"] else ", not yet recovered."))
        corr = report["correlation"]
        if corr["average"] is not None and corr["highest"]:
            hi = corr["highest"][0]
            add("Diversification", f"Average pairwise correlation is {corr['average']:.2f}",
                f"Most correlated pair: {hi['a']} and {hi['b']} ({hi['value']:.2f}).")
        heavy = report["holdings"][0]
        add("Diversification", f"{heavy['symbol']} contributes {heavy['risk_contribution']:.1f}% of portfolio risk",
            f"Its weight is {heavy['weight']:.1f}%. Risk share above weight means the position is more volatile or more correlated than the rest.")
    if dividends["forward_income"]:
        add("Income", f"Trailing dividend yield is {dividends['portfolio_yield']:.2f}%",
            f"At the last twelve months' payout rates the current holdings distribute about ₹{dividends['forward_income']:,.0f} a year.")

    s = report.get("summary") or {}
    return {
        "portfolio": view["portfolio"],
        "summary": summary,
        "allocation": alloc,
        "holdings": rows,
        "metrics": {
            "value": summary["value"],
            "largest_holding": conc["largest_holding"],
            "top_3": conc["top_3"],
            "largest_sector": conc["largest_sector"],
            "effective_holdings": conc["effective_holdings"],
            "volatility": s.get("volatility"),
            "benchmark_volatility": s.get("benchmark_volatility"),
            "max_drawdown": (s.get("max_drawdown") or {}).get("value"),
            "beta": s.get("beta"),
            "sharpe": s.get("sharpe"),
            "dividend_yield": dividends["portfolio_yield"],
            "average_correlation": (report.get("correlation") or {}).get("average"),
            "var_95": (s.get("var_95") or {}).get("historical"),
            "xirr": summary["xirr"],
        },
        "observations": facts,
    }


# ---------------------------------------------------------------- compare
def compare(ctx: Ctx, portfolio_ids: list[str]) -> dict:
    items = []
    series: dict[str, pd.Series] = {}
    for pid in portfolio_ids:
        book = books.load_book(ctx, pid)
        rows = books.holdings(ctx, book)
        summary = books.summarize(ctx, book, rows)
        h = history(ctx, book)
        stats = lifetime_stats(ctx, book)
        if h is not None:
            series[pid] = h.returns
        total = sum(r["value"] for r in rows)
        sectors: dict[str, float] = {}
        for r in rows:
            sectors[r["sector"]] = sectors.get(r["sector"], 0.0) + (r["value"] / total * 100 if total else 0.0)
        items.append(
            {
                "id": pid,
                "name": book.name,
                "kind": book.kind,
                "value": summary["net_worth"] if book.kind == "paper" else summary["value"],
                "invested": summary["invested"],
                "unrealized_pct": summary["unrealized_pct"],
                "xirr": summary["xirr"],
                "holdings_count": summary["holdings_count"],
                "since": summary["first_investment"],
                **stats,
                "sectors": sectors,
            }
        )

    chart = {"dates": [], "series": []}
    if series:
        start = max(s.index[0] for s in series.values())
        index = sorted(set().union(*[set(s.index[s.index >= start]) for s in series.values()]))
        index = pd.DatetimeIndex(index)
        chart["dates"] = _dates(index)
        for item in items:
            s = series.get(item["id"])
            if s is None:
                continue
            window = s[s.index >= start].copy()
            if len(window):
                window.iloc[0] = 0.0
            chart["series"].append({"id": item["id"], "name": item["name"],
                                    "values": _pct(cumulative(window).reindex(index).ffill().fillna(0.0))})
            item["window_return"] = float(cumulative(window).iloc[-1]) if len(window) else None
        chart["since"] = start.date().isoformat()
    return {"portfolios": items, "chart": chart, "sectors": sorted({s for i in items for s in i["sectors"]})}
