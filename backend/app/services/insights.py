"""What a newcomer needs before any chart: how sound the portfolio is, why it
moved, and the few things worth knowing right now.

Everything here is arithmetic over figures the app already has. The health
score uses the trade check's method: a list of plain checks, each positive,
negative or neutral and each with a weight, added up to a number out of 100.
No model sets or adjusts it, and every yardstick is written into its check so
that anyone can see it and disagree.

The score describes how the portfolio is built and how it has behaved. It is
not a forecast and it says nothing about what to buy or sell.
"""
from __future__ import annotations

from datetime import date

from . import analytics, book as books
from .assistant import _day, _inr, _pct
from .book import Book, Ctx
from .tradecheck import _check, tally

# A holding that is one company. Funds and ETFs are already a spread of many, and gold and
# liquid funds are a different kind of thing, so none of those count as concentration.
COMPANY = "Equity"
FUNDS = "Funds & ETFs"


def _names(items: list[str]) -> str:
    """A list as it is said aloud: one name, two joined by "and", or several with commas and a final "and"."""
    if not items:
        return ""
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} and {items[-1]}"


# ------------------------------------------------------------------ health
def _spread(rows: list[dict], classes: list[dict]) -> list[dict]:
    companies = [r for r in rows if r["asset_class"] == COMPANY]
    in_funds = sum(r["weight"] for r in rows if r["asset_class"] == FUNDS)
    count = len(rows)
    learn = ("How many different investments the money is spread over. The more there are, the less any one of them can hurt. "
             "An index fund counts as one holding here although it owns many companies, so a portfolio that is mostly funds passes.")
    if in_funds >= 50:
        verdict, detail = "for", f"{in_funds:.0f}% is in funds, each of which holds many companies, so the money is widely spread."
    elif count >= 10:
        verdict, detail = "for", f"With {count} holdings, no single one decides how the portfolio does."
    elif count >= 5:
        verdict, detail = "neutral", f"{count} holdings is a fair spread. A few more, or an index fund, would make any one of them matter less."
    else:
        verdict, detail = "against", f"With only {count}, one bad result moves the whole portfolio."
    out = [_check("holdings", "Number of holdings", learn, verdict, f"{count} holding{'' if count == 1 else 's'}", detail, 2)]

    sectors = sorted({r["sector"] for r in companies})
    learn = ("How many different lines of business the companies are in. Companies in one sector tend to rise and fall together, "
             "so owning several sectors is a wider spread than owning several companies in one.")
    if not companies:
        out.append(_check("sectors", "Sectors", learn, "for", "All in funds", "Nothing is held as a single company, so no one sector dominates.", 1))
    else:
        verdict = "for" if len(sectors) >= 5 or in_funds >= 50 else "neutral" if len(sectors) >= 3 else "against"
        detail = (f"The companies you hold are spread over {len(sectors)} sectors." if verdict == "for"
                  else f"The companies you hold are in {len(sectors)} sector{'' if len(sectors) == 1 else 's'}: {_names(sectors)}. Trouble in one would reach much of the portfolio.")
        out.append(_check("sectors", "Sectors", learn, verdict, f"{len(sectors)} sector{'' if len(sectors) == 1 else 's'}", detail, 1))

    kinds = [c["name"] for c in classes if c["weight"] >= 5]
    learn = ("Whether everything is one kind of investment. Shares, gold, debt funds and cash do not all fall at the same time, "
             "so holding more than one kind softens a bad stretch for any single one.")
    if len(kinds) >= 2:
        out.append(_check("mix", "Kinds of investment", learn, "for", f"{len(kinds)} kinds", f"The money is in {_names(kinds).lower()}, which do not all move together.", 1))
    else:
        only = kinds[0].lower() if kinds else "one kind of investment"
        out.append(_check("mix", "Kinds of investment", learn, "neutral", "1 kind", f"Almost all of it is in {only}. That is common, but it means the whole portfolio follows one market.", 1))
    return out


