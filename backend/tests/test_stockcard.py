"""The stock decision card and the company-facts store, from hand-built data: nothing is fetched."""
import json
import time

from app.market import facts
from app.market.provider import MarketData
from app.services import stockcard, tradecheck


def check(id, verdict, weight=1, reading="r", detail="d."):
    return {"id": id, "title": id, "learn": "", "verdict": verdict, "reading": reading, "detail": detail, "weight": weight if verdict != "info" else 0}


def company(symbol="AAA", sector="IT", long=70, **groups):
    score = lambda v: {"value": v, "tone": "for", "label": "", "scored": 5, "for": 3, "against": 1, "neutral": 1, "unknown": 0}  # noqa: E731
    return {
        "symbol": symbol, "name": f"{symbol} Ltd", "sector": sector, "price": 100.0, "change_pct": 1.0, "market_cap": 1e12, "pe": 20.0, "roe": 0.2,
        "revenue_growth": 0.1, "earnings_growth": 0.12, "volatility": 0.25, "returns": {"1 year": 12.0}, "from_high": -8.0,
        "score": {"long": score(long), "short": score(50)},
        "groups": {
            "trend": groups.get("trend", [check("trend_200", "for", 2), check("rsi", "neutral")]),
            "valuation": groups.get("valuation", [check("pe_sector", "against", 2), check("earnings_ahead", "for", 1)]),
            "business": groups.get("business", [check("growth", "for", 2), check("profitability", "for", 2), check("debt", "info")]),
            "risk": groups.get("risk", [check("volatility", "unknown", 2), check("drawdown", "unknown", 1)]),
        },
    }


class Market:
    """Only what the card asks of the market cache."""

    def __init__(self, dividend=2.0, income=None):
        self.dividend, self.income = dividend, income

    def trailing_dividend(self, symbol):
        return self.dividend

    def financials(self, symbol, wait=True):
        return {"income": {"annual": self.income or {"periods": [], "rows": []}}}

    def info(self, symbol, wait=True):
        return {"debt_to_equity": 0.4, "profit_margin": 0.15}

    def fact_time(self, kind, symbol):
        return 1_790_000_000.0


class Ctx:
    def __init__(self, market):
        self.market = market


def snapshot(*companies):
    return {"as_of": "2026-10-09", "companies": {c["symbol"]: c for c in companies}}


def test_an_area_reads_as_the_balance_of_its_checks():
    assert stockcard._verdict([check("a", "for", 2), check("b", "against", 1)]) == "for"
    assert stockcard._verdict([check("a", "for", 1), check("b", "against", 2)]) == "against"
    assert stockcard._verdict([check("a", "for", 1), check("b", "against", 1)]) == "neutral"
    assert stockcard._verdict([check("a", "info")]) == "info"
    assert stockcard._verdict([check("a", "unknown")]) == "unknown"


def test_the_card_groups_the_pulse_checks_under_the_questions():
    card = stockcard.card(Ctx(Market()), "AAA", snapshot(company()))
    areas = {a["id"]: a for a in card["areas"]}
    assert list(areas) == ["quality", "growth", "debt", "valuation", "income", "risk", "trend"]
    assert areas["quality"]["verdict"] == "for" and areas["valuation"]["verdict"] == "against"  # the heavier check decides
    assert areas["debt"]["verdict"] == "info" and areas["risk"]["verdict"] == "unknown"
    assert [c["id"] for c in areas["trend"]["checks"]] == ["trend_200", "rsi"]
    assert card["figures"]["debt_to_equity"] == 0.4 and card["figures"]["dividend_yield"] == 0.02
    assert card["figures_as_of"] == "2026-09-21" and card["as_of"] == "2026-10-09"


def test_the_dividend_is_a_note_and_never_scored():
    paying = {a["id"]: a for a in stockcard.card(Ctx(Market(dividend=2.0)), "AAA", snapshot(company()))["areas"]}["income"]
    assert paying["verdict"] == "info" and paying["reading"] == "2.0% a year" and paying["checks"][0]["weight"] == 0
    none = {a["id"]: a for a in stockcard.card(Ctx(Market(dividend=0.0)), "AAA", snapshot(company()))["areas"]}["income"]
    assert none["reading"] == "None in a year"


def test_profit_over_the_years_joins_growth_when_statements_are_held():
    income = {"periods": ["2023-03-31", "2024-03-31", "2025-03-31"], "rows": [{"key": "net_income", "values": [1e10, 1.2e10, 1.5e10]}]}
    growth = {a["id"]: a for a in stockcard.card(Ctx(Market(income=income)), "AAA", snapshot(company()))["areas"]}["growth"]
    assert [c["id"] for c in growth["checks"]] == ["growth", "profit_trend"]
    assert "it has grown" in growth["summary"]
    without = {a["id"]: a for a in stockcard.card(Ctx(Market()), "AAA", snapshot(company()))["areas"]}["growth"]
    assert [c["id"] for c in without["checks"]] == ["growth"]


