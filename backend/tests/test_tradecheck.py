"""The trade check: every verdict and the score come from data alone, so they
are checked here against a fixed briefing with no network and no API key."""
import asyncio
import json

import anthropic
import httpx2
import pandas as pd
import pytest
from fastapi import HTTPException

from app.config import Settings
from app.market import provider
from app.services import assistant, tradecheck
from tests.test_assistant import BRIEFING, _reply


def extras(asset_class: str = "Equity", **portfolio) -> dict:
    """What the checks use beyond the briefing: HAL is 8.5% of a ₹8.5 lakh portfolio."""
    return {
        "asset_class": asset_class,
        "benchmark_volatility": 0.13,
        "peers": {"count": 3, "median_pe": 46.0},
        "var_95": 0.03,
        "year_outcomes": {"years": 10.0, "periods": 2200, "positive": 0.8, "median": 0.3, "poor": -0.2, "good": 1.2},
        "portfolio": {
            "id": "p1", "name": "Long-Term", "kind": "investment", "cash": 0.0, "value": 850000.0,
            "held": {"quantity": 15.0, "avg_cost": 3700.32, "invested": 55504.8, "value": 72240.0},
            "sector_value": 100000.0, "correlation": 0.45, "others": 6,
            "lots": [{"date": "2024-04-08", "quantity": 12.0}, {"date": "2025-10-20", "quantity": 3.0}],
            **portfolio,
        },
    }


EMPTY = {"value": 0.0, "held": None, "sector_value": 0.0, "correlation": None, "others": 0, "lots": []}


def verdicts(report: dict) -> dict[str, str]:
    return {c["id"]: c["verdict"] for g in report["groups"] for c in g["checks"]}


def check(report: dict, id: str) -> dict:
    return next(c for g in report["groups"] for c in g["checks"] if c["id"] == id)


def test_a_buy_is_scored_from_the_checks():
    report = tradecheck.evaluate(BRIEFING, extras(), "BUY", 10)
    v = verdicts(report)
    # 4,816 is 9% over the 200-day average and within 2% of the 50-day one.
    assert (v["trend_200"], v["trend_50"], v["momentum"], v["rsi"]) == ("for", "neutral", "for", "neutral")
    # P/E 34.6 against a sector middle of 46; forward P/E 27.9 implies profit up 24%.
    assert (v["pe_sector"], v["earnings_ahead"]) == ("for", "for")
    assert (v["growth"], v["profitability"], v["debt"], v["profit_trend"]) == ("for", "for", "for", "unknown")
    assert (v["volatility"], v["drawdown"], v["bad_day"]) == ("neutral", "neutral", "info")
    assert (v["concentration"], v["sector"], v["diversification"]) == ("neutral", "for", "neutral")
    # 14 of 24 points of weight support the buy and none go against it: 50 + 50 × 14 / 24.
    assert report["score"] == {
        "value": 79, "label": "Most checks support this buy", "tone": "for", "scored": 14,
        "for": 8, "against": 0, "neutral": 6, "unknown": 1,
    }
    assert report["value"] == pytest.approx(48160)
    assert check(report, "bad_day")["reading"] == "−₹1,445"
    assert report["outcomes"]["poor_amount"] == pytest.approx(-9632)


def test_a_sale_reads_the_same_facts_the_other_way():
    report = tradecheck.evaluate(BRIEFING, extras(), "SELL", 10)
    v = verdicts(report)
    assert (v["trend_200"], v["pe_sector"], v["growth"]) == ("against", "against", "against")
    assert report["score"]["value"] == 25 and report["score"]["label"] == "Most checks go against this sale"
    # Risk is the exception: a rough ride is a reason to trim, but a calm one is no reason to hold on.
    for swing, buy, sell in ((0.18, "for", "neutral"), (0.45, "against", "for")):
        b = {**BRIEFING, "trend": {**BRIEFING["trend"], "volatility": swing}}
        assert check(tradecheck.evaluate(b, extras(), "BUY", 10), "volatility")["verdict"] == buy
        assert check(tradecheck.evaluate(b, extras(), "SELL", 10), "volatility")["verdict"] == sell
    locked = check(report, "proceeds")
    assert locked["reading"] == "+₹11,157" and "leaves you 5 shares" in locked["detail"]
    assert report["position"]["after"]["quantity"] == 5


