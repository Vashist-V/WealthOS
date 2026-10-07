"""The market pulse: scores for the market, a sector and a company are arithmetic
over checks, so they are tested here on fixed figures with no market data."""
import pytest

from app.services import pulse
from app.services.tradecheck import _check
from tests.test_assistant import BRIEFING


def check(verdict: str, weight: int, id: str = "x") -> dict:
    return _check(id, "A check", "What it measures.", verdict, "reading", "What it found.", weight)


def test_a_score_is_the_balance_of_the_checks_by_weight():
    # 4 points for, 1 against, 1 neutral: 50 + 50 × (4 − 1) / 6.
    score = pulse._scored([check("for", 2), check("for", 2), check("against", 1), check("neutral", 1), check("info", 0)], "sector")
    assert (score["value"], score["tone"], score["label"]) == (75, "for", "The sector is in strong shape")
    assert (score["for"], score["against"], score["neutral"], score["scored"]) == (2, 1, 1, 4)
    assert pulse._scored([check("against", 3), check("against", 3)], "market")["label"] == "The market is weak"
    assert pulse._scored([check("for", 3), check("against", 3)], "company")["label"] == "The checks are evenly split"
    # Under six points of weight there is too little to go on.
    assert pulse._scored([check("for", 2), check("for", 2)], "company") == {
        "value": None, "scored": 2, "for": 2, "against": 0, "neutral": 0, "unknown": 0, "label": "Too little data to score", "tone": "unknown",
    }


def test_a_company_is_scored_with_the_trade_checks_checks():
    scores, groups = pulse.score_company(BRIEFING, {"count": 3, "median_pe": 46.0}, 0.13)
    # Short term is trend and risk alone: 4 of 9 points for, none against.
    assert scores["short"]["value"] == 72
    # Long term adds valuation and the business: 12 of 17 points for.
    assert scores["long"]["value"] == 85 and scores["long"]["label"] == "Most checks are positive"
    assert [c["id"] for c in groups["trend"]] == ["trend_200", "trend_50", "momentum", "rsi"]
    # The annual statements and the size of an order are not known here, so those lines are left out.
    assert "profit_trend" not in [c["id"] for c in groups["business"]]
    assert [c["id"] for c in groups["risk"]] == ["volatility", "drawdown"]


def member(symbol: str = "X", strong: bool = True, **over) -> dict:
    """One company as a sector sees it: all of its readings point the same way unless overridden."""
    up = 1 if strong else -1
    return {
        "symbol": symbol, "live": True, "change_pct": 0.5 * up, "market_cap": 1e11,
        "above_50": strong, "above_200": strong, "rsi": 60.0 if strong else 40.0, "volatility": 0.2 if strong else 0.5,
        "from_high": -2.0 if strong else -40.0, "from_low": 40.0 if strong else 2.0,
        "roe": 0.20 if strong else 0.05, "revenue_growth": 0.10 if strong else -0.10, "earnings_growth": 0.12 if strong else -0.20,
        "pe_clean": 20.0 if strong else 60.0,
        "returns": {"1 week": 1.0 * up, "1 month": 6.0 * up, "3 months": 12.0 * up, "1 year": 20.0 * up},
        "score": {"short": {"value": 70 if strong else 30}, "long": {"value": 80 if strong else 20}},
        **over,
    }


MARKET = {"benchmark_name": "NIFTY 50", "returns": {"1 month": 1.0, "3 months": 2.0, "1 year": 5.0}, "median_pe": 30.0}


def test_a_strong_sector_and_a_weak_one():
    strong = pulse.sector_checks("IT", [member(f"S{i}") for i in range(4)], MARKET)
    assert {c["id"]: c["verdict"] for c in strong["short"]} == {
        "above_50": "for", "above_200": "for", "vs_1_month": "for", "vs_3_months": "for", "stretch": "neutral", "highs": "for", "swings": "for",
    }
    assert all(c["verdict"] == "for" for c in strong["long"])
    assert strong["short"][0]["reading"] == "4 of 4"
    assert "5.0 points ahead of the market" in strong["short"][2]["detail"]

    weak = pulse.sector_checks("IT", [member(f"W{i}", strong=False) for i in range(4)], MARKET)
    assert {c["id"]: c["verdict"] for c in weak["long"]} == {
        "above_200": "against", "vs_1_year": "against", "growth": "against", "profitability": "against", "valuation": "against", "swings": "against",
    }
    assert "0 of the 4 IT companies tracked here are above their 50-day average" in weak["short"][0]["detail"]
    assert "Sales and profit are shrinking" in weak["long"][2]["detail"]