def _concentration(rows: list[dict]) -> list[dict]:
    companies = sorted((r for r in rows if r["asset_class"] == COMPANY), key=lambda r: -r["weight"])
    learn_one = ("How much of the portfolio rides on its largest single company. WealthOS treats up to 15% as comfortable and over 25% as concentrated: "
                 "at 25%, a 20% fall in that one company takes 5% off everything you have. Funds are left out, because a fund is already a spread.")
    learn_three = ("How much rides on the three largest companies together. Up to 40% is comfortable here; over 60% means three companies decide most of the outcome.")
    learn_sector = ("How much is in the single largest sector, counting only the companies you hold directly. "
                    "Up to 30% is comfortable here; over 45% means one industry's fortunes decide most of the outcome.")
    if not companies:
        note = "Nothing is held as a single company, so there is no single-company risk to speak of."
        return [
            _check("largest", "Largest single company", learn_one, "for", "None", note, 3),
            _check("top3", "Three largest companies", learn_three, "for", "None", note, 2),
            _check("sector", "Largest sector", learn_sector, "for", "None", note, 2),
        ]
    top = companies[0]
    w = top["weight"]
    verdict = "for" if w <= 15 else "neutral" if w <= 25 else "against"
    hit = f"If {top['symbol']} fell 20%, the portfolio would lose about {w * 0.2:.1f}%."
    detail = (f"{top['name']} is the largest at {w:.1f}%, a comfortable size. {hit}" if verdict == "for"
              else f"{top['name']} is {w:.1f}% of the portfolio, a sizeable share. {hit}" if verdict == "neutral"
              else f"{top['name']} alone is {w:.1f}% of the portfolio. {hit}")
    out = [_check("largest", "Largest single company", learn_one, verdict, f"{top['symbol']} {w:.0f}%", detail, 3)]

    three = sum(r["weight"] for r in companies[:3])
    verdict = "for" if three <= 40 else "neutral" if three <= 60 else "against"
    names = _names([r["symbol"] for r in companies[:3]])
    detail = (f"{names} together are {three:.1f}%, so the rest of the portfolio still carries real weight." if verdict == "for"
              else f"{names} together are {three:.1f}% of the portfolio." if verdict == "neutral"
              else f"{names} together are {three:.1f}%: three companies decide most of how this portfolio does.")
    out.append(_check("top3", "Three largest companies", learn_three, verdict, f"{three:.0f}%", detail, 2))

    by_sector: dict[str, float] = {}
    for r in companies:
        by_sector[r["sector"]] = by_sector.get(r["sector"], 0.0) + r["weight"]
    name, share = max(by_sector.items(), key=lambda kv: kv[1])
    verdict = "for" if share <= 30 else "neutral" if share <= 45 else "against"
    detail = (f"{name} is the largest sector at {share:.1f}%, with plenty outside it." if verdict == "for"
              else f"{name} is {share:.1f}% of the portfolio." if verdict == "neutral"
              else f"{name} is {share:.1f}% of the portfolio, so a bad year for that one industry is a bad year for you.")
    out.append(_check("sector", "Largest sector", learn_sector, verdict, f"{name} {share:.0f}%", detail, 2))
    return out


def _risk(s: dict | None, bench: str) -> list[dict]:
    learn_swing = (f"How much the portfolio's value has swung from day to day over the past year, beside {bench}. "
                   "Up to 1.1 times the index counts as calm here; more than 1.5 times is a bumpy ride that is hard to sit through.")
    learn_fall = (f"The largest fall from a high point to the next low over the past year, for today's holdings, beside the same for {bench}. "
                  "It is the plainest measure of how bad a bad stretch has been.")
    if not s or not s.get("volatility") or not s.get("benchmark_volatility"):
        gap = "There is not yet a month of price history for these holdings."
        return [
            _check("swings", f"Swings against {bench}", learn_swing, "unknown", "No data", gap, 2),
            _check("fall", "Largest fall in a year", learn_fall, "unknown", "No data", gap, 2),
        ]
    ratio = s["volatility"] / s["benchmark_volatility"]
    verdict = "for" if ratio <= 1.1 else "neutral" if ratio <= 1.5 else "against"
    detail = (f"The portfolio has swung about as much as {bench}, or less: {ratio:.2f} times as much." if verdict == "for"
              else f"The portfolio has swung {ratio:.2f} times as much as {bench}: somewhat bumpier than the market." if verdict == "neutral"
              else f"The portfolio has swung {ratio:.2f} times as much as {bench}. Expect its bad days to be noticeably worse than the market's.")
    out = [_check("swings", f"Swings against {bench}", learn_swing, verdict, f"{ratio:.2f}× the index", detail, 2)]

    fall = abs((s.get("max_drawdown") or {}).get("value") or 0.0) * 100
    index_fall = abs(s.get("benchmark_max_drawdown") or 0.0) * 100
    verdict = "for" if fall <= index_fall + 2 else "neutral" if fall <= index_fall + 10 else "against"
    detail = (f"At their worst in the past year these holdings were down {fall:.1f}% from a high. {bench} was down {index_fall:.1f}% at its worst."
              + ("" if verdict == "for" else " The portfolio fell further than the market." if verdict == "neutral" else " That is much further than the market fell."))
    out.append(_check("fall", "Largest fall in a year", learn_fall, verdict, f"−{fall:.0f}% vs −{index_fall:.0f}%", detail, 2))
    return out


