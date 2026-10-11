"""The health score, the day's movement and the brief, from hand-built holdings: no market data is fetched."""
from datetime import date

from app.services import insights

TODAY = date(2026, 10, 9)


def holding(symbol, weight, *, sector="IT", asset_class="Equity", day_pct=0.0, value=None, name=None):
    value = weight * 1000 if value is None else value
    return {
        "symbol": symbol, "name": name or symbol.title(), "sector": sector, "asset_class": asset_class, "weight": weight, "value": value,
        "priced": True, "day_change_pct": day_pct, "day_pnl": value * day_pct / 100, "price": 100.0, "low_52w": 60.0,
    }


def summary(rows, cash=0.0):
    value = sum(r["value"] for r in rows)
    pnl = sum(r["day_pnl"] for r in rows)
    return {"value": value, "net_worth": value + cash, "cash": cash, "day_pnl": pnl, "day_pct": pnl / (value - pnl) * 100 if value != pnl else 0.0, "as_of": TODAY.isoformat()}


def classes(rows):
    names = sorted({r["asset_class"] for r in rows})
    return {"asset_classes": [{"name": n, "weight": sum(r["weight"] for r in rows if r["asset_class"] == n)} for n in names]}


SPREAD = [holding(f"S{i}", 10, sector=f"Sector {i % 5}") for i in range(10)]
LOPSIDED = [holding("BIG", 60, sector="Consumer"), holding("MID", 30, sector="Consumer"), holding("SMALL", 10, sector="IT")]
STEADY = {"volatility": 0.12, "benchmark_volatility": 0.14, "max_drawdown": {"value": -0.10}, "benchmark_max_drawdown": -0.12}
AHEAD = {"days": 365, "period_return": 0.14, "benchmark_return": 0.08}


def checks(report):
    return {c["id"]: c for g in report["groups"] for c in g["checks"]}


def test_a_wide_steady_portfolio_scores_high_and_says_why():
    report = insights.health(SPREAD, classes(SPREAD), summary(SPREAD, cash=500), STEADY, AHEAD, "investment", "NIFTY 50")
    assert report["score"]["value"] >= 75 and report["score"]["tone"] == "for"
    assert report["score"]["against"] == 0
    assert "Nothing in how it is built stands out" in report["summary"]


def test_one_outsized_company_is_what_the_summary_names():
    report = insights.health(LOPSIDED, classes(LOPSIDED), summary(LOPSIDED), STEADY, AHEAD, "investment", "NIFTY 50")
    found = checks(report)
    assert found["largest"]["verdict"] == "against" and found["holdings"]["verdict"] == "against" and found["sector"]["verdict"] == "against"
    assert report["score"]["value"] < 50
    # The heaviest failing check leads the summary, with the arithmetic of what a fall would cost.
    assert "Big alone is 60.0% of the portfolio" in report["summary"] and "12.0%" in report["summary"]


def test_funds_are_a_spread_not_a_concentration():
    rows = [holding("NIFTYBEES", 70, asset_class="Funds & ETFs", sector="Index Funds"), holding("TCS", 30)]
    found = checks(insights.health(rows, classes(rows), summary(rows), STEADY, AHEAD, "investment", "NIFTY 50"))
    assert found["holdings"]["verdict"] == "for"  # two holdings, but most of it is a fund of many companies
    assert found["largest"]["reading"].startswith("TCS")  # the fund is not the "largest single company"


def test_no_price_history_leaves_risk_unscored_rather_than_guessed():
    report = insights.health(SPREAD, classes(SPREAD), summary(SPREAD), None, None, "investment", "NIFTY 50")
    found = checks(report)
    assert found["swings"]["verdict"] == found["fall"]["verdict"] == found["index"]["verdict"] == "unknown"
    assert report["score"]["unknown"] == 3


def test_a_practice_account_is_not_marked_for_holding_cash():
    report = insights.health(SPREAD, classes(SPREAD), summary(SPREAD, cash=10_000_000), STEADY, AHEAD, "paper", "NIFTY 50")
    assert "cash" not in checks(report)