def test_a_large_buy_is_marked_down_for_concentration():
    report = tradecheck.evaluate(BRIEFING, extras(), "BUY", 100)
    weight = check(report, "concentration")
    assert weight["verdict"] == "against" and weight["reading"] == "8.5% → 41.6%"
    assert check(report, "sector")["verdict"] == "neutral"
    assert report["position"]["after"]["avg_cost"] == pytest.approx((55504.8 + 481600) / 115)


def test_a_first_purchase_is_not_marked_down_for_being_the_only_holding():
    report = tradecheck.evaluate(BRIEFING, extras(**EMPTY), "BUY", 10)
    v = verdicts(report)
    assert (v["concentration"], v["sector"], v["diversification"]) == ("neutral", "neutral", "unknown")
    assert "normal for a first purchase" in check(report, "concentration")["detail"]
    assert "average_cost" not in v


def test_selling_needs_the_shares():
    with pytest.raises(HTTPException) as nothing:
        tradecheck.evaluate(BRIEFING, extras(**EMPTY), "SELL", 1)
    assert nothing.value.status_code == 422 and "nothing to sell" in nothing.value.detail
    with pytest.raises(HTTPException) as too_many:
        tradecheck.evaluate(BRIEFING, extras(), "SELL", 16)
    assert "Only 15 HAL" in too_many.value.detail


def test_tax_line_counts_shares_oldest_first():
    # Ten shares come out of the 2024 lot alone.
    assert check(tradecheck.evaluate(BRIEFING, extras(), "SELL", 10), "tax")["reading"] == "Long-term"
    # Fourteen reach two shares bought on 20 Oct 2025, which turn long-term 15 days after the briefing's date.
    tax = check(tradecheck.evaluate(BRIEFING, extras(), "SELL", 14), "tax")
    assert (tax["verdict"], tax["reading"], tax["weight"]) == ("against", "15 days to long-term", 1)
    assert "2 of the 14 shares" in tax["detail"] and "21 Oct 2026" in tax["detail"]
    # Virtual money is not taxed.
    assert "tax" not in verdicts(tradecheck.evaluate(BRIEFING, extras(kind="paper"), "SELL", 14))


def test_a_paper_buy_is_checked_against_virtual_cash():
    short = tradecheck.evaluate(BRIEFING, extras(kind="paper", cash=10000.0), "BUY", 10)
    assert check(short, "cash")["verdict"] == "against"
    enough = tradecheck.evaluate(BRIEFING, extras(kind="paper", cash=100000.0), "BUY", 10)
    assert check(enough, "cash")["verdict"] == "info" and check(enough, "cash")["reading"] == "₹51,840 left"


def test_a_fund_skips_the_company_checks():
    report = tradecheck.evaluate(BRIEFING, extras(asset_class="Funds & ETFs"), "BUY", 10)
    assert "business" not in [g["id"] for g in report["groups"]]
    v = verdicts(report)
    assert v["pe_sector"] == "info" and v["concentration"] == "info" and "sector" not in v


def test_results_within_a_week_count_against_a_buy_only():
    soon = {**BRIEFING, "events": {**BRIEFING["events"], "results": "2026-10-09"}}
    assert check(tradecheck.evaluate(soon, extras(), "BUY", 10), "results")["verdict"] == "against"
    assert check(tradecheck.evaluate(soon, extras(), "SELL", 10), "results")["verdict"] == "info"
    assert check(tradecheck.evaluate(BRIEFING, extras(), "BUY", 10), "results")["verdict"] == "info"