def test_a_sector_is_scored_and_its_companies_ranked():
    members = [member("BIG", market_cap=9e11), member("SMALL", market_cap=1e10), member("WEAK", strong=False), member("ALSO")]
    sector = pulse._sector("IT", members, MARKET)
    # Three of four are strong: enough for most breadth checks, and the averages stay ahead of the market.
    assert sector["count"] == 4 and sector["score"]["short"]["value"] is not None
    assert sector["change_pct"] == pytest.approx(0.25)
    assert (sector["advances"], sector["declines"]) == (3, 1)
    # Highest score first; between equals, the larger company.
    assert sector["ranked"]["long"] == ["BIG", "ALSO", "SMALL", "WEAK"]
    # Two companies are too few to speak for a sector.
    assert pulse._sector("Telecom", members[:2], MARKET)["score"]["long"]["label"] == "Too little data to score"


def test_the_market_mood_on_a_weak_day():
    checks = pulse.mood_checks({
        "benchmark_name": "NIFTY 50",
        "index": {"price": 22603.0, "change_pct": -0.76, "sma_50": 23796.0, "sma_200": 24307.0},
        "breadth": {"advances": 22, "declines": 101, "unchanged": 0, "total": 123, "above_50": 19, "above_200": 33, "new_highs": 1, "new_lows": 8},
        "vix": {"price": 13.9},
    })
    assert {c["id"]: c["verdict"] for c in checks} == {
        "index_200": "against", "index_50": "against", "breadth_50": "against", "breadth_200": "against", "highs_lows": "against", "vix": "for", "today": "info",
    }
    # 8 of 9 points against, 1 for: 50 − 50 × 7 / 9.
    assert pulse._scored(checks, "market")["value"] == 11
    assert "1 company made a new 52-week high today and 8 made a new low." in checks[4]["detail"]
    assert checks[0]["reading"] == "7.0% below"


def company(symbol: str, sector: str, long: int, price: float, cap: float = 1e10) -> dict:
    brief = {"value": long, "tone": "for" if long >= 56 else "mixed", "label": "L"}
    return {
        "symbol": symbol, "name": f"{symbol} Ltd", "sector": sector, "price": price, "change_pct": 1.0, "market_cap": cap,
        "returns": {"1 month": 2.0}, "score": {"short": {**brief, "value": 100 - long}, "long": brief},
        "why": {h: {"for": [{"title": "Trend", "reading": "up"}], "against": []} for h in pulse.HORIZONS},
    }


def sector(name: str, count: int, long: int) -> dict:
    brief = {"value": long, "tone": "for", "label": "The sector is leaning positive"}
    return {"name": name, "count": count, "score": {"short": brief, "long": brief}}


PULSE = {
    "sectors": [sector("Alpha", 6, 60), sector("Beta", 3, 80)],
    "companies": {
        c["symbol"]: c
        for c in [
            company("A1", "Alpha", 90, 100.0), company("A2", "Alpha", 80, 60000.0), company("A3", "Alpha", 70, 250.0),
            company("A4", "Alpha", 60, 400.0), company("A5", "Alpha", 50, 1000.0), company("A6", "Alpha", 40, 80.0),
            company("B1", "Beta", 95, 10.0), company("B2", "Beta", 85, 20.0, cap=5e10), company("B3", "Beta", 85, 30.0, cap=9e10),
        ]
    },
}


def test_ideas_for_a_sum_of_money():
    idea = pulse.ideas(PULSE, 50000, "long")
    # Beta scores higher but tracks three companies, too few to offer five or to trust its score.
    assert (idea["sector"], idea["asked"]) == ("Alpha", False)
    assert idea["sectors"] == [{"name": "Alpha", "score": 60, "tone": "for"}]
    # A2 is left out: one share costs more than the whole sum.
    assert [r["symbol"] for r in idea["companies"]] == ["A1", "A3", "A4", "A5", "A6"]
    assert (idea["too_dear"], idea["each"]) == (1, 10000)
    assert [(r["shares"], r["split_shares"]) for r in idea["companies"]] == [(500, 100), (200, 40), (125, 25), (50, 10), (625, 125)]


def test_ideas_in_the_sector_asked_about():
    idea = pulse.ideas(PULSE, 50000, "long", "Beta")
    assert (idea["sector"], idea["asked"]) == ("Beta", True)
    assert idea["sector_score"] == {"score": 80, "tone": "for", "label": "The sector is leaning positive"}
    # Equal scores are settled by size.
    assert [r["symbol"] for r in idea["companies"]] == ["B1", "B3", "B2"]


def test_the_highest_scores_across_everything():
    assert [r["symbol"] for r in pulse.top_companies(PULSE, "long", limit=3)] == ["B1", "A1", "B3"]
    # The short-term reading ranks differently, and a row carries its reasons.
    row = pulse.top_companies(PULSE, "short", "Alpha", limit=1)[0]
    assert (row["symbol"], row["score"], row["for"]) == ("A6", 60, [{"title": "Trend", "reading": "up"}])