def test_score_labels_follow_the_score():
    assert insights.score_label(None)[1] == "unknown"
    assert insights.score_label(80) == ("In good shape", "for")
    assert insights.score_label(50)[1] == "mixed"
    assert insights.score_label(20)[1] == "against"


def test_a_fall_is_split_among_the_holdings_that_fell():
    rows = [holding("A", 50, day_pct=-4), holding("B", 30, day_pct=-1), holding("C", 20, day_pct=1)]
    move = insights.movement(rows, summary(rows), {"A": 1.0, "B": 1.0, "C": 1.0}, {"change_pct": -1.0}, "NIFTY 50", TODAY)
    assert move["is_today"] and move["when"] == "today"
    assert [h["symbol"] for h in move["holdings"]] == ["A", "B", "C"]  # the biggest part of the fall first
    shares = [h["share"] for h in move["holdings"]]
    assert round(shares[0] + shares[1]) == 100 and shares[2] is None  # a gain is no part of a fall
    assert "fell" in move["summary"] and "Gains elsewhere" in move["summary"]
    assert move["cause"] and not move["cause"].startswith("The portfolio")
    # The market's part and the holdings' own add back up to the day's change.
    market = move["market"]
    assert market["expected_pnl"] < 0 and round(market["expected_pnl"] + market["own_pnl"], 1) == round(move["day_pnl"], 1)


def test_a_quiet_day_is_called_quiet():
    rows = [holding("A", 50, day_pct=0.02), holding("B", 50, day_pct=-0.01)]
    move = insights.movement(rows, summary(rows), {}, None, "NIFTY 50", date(2026, 10, 11))
    assert "barely moved" in move["summary"] and move["market"] is None
    assert not move["is_today"] and move["when"].startswith("on ")


def test_the_brief_puts_the_pressing_things_first_and_stops_at_four():
    rows = [holding("BIG", 60, sector="Consumer", day_pct=-6, name="Big Co"), holding("MID", 30, sector="Consumer"), holding("SMALL", 10)]
    totals = summary(rows)
    report = insights.health(rows, classes(rows), totals, STEADY, AHEAD, "investment", "NIFTY 50")
    move = insights.movement(rows, totals, {}, None, "NIFTY 50", TODAY)
    events = [{"symbol": "MID", "name": "Mid", "type": "results", "date": "2026-10-12"}]
    items = insights.brief(rows, totals, report, move, events, "investment", TODAY)
    assert len(items) == 4
    assert items[0]["id"] == "largest" and items[0]["title"] == "Big Co is 60% of your portfolio"
    assert items[1]["id"] == "move" and items[1]["to"] == "#movement" and items[1]["tone"] == "attention"
    assert {i["tone"] for i in items} <= {"attention", "info", "good"}


def test_the_brief_says_so_when_nothing_needs_attention():
    totals = summary(SPREAD, cash=500)
    level = {"days": 365, "period_return": 0.08, "benchmark_return": 0.08}
    report = insights.health(SPREAD, classes(SPREAD), totals, STEADY, level, "investment", "NIFTY 50")
    move = insights.movement(SPREAD, totals, {}, None, "NIFTY 50", TODAY)
    items = insights.brief(SPREAD, totals, report, move, [], "investment", TODAY)
    assert [i["id"] for i in items] == ["quiet"]


def test_results_and_dividends_in_the_week_are_each_one_line():
    totals = summary(SPREAD, cash=500)
    report = insights.health(SPREAD, classes(SPREAD), totals, STEADY, AHEAD, "investment", "NIFTY 50")
    move = insights.movement(SPREAD, totals, {}, None, "NIFTY 50", TODAY)
    events = [
        {"symbol": "S1", "name": "One", "type": "results", "date": "2026-10-10"},
        {"symbol": "S2", "name": "Two", "type": "results", "date": "2026-10-12"},
        {"symbol": "S3", "name": "Three", "type": "dividend", "date": "2026-10-09"},
    ]
    items = {i["id"]: i for i in insights.brief(SPREAD, totals, report, move, events, "investment", TODAY)}
    assert items["results"]["title"] == "2 of your holdings report results this week"
    assert items["dividend"]["title"] == "Three goes ex-dividend today"