def _performance(stats: dict | None, bench: str) -> list[dict]:
    learn = (f"Your return over the past year beside {bench}'s, with your deposits and withdrawals taken out so the two are comparable. "
             "Within 2 points either way counts as level. One year is a short time: this is a description, not a verdict on your choices.")
    if not stats or stats.get("days", 0) < 60:
        return [_check("index", f"Against {bench}", learn, "unknown", "Too new", "There is not yet two months of history to compare with the index.", 2)]
    mine, index = stats["period_return"] * 100, stats["benchmark_return"] * 100
    gap = mine - index
    verdict = "for" if gap > 2 else "against" if gap < -2 else "neutral"
    span = "the past year" if stats["days"] >= 330 else f"the past {round(stats['days'] / 30)} months"
    detail = (f"Over {span} the portfolio returned {_pct(mine)} and {bench} {_pct(index)}: "
              + (f"{abs(gap):.1f} points ahead of the index." if verdict == "for" else f"{abs(gap):.1f} points behind the index." if verdict == "against" else "about level."))
    return [_check("index", f"Against {bench}", learn, verdict, f"{_pct(gap)[:-1]} pts", detail, 2)]


def _cash(summary: dict, kind: str) -> list[dict]:
    if kind == "paper":  # a practice account starts as all cash, by design
        return []
    learn = ("How much of the portfolio is cash you have recorded. A little gives you room to act without selling something; "
             "none at all, or more than a quarter left idle, are both worth a thought. WealthOS only knows about cash you have entered.")
    worth = summary["net_worth"]
    share = summary["cash"] / worth * 100 if worth > 0 else 0.0
    if share > 25:
        verdict, detail = "against", f"{share:.0f}% of this portfolio ({_inr(summary['cash'])}) is cash, earning little while it waits."
    elif share >= 2:
        verdict, detail = "for", f"{share:.0f}% is in cash ({_inr(summary['cash'])}): room to act without having to sell."
    else:
        verdict, detail = "neutral", "No cash is recorded for this portfolio. If you keep some elsewhere, that is fine; it just is not counted here."
    return [_check("cash", "Cash on hand", learn, verdict, f"{share:.0f}%", detail, 1)]


def score_label(value: int | None) -> tuple[str, str]:
    """The words and the colour that go with a health score."""
    if value is None:
        return "Too little history to score yet", "unknown"
    if value >= 75:
        return "In good shape", "for"
    if value >= 60:
        return "Mostly sound", "for"
    if value >= 45:
        return "Mixed: a few things to look at", "mixed"
    if value >= 30:
        return "Needs attention", "against"
    return "Several weak spots", "against"


