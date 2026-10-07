"""The market assistant: how a question is read, which card goes with it, and
the answer written from data alone. No network, no API key, no language model."""
import pytest

from app.services import market_assistant as ma
from app.services.market_assistant import Focus
from tests.test_pulse import PULSE, check


# ---------------------------------------------------------------- reading
@pytest.mark.parametrize("text, sector", [
    ("is it right time to invest for short term in IT sector", "IT"),
    ("is it a good time to invest", None),  # "it" is only a sector in capitals or beside "stocks"
    ("are it stocks cheap", "IT"),
    ("what about pharma?", "Healthcare"),
    ("how are bank stocks doing", "Financials"),
    ("I have money in my bank", None),
    ("consumer staples", "FMCG"),
    ("consumer stocks", "Consumer"),
    ("Is it a good time for Power & Utilities stocks?", "Power & Utilities"),
    ("Is it a good time for Energy stocks?", "Energy"),
    ("how much energy do you have", None),
])
def test_sectors_are_found_by_the_words_people_use(text, sector):
    assert ma.find_sector(text) == sector


@pytest.mark.parametrize("text, amount", [
    ("I have 50000 rs in which sector to invest", 50000),
    ("I have ₹50,000. Where could it go?", 50000),
    ("50k for the long term", 50000),
    ("where can 1.5 lakh go", 150000),
    ("2 crore", 2e7),
    ("I have 75000 to invest", 75000),
    ("top 5 companies in pharma", None),
    ("should I invest in 2026", None),  # a year, not a sum
    ("30 shares", None),
])
def test_a_sum_of_money_is_read_in_indian_units(text, amount):
    assert ma.find_amount(text) == amount


def test_companies_are_found_by_name_ticker_or_nickname():
    assert ma.find_company("how is reliance doing")[0] == "RELIANCE"
    assert ma.find_company("is TCS a good buy")[0] == "TCS"
    assert ma.find_company("thinking about hero motors")[0] == "HEROMOTOCO"
    assert ma.find_company("what is the state of the market") is None
    assert ma.find_company("persistent selling in the market") is None
    # The company's own name is taken out, so "tech" is not then read as the IT sector.
    focus = ma.parse("is tech mahindra a good buy for the long term")
    assert (focus.intent, focus.symbol, focus.sector, focus.horizon) == ("company", "TECHM", None, "long")


@pytest.mark.parametrize("question, intent", [
    ("what was the trend today", "today"),
    ("why did it happen", "why"),
    ("which sector performed well", "sectors"),
    ("today's top gainers", "movers"),
    ("Is this a good time to invest?", "mood"),
    ("which companies score highest", "top"),
    ("I want to invest", "invest"),
    ("what is a P/E ratio?", None),
])
def test_what_a_question_is_asking(question, intent):
    assert ma.parse(question).intent == intent


def test_the_users_own_examples():
    timing = ma.parse("is it right time to invest for short term in IT sector")
    assert (timing.intent, timing.sector, timing.horizon) == ("sector", "IT", "short")
    money = ma.parse("I have 50000 rs in which sector to invest")
    assert (money.intent, money.amount, money.sector) == ("invest", 50000, None)
    # Money put to work is read as a long-term question unless they say otherwise; timing as a short-term one.
    assert ma.horizon_for(money) == "long" and ma.horizon_for(ma.parse("is it a good time for banks")) == "short"
    ranking = ma.parse("top 5 companies in pharma")
    assert (ranking.intent, ranking.sector, ranking.symbol) == ("top", "Healthcare", None)


def test_a_follow_up_keeps_what_it_does_not_say():
    history = [{"role": "user", "content": "I have 2 lakh, where can I put it in banking stocks for the long term?"}, {"role": "assistant", "content": "..."}]
    pharma = ma.resolve("what about pharma?", history)
    assert (pharma.intent, pharma.sector, pharma.amount, pharma.horizon) == ("invest", "Healthcare", 200000, "long")
    history += [{"role": "user", "content": "what about pharma?"}, {"role": "assistant", "content": "..."}]
    short = ma.resolve("and for the short term?", history)
    assert (short.intent, short.sector, short.amount, short.horizon) == ("invest", "Healthcare", 200000, "short")
    # A question that says what it wants in its own words starts afresh.
    fresh = ma.resolve("I have 1 lakh, where should I invest?", history)
    assert (fresh.intent, fresh.sector, fresh.amount) == ("invest", None, 100000)
    # So does a suggested question, whose intent the app already knows.
    assert ma.resolve("Which sectors look strongest?", history, "sectors").sector is None
    # And one the app cannot place carries nothing over.
    assert ma.resolve("what is a P/E ratio?", history).intent is None