def test_profit_trend_reads_the_first_year_against_the_last():
    history = {"periods": ["2023-03-31", "2024-03-31", "2025-03-31"], "net_income": [1000.0, 900.0, 700.0]}
    assert tradecheck.profit_trend(history, "BUY")["verdict"] == "against"
    assert tradecheck.profit_trend({"periods": ["2024-03-31"], "net_income": [5.0]}, "BUY")["verdict"] == "unknown"


def test_peers_are_the_same_sector_strongest_first():
    card = stockcard.card(Ctx(Market()), "AAA", snapshot(company(), company("BBB", long=60), company("CCC", long=80), company("DDD", sector="Energy", long=99)))
    assert [p["symbol"] for p in card["peers"]] == ["CCC", "BBB"]


def test_anything_untracked_is_named_rather_than_guessed(monkeypatch):
    held = snapshot(company(), company("BBB"))
    monkeypatch.setattr(stockcard.pulse, "snapshot", lambda ctx: held)
    assert stockcard.card(Ctx(Market()), "NIFTYBEES", held) == {"available": False, "symbol": "NIFTYBEES"}
    out = stockcard.compare(Ctx(Market()), ["BBB", "NIFTYBEES", "AAA", "BBB"])
    assert [c["symbol"] for c in out["companies"]] == ["BBB", "AAA"] and out["skipped"] == ["NIFTYBEES"]
    assert [a["id"] for a in out["areas"]][0] == "quality" and len(out["areas"]) == 7


def test_at_most_four_companies_are_compared(monkeypatch):
    held = snapshot(*(company(s) for s in "ABCDEF"))
    monkeypatch.setattr(stockcard.pulse, "snapshot", lambda ctx: held)
    assert len(stockcard.compare(Ctx(Market()), list("ABCDEF"))["companies"]) == 4


# ------------------------------------------------------------ company facts
def test_a_stored_fact_is_taken_only_when_it_is_newer(tmp_path):
    market = MarketData(str(tmp_path))
    now = time.time()  # recent, so that reading it back does not set off a lookup for something fresher
    assert market.adopt("info", "TCS", now - 30, {"pe": 20})
    assert not market.adopt("info", "TCS", now - 60, {"pe": 99})  # older than what is held
    assert market.adopt("info", "TCS", now - 10, {"pe": 21})
    assert market.info("TCS", wait=False) == {"pe": 21} and market.fact_time("info", "TCS") == now - 10


def test_a_newer_copy_on_disk_is_not_replaced_by_an_older_stored_one(tmp_path):
    market = MarketData(str(tmp_path))
    market._meta_path("info", "TCS").write_text(json.dumps({"at": 300.0, "symbol": "TCS", "data": {"pe": 30}}), encoding="utf-8")
    assert not market.adopt("info", "TCS", 200.0, {"pe": 21})


def test_a_failed_lookup_is_not_repeated_straight_away(tmp_path):
    market = MarketData(str(tmp_path))
    calls = []

    def refuse():
        calls.append(1)
        return None

    assert market._cached("info", "X", 60.0, refuse) is None  # asked for now, with nothing held: it tries
    market._pool.submit(lambda: None).result()
    market._cached("info", "X", 60.0, refuse, wait=False)  # in the background, soon after a refusal: it waits
    market._pool.submit(lambda: None).result()
    assert len(calls) == 1


def test_the_local_cache_becomes_rows_to_store(tmp_path):
    market = MarketData(str(tmp_path))
    market._meta_path("info", "TCS").write_text(json.dumps({"at": 1_790_000_000.0, "data": {"pe": 20}}), encoding="utf-8")  # an older file, without its symbol
    market._meta_path("calendar", "ODD").write_text(json.dumps({"at": 1_790_000_000.0, "symbol": "ODD.NS", "data": {"earnings_dates": []}}), encoding="utf-8")
    market._meta_path("search", "tcs").write_text(json.dumps({"at": 1.0, "data": []}), encoding="utf-8")  # not a shared kind
    rows = {(r["kind"], r["symbol"]): r for r in facts.cached(str(tmp_path))}
    assert set(rows) == {("info", "TCS"), ("calendar", "ODD.NS")}
    assert rows[("info", "TCS")]["data"] == {"pe": 20} and rows[("info", "TCS")]["fetched_at"].startswith("2026-09-21")


def test_adopting_reads_every_page_and_skips_what_it_cannot_use(tmp_path, monkeypatch):
    stored = [
        {"symbol": "TCS", "kind": "info", "data": {"pe": 20}, "fetched_at": "2026-10-09T10:00:00+00:00"},
        {"symbol": "TCS", "kind": "news", "data": [], "fetched_at": "2026-10-09T10:00:00+00:00"},  # not a kind the cache shares
        {"symbol": "INFY", "kind": "info", "data": {"pe": 22}, "fetched_at": "not a time"},
    ]
    monkeypatch.setattr(facts, "read", lambda url, key: stored)
    market = MarketData(str(tmp_path))
    assert facts.adopt(market, "https://example.supabase.co", "key") == 1
    assert market._meta[("info", "TCS")][1] == {"pe": 20} and ("info", "INFY") not in market._meta