def health(rows: list[dict], alloc: dict, summary: dict, risk_summary: dict | None, perf_stats: dict | None, kind: str, bench: str) -> dict:
    """The health score, the checks behind it by group, and one sentence that sums them up."""
    # `strength` is how a group reads in the summary sentence when it has nothing against it.
    groups = [
        {"id": "spread", "title": "Spread", "strength": "a wide spread", "checks": _spread(rows, alloc["asset_classes"])},
        {"id": "concentration", "title": "Concentration", "strength": "no outsized holding", "checks": _concentration(rows)},
        {"id": "risk", "title": "Risk", "strength": "a steady ride", "checks": _risk(risk_summary, bench)},
        {"id": "performance", "title": "Against the market", "strength": "keeping ahead of the index", "checks": _performance(perf_stats, bench)},
        {"id": "cash", "title": "Cash", "strength": "cash in hand", "checks": _cash(summary, kind)},
    ]
    groups = [g for g in groups if g["checks"]]
    checks = [c for g in groups for c in g["checks"]]
    counted = tally(checks)
    label, tone = score_label(counted["value"])

    strong = [g.pop("strength") for g in groups if any(c["verdict"] == "for" for c in g["checks"]) and not any(c["verdict"] == "against" for c in g["checks"])]
    for g in groups:
        g.pop("strength", None)
    weak = [c for c in sorted(checks, key=lambda c: -c["weight"]) if c["verdict"] == "against"]
    parts = []
    if strong:
        parts.append(f"Its strengths: {_names(strong)}.")
    if weak:
        parts.append(f"Most worth a look: {weak[0]['detail']}")
    elif counted["value"] is not None:
        parts.append("Nothing in how it is built stands out as a problem.")
    return {"score": {**counted, "label": label, "tone": tone}, "groups": groups, "summary": " ".join(parts)}


# ---------------------------------------------------------------- movement
def movement(rows: list[dict], summary: dict, betas: dict[str, float | None], index: dict | None, bench: str, today: date) -> dict:
    """Why the portfolio's value changed in the latest session: which holdings and sectors did it,
    and how much of it was simply the market moving."""
    as_of = summary.get("as_of")
    moved = sorted((r for r in rows if r["priced"] and abs(r["day_pnl"]) >= 0.005), key=lambda r: r["day_pnl"])
    total = summary["day_pnl"]
    falls = sum(r["day_pnl"] for r in moved if r["day_pnl"] < 0)
    gains = sum(r["day_pnl"] for r in moved if r["day_pnl"] > 0)
    down = total < 0
    # Each holding's part is measured against everything that moved the same way, so the parts of a fall add up to 100%.
    same_way = falls if down else gains

    holdings = [
        {
            "symbol": r["symbol"], "name": r["name"], "sector": r["sector"], "day_pnl": r["day_pnl"], "day_change_pct": r["day_change_pct"],
            "weight": r["weight"],
            "share": r["day_pnl"] / same_way * 100 if same_way and (r["day_pnl"] < 0) == down else None,
        }
        for r in (moved if down else reversed(moved))
    ]
    by_sector: dict[str, float] = {}
    for r in moved:
        by_sector[r["sector"]] = by_sector.get(r["sector"], 0.0) + r["day_pnl"]
    sectors = [
        {"name": name, "day_pnl": round(pnl, 2), "share": pnl / same_way * 100 if same_way and (pnl < 0) == down else None}
        for name, pnl in sorted(by_sector.items(), key=lambda kv: kv[1], reverse=not down)
    ]

    # How much of the move was the market: each holding's usual response to the index, times what the index did.
    market = None
    before = summary["value"] - total
    if index and before > 0 and rows:
        value = sum(r["value"] for r in rows) or 1.0
        beta = sum(r["value"] / value * (betas.get(r["symbol"]) if betas.get(r["symbol"]) is not None else 1.0) for r in rows)
        expected = before * beta * index["change_pct"] / 100
        own = total - expected
        change = index["change_pct"]
        if abs(change) < 0.05:
            words = f"{bench} was flat, so the move is down to your own holdings."
        else:
            words = (f"{bench} {'fell' if change < 0 else 'rose'} {_pct(abs(change), 2, signed=False)}. Holdings that follow the market the way yours usually do "
                     f"would be {'down' if expected < 0 else 'up'} about {_inr(abs(expected))} on that alone. "
                     + (f"Yours did {_inr(abs(own))} {'better' if own > 0 else 'worse'} than that." if abs(own) >= 1 else "Yours moved in line with it."))
        market = {"benchmark": bench, "change_pct": change, "beta": beta, "expected_pnl": round(expected, 2), "own_pnl": round(own, 2), "summary": words}

    when = "today" if as_of == today.isoformat() else f"on {_day(as_of)}" if as_of else "in the latest session"
    # `because` is the summary without its opening figure, for where the figure is already on screen.
    if not moved or abs(summary["day_pct"]) < 0.1:
        sentence = f"The portfolio barely moved {when}" + (f": {_inr(total)}." if abs(total) >= 1 else ".")
        because = "Barely a move: nothing you hold changed much in price."
    else:
        movers = [h for h in holdings if h["share"] is not None][:2]
        covered = sum(h["share"] for h in movers)
        verb, noun = ("fell", "falls") if down else ("rose", "gains")
        lead = f"The portfolio {verb} {_inr(abs(total))} ({_pct(abs(summary['day_pct']), 2, signed=False)}) {when}."
        if not movers:
            cause = ""
        elif len(movers) == 1 or covered >= 99.5:
            cause = f" {_names([m['name'] for m in movers])} account{'s' if len(movers) == 1 else ''} for nearly all of it."
        else:
            cause = f" {_names([m['name'] for m in movers])} account for {covered:.0f}% of the {noun}."
        other = gains if down else -falls
        offset = f" {'Gains' if down else 'Falls'} elsewhere took {_inr(other)} {'off the loss' if down else 'off the gain'}." if other >= 1 else ""
        sentence = lead + cause + offset
        because = (cause + offset).strip()
    return {
        "as_of": as_of, "is_today": as_of == today.isoformat(), "when": when,
        "day_pnl": total, "day_pct": summary["day_pct"], "summary": sentence, "cause": because,
        "holdings": holdings, "sectors": sectors, "market": market,
    }