# ------------------------------------------------------------------ answers
def brief(value: int, label: str = "L") -> dict:
    return {"value": value, "tone": "for" if value >= 56 else "against", "label": label, "scored": 6, "for": 3, "against": 1, "neutral": 2, "unknown": 0}


def market() -> dict:
    """A small pulse: the two sectors and nine companies of the pulse tests, with the day around them."""
    companies = {
        s: {**c, "score": {h: {**c["score"][h], "tone": "for", "label": "More checks are positive than negative"} for h in ("short", "long")},
            "groups": {g: [check("for", 2, f"{g}_1")] for g in ("trend", "valuation", "business", "risk")}}
        for s, c in PULSE["companies"].items()
    }
    sectors = [
        {**s, "change_pct": change, "returns": {"1 week": 1.0, "1 month": 2.0, "3 months": 3.0, "1 year": 4.0},
         "score": {"short": brief(short, "The sector is leaning negative"), "long": brief(s["score"]["long"]["value"], "The sector is leaning positive")},
         "checks": {"short": [check("against", 2, "above_50"), check("for", 1, "vs_3_months")], "long": [check("for", 2, "growth")]},
         "ranked": {h: sorted((c for c in companies if companies[c]["sector"] == s["name"]), key=lambda c: -companies[c]["score"][h]["value"]) for h in ("short", "long")}}
        for s, change, short in ((PULSE["sectors"][0], -0.5, 39), (PULSE["sectors"][1], 1.2, 44))
    ]
    returns = {"1 week": 0.5, "1 month": -2.0, "3 months": 1.0, "1 year": 6.0}
    return {
        "as_of": "2026-10-07", "benchmark": "NIFTY 50", "turnover_ratio": 1.2, "news": [],
        "index": {"name": "NIFTY 50", "price": 22603.0, "change_pct": -0.76, "returns": returns},
        "indices": [{"name": "NIFTY 50", "price": 22603.0, "change_pct": -0.76, "returns": returns}],
        "breadth": {"advances": 2, "declines": 7, "unchanged": 0, "total": 9, "above_50": 3, "above_200": 4, "new_highs": 1, "new_lows": 2},
        "mood": {"score": brief(11, "The market is weak"), "checks": [check("against", 2, "index_200"), check("for", 1, "vix")]},
        "sectors": sectors, "companies": companies,
        "movers": {"gainers": ["A1", "B1"], "losers": ["A6", "B3"], "active": ["A1", "A2"]},
    }


def kinds(focus: Focus) -> list[str]:
    return [card["kind"] for card in ma.cards(market(), focus)]


def test_each_question_gets_its_card():
    assert kinds(Focus(intent="invest", amount=50000)) == ["ideas"]
    assert kinds(Focus(intent="invest")) == ["mood"]  # no sum given yet
    assert kinds(Focus(intent="sector", sector="Alpha")) == ["sector"]
    assert kinds(Focus(intent="company", symbol="A1")) == ["company"]
    assert kinds(Focus(intent="top", sector="Alpha")) == ["companies"]
    assert kinds(Focus(intent="sectors")) == ["sectors"]
    assert kinds(Focus(intent="movers")) == ["movers"]
    assert kinds(Focus(intent="today")) == kinds(Focus(intent="why")) == kinds(Focus(intent="mood")) == ["mood"]
    assert kinds(Focus(intent="why", sector="Alpha")) == ["sector"]
    assert kinds(Focus()) == []


def test_the_cards_carry_the_apps_own_figures():
    ideas = ma.cards(market(), Focus(intent="invest", amount=50000))[0]
    assert (ideas["sector"], ideas["horizon"], ideas["mood"]["value"]) == ("Alpha", "long", 11)
    assert [r["symbol"] for r in ideas["companies"]] == ["A1", "A3", "A4", "A5", "A6"]
    sector = ma.cards(market(), Focus(intent="sector", sector="Alpha", horizon="long"))[0]
    assert sector["score"]["long"]["value"] == 60 and [c["id"] for c in sector["checks"]] == ["growth"]
    assert [r["symbol"] for r in sector["companies"]] == ["A1", "A2", "A3", "A4", "A5"]
    company = ma.cards(market(), Focus(intent="company", symbol="A1", horizon="long"))[0]
    assert [g["title"] for g in company["groups"]] == ["Trend", "Valuation", "Business", "Risk"]
    assert [g["title"] for g in ma.cards(market(), Focus(intent="company", symbol="A1"))[0]["groups"]] == ["Trend", "Risk"]