def test_too_little_data_gives_no_score():
    bare = {
        **BRIEFING,
        "trend": {**BRIEFING["trend"], "sma_50": None, "sma_200": None, "rsi_14": None, "volatility": None, "beta": None,
                  "drawdown": {"value": None, "peak": None, "trough": None, "recovered": None}},
        "returns": {k: None for k in BRIEFING["returns"]},
        "fundamentals": {k: None for k in BRIEFING["fundamentals"]},
        "financial_history": {"periods": []},
    }
    score = tradecheck.evaluate(bare, extras(**EMPTY), "BUY", 10)["score"]
    assert score["value"] is None and score["label"] == "Too little data to score this trade"


def test_the_result_in_words_and_as_text_for_the_model():
    report = tradecheck.evaluate(BRIEFING, extras(), "BUY", 10)
    summary = report["summary"]
    assert summary.startswith("**Most checks support this buy.** The score is 79 out of 100: 8 of the 14 scored checks support buying 10 HAL")
    assert "**What supports it**" in summary and "**What goes against it**" not in summary
    text = tradecheck.render(report)
    assert text == tradecheck.render(report)  # same report, same bytes
    for expected in (
        "TRADE CHECK, prepared 6 Oct 2026. The user is thinking of buying 10 HAL (Hindustan Aeronautics) at about ₹4,816.00",
        "CONFIDENCE SCORE: 79 out of 100. Most checks support this buy.",
        "- [SUPPORTS] Longer trend (200-day average) (9.0% above)",
        "- [NO DATA] Profit over the years",
        "Shares 15 to 25; share of the portfolio 8.5% to 13.4%",
        "80% of one-year periods ended higher",
    ):
        assert expected in text


def test_year_outcomes_need_three_years_of_prices():
    days = pd.bdate_range("2020-01-01", periods=1000)
    rising = pd.Series([100 * 1.0005**i for i in range(1000)], index=days)
    assert tradecheck._year_outcomes(rising.iloc[:700]) is None
    outcomes = tradecheck._year_outcomes(rising)
    assert outcomes["periods"] == 748 and outcomes["positive"] == 1.0
    assert outcomes["median"] == pytest.approx(1.0005**252 - 1)


def test_search_forgives_a_near_miss_on_the_name():
    assert provider._loosely(["HERO", "MOTORS"], ["HERO", "MOTOCORP"])
    assert not provider._loosely(["TATA", "MOTORS"], ["TATA", "POWER"])


def test_the_explanation_gets_its_own_instructions_and_the_report(monkeypatch):
    seen = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen["body"] = json.loads(request.content)
        return httpx2.Response(200, content=_reply(with_search=False), headers={"content-type": "text/event-stream"})

    settings = Settings(_env_file=None, anthropic_api_key="test-key", assistant_web_search=False)
    client = anthropic.AsyncAnthropic(
        api_key="test-key",
        max_retries=0,
        http_client=anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler)),
    )
    monkeypatch.setattr(assistant, "_client", lambda _settings: client)
    report = tradecheck.evaluate(BRIEFING, extras(), "BUY", 10)
    context = f"{tradecheck.render(report)}\n\n{assistant.render_briefing(BRIEFING)}"

    async def collect():
        stream = assistant.stream_answer(settings, BRIEFING, [], tradecheck.QUESTION, system=tradecheck.SYSTEM_PROMPT, context=context)
        return [e async for e in stream]

    events = asyncio.run(collect())
    assert events[-1] == {"type": "done", "truncated": False}
    system = seen["body"]["system"]
    assert system[0]["text"] == tradecheck.SYSTEM_PROMPT
    assert system[1]["text"].startswith("TRADE CHECK, prepared 6 Oct 2026") and "BRIEFING FOR Hindustan Aeronautics" in system[1]["text"]
    assert seen["body"]["messages"][-1] == {"role": "user", "content": tradecheck.QUESTION}