# ------------------------------------------------------------------- brief
def brief(rows: list[dict], summary: dict, health_report: dict, move: dict, events: list[dict], kind: str, today: date) -> list[dict]:
    """The few things worth knowing right now, most pressing first. Each has a tone:
    "attention" for something to look at, "info" for something to be aware of, "good" for good news."""
    items: list[tuple[int, dict]] = []

    def add(rank: int, id: str, tone: str, title: str, detail: str, to: str) -> None:
        items.append((rank, {"id": id, "tone": tone, "title": title, "detail": detail, "to": to}))

    checks = {c["id"]: c for g in health_report["groups"] for c in g["checks"]}
    companies = sorted((r for r in rows if r["asset_class"] == COMPANY), key=lambda r: -r["weight"])
    for rank, id, to in ((1, "largest", "/allocation"), (3, "sector", "/allocation"), (5, "holdings", "/allocation")):
        check = checks.get(id)
        if check and check["verdict"] == "against":
            title = {"largest": f"{companies[0]['name']} is {companies[0]['weight']:.0f}% of your portfolio" if companies else check["title"],
                     "sector": f"{check['reading'].rsplit(' ', 1)[0]} is {check['reading'].rsplit(' ', 1)[-1]} of your portfolio",
                     "holdings": f"Everything rides on {check['reading']}"}[id]
            add(rank, id, "attention", title, check["detail"], to)

    if abs(move["day_pct"]) >= 1 and abs(move["day_pnl"]) >= 1:
        down = move["day_pnl"] < 0
        add(2 if down else 6, "move", "attention" if down else "good",
            f"Your portfolio {'fell' if down else 'rose'} {_pct(abs(move['day_pct']), 1, signed=False)} {move['when']}", move["cause"] or move["summary"], "#movement")

    for r in sorted(rows, key=lambda r: -abs(r["day_change_pct"] * r["weight"])):
        if r["priced"] and abs(r["day_change_pct"]) >= 4 and r["weight"] >= 2:
            fell = r["day_change_pct"] < 0
            add(4, f"mover-{r['symbol']}", "attention" if fell else "good",
                f"{r['name']} {'fell' if fell else 'rose'} {_pct(abs(r['day_change_pct']), 1, signed=False)} {move['when']}",
                f"It is {r['weight']:.0f}% of your portfolio, so that {'took' if fell else 'added'} {_inr(abs(r['day_pnl']))}.", f"/stock/{r['symbol']}")
            break

    def soon(day: str) -> str:
        days = (date.fromisoformat(day) - today).days
        return "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"

    for event, one, many, why in (
        ("results", "reports its results", "of your holdings report results this week", "Results often move a share sharply in either direction."),
        ("dividend", "goes ex-dividend", "of your holdings go ex-dividend this week", "To receive a dividend you must own the shares before its ex-dividend date."),
    ):
        due = sorted((e for e in events if e["type"] == event), key=lambda e: e["date"])
        if len(due) == 1:
            add(7, event, "info", f"{due[0]['name']} {one} {soon(due[0]['date'])}", f"{_day(due[0]['date'])}. {why}", "/calendar")
        elif due:
            dates = ", ".join(f"{e['name']} ({_day(e['date'])[:-5]})" for e in due[:4])
            add(7, event, "info", f"{len(due)} {many}", f"{dates}. {why}", "/calendar")

    index = checks.get("index")
    if index and index["verdict"] in ("for", "against"):
        ahead = index["verdict"] == "for"
        add(8, "index", "good" if ahead else "attention", f"You are {'ahead of' if ahead else 'behind'} the index over the past year", index["detail"], "#health")

    lows = [r["symbol"] for r in rows if r["asset_class"] == COMPANY and r["low_52w"] and r["price"] <= r["low_52w"] * 1.03]
    if lows:
        add(9, "lows", "info", f"{_names(lows[:3])} {'is' if len(lows) == 1 else 'are'} near a one-year low",
            "Within 3% of the lowest price of the past year. That can mean a bargain or a business in trouble; the price alone does not say which.", f"/stock/{lows[0]}")

    cash = checks.get("cash")
    if cash and cash["verdict"] == "against" and kind != "paper":
        add(10, "cash", "info", f"{cash['reading']} of this portfolio is sitting in cash", cash["detail"], "/allocation")

    items.sort(key=lambda pair: pair[0])
    out = [item for _, item in items][:4]
    if not out:
        out = [{"id": "quiet", "tone": "good", "title": "Nothing needs your attention right now",
                "detail": "No holding is outsized, nothing moved sharply and no results or dividend dates fall in the next week.", "to": "/"}]
    return out