def test_answers_written_from_data():
    p = market()
    money = ma.data_answer(p, Focus(intent="invest", amount=50000))
    assert money.startswith("**On the long-term score, Alpha leads at 60 out of 100.**")
    assert "- A1 (A1 Ltd) scores 90; at ₹100.00 the whole sum buys 500 shares" in money
    assert "The market mood is 11 out of 100: the market is weak." in money and "Trade check" in money
    assert "for example “I have ₹50,000”" in ma.data_answer(p, Focus(intent="invest"))

    timing = ma.data_answer(p, Focus(intent="sector", sector="Alpha", horizon="short"))
    assert timing.startswith("For the short term, Alpha scores **39 out of 100**: the sector is leaning negative.")
    assert "Its long-term score is 60." in timing and "Short-term moves are hard to call" in timing

    today = ma.data_answer(p, Focus(intent="today"))
    assert today.startswith("**NIFTY 50 is −0.76% today at 22,603.** 2 of the 9 companies I track are up and 7 are down, so the fall is broad.")
    assert "- Strongest sectors today: Beta +1.20%, Alpha −0.50%" in today
    assert today.endswith("For the bigger picture, the market mood scores **11 out of 100**: the market is weak.")

    assert ma.data_answer(p, Focus(intent="sectors")).startswith("**Beta did best today (+1.20%) and Alpha worst (−0.50%).**")
    assert "- Up most: A1 +1.00%, B1 +1.00%" in ma.data_answer(p, Focus(intent="movers"))
    assert "no recent market headlines" in ma.data_answer(p, Focus(intent="why"))
    assert "API key to backend/.env" in ma.data_answer(p, Focus())
    assert "have not loaded yet" in ma.data_answer({**p, "companies": {}}, Focus(intent="today"))


def test_the_briefing_for_the_model():
    p = market()
    focus = Focus(intent="invest", amount=50000)
    me = {"count": 3, "value": 250000.0, "sectors": [("Alpha", 60.0), ("Beta", 40.0)], "symbols": ["A1", "A3", "B1"]}
    text = ma.render_briefing(p, me, focus, ma.cards(p, focus))
    for expected in (
        "MARKET BRIEFING, prepared for the session of 7 Oct 2026.",
        "MARKET MOOD SCORE: 11 out of 100. The market is weak.",
        "Alpha (6 companies): today −0.50%; 1 week +1.0%; 1 month +2.0%; 3 months +3.0%; 1 year +4.0%. S 39, L 60. Highest long-term scores: A1 90, A2 80, A3 70.",
        "HIGHEST LONG TERM SCORES ACROSS ALL COMPANIES",
        "Holds 3 stocks and funds worth ₹2,50,000 across their investment portfolios. By sector: Alpha 60%; Beta 40%.",
        "a sum of ₹50,000",
        "Under your answer the app is showing ideas for ₹50,000 on the long-term score. Sector: Alpha (the highest-scoring sector with at least five companies).",
        "A1 score 90, price ₹100.00, the whole sum buys 500 shares, an equal split buys 100",
    ):
        assert expected in text
    # Asked about a sector, the model is given every check behind its two scores.
    detail = ma.render_briefing(p, None, Focus(intent="sector", sector="Alpha"), [])
    assert "ALPHA IN DETAIL, SHORT TERM: score 39 out of 100." in detail and "Holds nothing in the app yet." in detail
    assert detail.endswith("Under your answer the app is showing no card.")


def test_the_opening_and_the_headlines():
    p = market()
    assert "NIFTY 50 is at 22,603, −0.76% today, and 2 of the 9 companies I track are up." in ma.greeting(p, True)
    asks = {s["id"]: s["label"] for s in ma.suggestions(p)}
    # Alpha is the only sector with five companies, so it is the one named, though Beta did better today.
    assert asks["sector"] == "Is it a good time for Alpha stocks?" and asks["invest"] == "I have ₹50,000. Where could it go?"
    assert ma._TIPS.search("Nifty Prediction Today: support can limit the downside. Go long")
    assert ma._TIPS.search("5 stocks to buy this week")
    assert not ma._TIPS.search("Sensex falls 462 points, Nifty down 176 points ahead of RBI policy decision")
