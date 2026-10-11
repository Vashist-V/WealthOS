"""A company in the questions a newcomer asks of it, and companies side by side.

Both read the market pulse: the same checks, with the same verdicts, that score
a company on the Market page and in a trade check. Nothing here adds a
yardstick or changes one. It groups the checks under plain questions, adds the
dividend as a note, and lays companies next to each other.

A card says where a company stands today on each question. It does not say
whether to buy it: that depends on the price paid, on what else is held and on
what the money is for, which is what Trade check is there to look at.
"""
from __future__ import annotations

from datetime import datetime, timezone

from . import pulse, tradecheck
from .assistant import _inr, _pct
from .book import Ctx
from .tradecheck import SCORED, _check

# The questions, in the order a newcomer would ask them, and the checks that answer each.
AREAS = (
    ("quality", "Does the business earn well?", "Business quality", ("profitability",)),
    ("growth", "Is it growing?", "Growth", ("growth", "profit_trend")),
    ("debt", "Does it owe too much?", "Borrowings", ("debt",)),
    ("valuation", "Is the price reasonable?", "Valuation", ("pe_sector", "earnings_ahead")),
    ("income", "Does it pay you while you wait?", "Dividend", ("dividend",)),
    ("risk", "How bumpy is the ride?", "Price swings", ("volatility", "drawdown")),
    ("trend", "Which way is the price heading?", "Price trend", None),  # every check in the trend group
)
MAX_COMPARED = 4


def _verdict(checks: list[dict]) -> str:
    """How an area reads as a whole: the balance of its scored checks, by weight."""
    scored = [c for c in checks if c["verdict"] in SCORED]
    if not scored:
        return "info" if any(c["verdict"] == "info" for c in checks) else "unknown"
    net = sum(c["weight"] * {"for": 1, "against": -1, "neutral": 0}[c["verdict"]] for c in scored)
    return "for" if net > 0 else "against" if net < 0 else "neutral"


def _dividend(name: str, per_share: float, price: float) -> dict:
    learn = ("Dividend yield: the dividends paid on one share over the past year, as a share of today's price. "
             "A dividend is cash in hand, but a company that pays none may simply be putting its profit back into growing. It is a note here, not scored.")
    if per_share <= 0 or price <= 0:
        return _check("dividend", "Dividend", learn, "info", "None in a year", f"{name} paid no dividend over the past year.")
    rate = per_share / price * 100
    return _check("dividend", "Dividend", learn, "info", f"{rate:.1f}% a year",
                  f"{name} paid {_inr(per_share, 2)} a share over the past year, {_pct(rate, 1, signed=False)} of today's price.")


def _profit_history(ctx: Ctx, symbol: str) -> dict:
    """Yearly net profit in crore, from statements already held. Looking them up is left to the stock page."""
    income = (ctx.market.financials(symbol, wait=False).get("income") or {}).get("annual") or {"periods": [], "rows": []}
    rows = {r["key"]: [v / 1e7 if v is not None else None for v in r["values"]] for r in income["rows"] if r["key"] == "net_income"}
    return {"periods": income["periods"], **rows}


def card(ctx: Ctx, symbol: str, snapshot: dict | None = None) -> dict:
    """One company's decision card. `available` is false for anything that is not a tracked company."""
    snapshot = snapshot or pulse.snapshot(ctx)
    company = snapshot["companies"].get(symbol)
    if company is None:
        return {"available": False, "symbol": symbol}
    groups = company["groups"]
    found = {c["id"]: c for group in groups.values() for c in group}
    found["dividend"] = _dividend(company["name"], ctx.market.trailing_dividend(symbol), company["price"])
    trend = tradecheck.profit_trend(_profit_history(ctx, symbol), "BUY")
    if trend["verdict"] != "unknown":  # the pulse leaves it out; add it where the statements are to hand
        found["profit_trend"] = trend

    areas = []
    for id, question, title, ids in AREAS:
        checks = groups["trend"] if ids is None else [found[i] for i in ids if i in found]
        if not checks:
            continue
        lead = next((c for c in checks if c["verdict"] in SCORED), checks[0])
        areas.append({
            "id": id, "question": question, "title": title, "verdict": _verdict(checks), "reading": lead["reading"],
            "summary": " ".join(c["detail"] for c in checks if c["verdict"] != "unknown")[:600] or lead["detail"],
            "checks": checks,
        })

    info = ctx.market.info(symbol, wait=False)
    fetched = ctx.market.fact_time("info", symbol)
    return {
        "available": True,
        "symbol": symbol,
        "name": company["name"],
        "sector": company["sector"],
        "price": company["price"],
        "change_pct": company["change_pct"],
        "as_of": snapshot["as_of"],
        # When the company's own figures were last read from the source; prices are newer.
        "figures_as_of": datetime.fromtimestamp(fetched, timezone.utc).date().isoformat() if fetched else None,
        "score": company["score"],
        "areas": areas,
        "figures": {
            "market_cap": company["market_cap"], "pe": company["pe"], "roe": company["roe"],
            "revenue_growth": company["revenue_growth"], "earnings_growth": company["earnings_growth"],
            "debt_to_equity": info.get("debt_to_equity"), "profit_margin": info.get("profit_margin"),
            "dividend_yield": ctx.market.trailing_dividend(symbol) / company["price"] if company["price"] else None,
            "volatility": company["volatility"], "return_1y": company["returns"].get("1 year"), "from_high": company["from_high"],
        },
        # Others in the same line of business, strongest long-term score first: natural companies to set it beside.
        "peers": [
            {"symbol": c["symbol"], "name": c["name"], "score": c["score"]["long"]["value"], "tone": c["score"]["long"]["tone"]}
            for c in sorted(
                (c for c in snapshot["companies"].values() if c["sector"] == company["sector"] and c["symbol"] != symbol and c["score"]["long"]["value"] is not None),
                key=lambda c: -c["score"]["long"]["value"],
            )[:4]
        ],
    }


def compare(ctx: Ctx, symbols: list[str]) -> dict:
    """Up to four companies, each as its decision card, in the order asked for. Anything untracked is named as skipped."""
    snapshot = pulse.snapshot(ctx)
    seen: list[str] = []
    for s in symbols:
        if s not in seen:
            seen.append(s)
    cards = [card(ctx, s, snapshot) for s in seen[:MAX_COMPARED]]
    return {
        "areas": [{"id": id, "question": question, "title": title} for id, question, title, _ in AREAS],
        "companies": [c for c in cards if c["available"]],
        "skipped": [c["symbol"] for c in cards if not c["available"]],
        "as_of": snapshot["as_of"],
    }