# ------------------------------------------------------------------- build
def _events(ctx: Ctx, rows: list[dict], today: date) -> list[dict]:
    """Results and ex-dividend dates in the coming week, from what is already known. Nothing here waits on a lookup."""
    out = []
    for r in rows:
        if r["asset_class"] != COMPANY:
            continue
        calendar = ctx.market.calendar(r["symbol"], wait=False) or {}
        results = next((d for d in calendar.get("earnings_dates", []) if d >= today.isoformat()), None)
        for kind, when in (("results", results), ("dividend", calendar.get("ex_dividend_date"))):
            if when and 0 <= (date.fromisoformat(when[:10]) - today).days <= 7:
                out.append({"symbol": r["symbol"], "name": r["name"], "type": kind, "date": when[:10]})
    return out


def build(ctx: Ctx, book: Book) -> dict:
    """Health, the latest move and the brief for one portfolio (or all of them together)."""
    today = books.today_ist()
    view = analytics.overview(ctx, book)
    rows, summary, alloc = view["holdings"], view["summary"], view["allocation"]
    bench = analytics.benchmark_name(book.benchmark)
    if not rows:
        return {"empty": True, "as_of": None, "benchmark": bench}
    report = analytics.risk_report(ctx, book, "1Y")
    perf = analytics.performance(ctx, book, "1Y")
    risk_summary = None if report.get("empty") else report["summary"]
    betas = {} if report.get("empty") else {h["symbol"]: h["beta"] for h in report["holdings"]}
    index = ctx.market.quotes([book.benchmark]).get(book.benchmark)

    health_report = health(rows, alloc, summary, risk_summary, perf.get("stats"), book.kind, bench)
    move = movement(rows, summary, betas, index, bench, today)
    return {
        "empty": False,
        "as_of": summary["as_of"],
        "benchmark": bench,
        "health": health_report,
        "movement": move,
        "brief": brief(rows, summary, health_report, move, _events(ctx, rows, today), book.kind, today),
    }
