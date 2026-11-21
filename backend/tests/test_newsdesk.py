"""The news desk: how a headline is marked good, bad or neutral, how AI's reading
takes over and is kept, which stocks show good signs, and the views and endpoint.
No network, no keys: the market's news and the model are replaced by fakes."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.market.universe import INSTRUMENTS
from app.services import newsdesk as nd, trade_ai
from app.services.book import Ctx
from app.store.memory import MemoryStore


def ago(hours: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


NEWS = {
    "TCS": [
        {"title": "TCS net profit rises 9%, beats estimates", "source": "Mint", "published": ago(3), "url": "https://example.com/tcs1"},
        {"title": "TCS bags large deal from European bank", "source": "ET", "published": ago(30), "url": "https://example.com/tcs2"},
        {"title": "Stocks to watch today: TCS, Infosys", "source": "BS", "published": ago(5), "url": "https://example.com/watch"},
    ],
    "INFY": [
        {"title": "Stocks to watch today: TCS, Infosys", "source": "BS", "published": ago(5), "url": "https://example.com/watch"},
        {"title": "Infosys shares fall 4% after weak Q2 results", "source": "Mint", "published": ago(2), "url": "https://example.com/infy1"},
        {"title": "SEBI probe into Infosys insider trading", "source": "ET", "published": ago(40), "url": "https://example.com/infy2"},
        {"title": "Infosys old story", "source": "ET", "published": ago(24 * 30), "url": "https://example.com/old"},
    ],
    "ITC": [{"title": "ITC board meets on Friday", "source": "ET", "published": ago(10), "url": "https://example.com/itc"}],
}


class Market:
    def __init__(self, news=NEWS):
        self.calls: list[str] = []
        self._news = news

    def news(self, symbol, name):
        self.calls.append(symbol)
        return [dict(n) for n in self._news.get(symbol, [])]

    def instrument(self, symbol):
        inst = INSTRUMENTS.get(symbol)
        return inst.as_dict() if inst else {"symbol": symbol, "name": symbol, "sector": "Other", "industry": "Other", "asset_class": "Equity"}

    def bars(self, symbols):
        return {}


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    nd._tones.clear()
    nd._tones_loaded.clear()
    nd._batches.clear()
    nd._desk.update(at=0.0, items=None, building=False)
    monkeypatch.setattr(nd, "_scores", lambda ctx: {"TCS": {"value": 68, "tone": "for", "label": "Leans positive"},
                                                     "INFY": {"value": 45, "tone": "neutral", "label": "Mixed"}})
    yield
    nd._tones.clear()
    nd._desk.update(at=0.0, items=None, building=False)


def _ctx(tmp_path, market=None, **settings) -> Ctx:
    store = MemoryStore("news-test-session-1")
    return Ctx(store=store, market=market or Market(), settings=Settings(_env_file=None, cache_dir=str(tmp_path), **settings), mode="demo")


def _hold(ctx, *symbols):
    pid = ctx.store.insert("portfolios", {"name": "Long-Term", "kind": "investment", "benchmark": "^NSEI", "cash_balance": 0, "initial_capital": 0})[0]["id"]
    for s in symbols:
        ctx.store.insert("transactions", {"portfolio_id": pid, "symbol": s, "transaction_type": "BUY", "quantity": 5, "price": 100, "fees": 0,
                                          "transaction_date": "2026-01-05", "notes": "", "source": "manual"})


# -------------------------------------------------------------------- rules
@pytest.mark.parametrize("title, tone, why", [
    ("Infosys Q2 net profit rises 13% to Rs 7,364 crore, beats estimates", "good", "Profit up"),
    ("Larsen & Toubro bags 'significant' order from Middle East", "good", "New order or contract"),
    ("Sun Pharma gets USFDA nod for generic drug", "good", "Approval received"),
    ("Brokerage upgrades ITC to buy, raises target price", "good", "Analyst upgrade"),
    ("SEBI imposes penalty on the company over disclosure lapses", "bad", "Regulatory or legal trouble"),
    ("Vodafone Idea posts net loss of Rs 7,000 crore", "bad", "Reported a loss"),
    ("Kotak Mahindra Bank CEO resigns", "bad", "Management change"),
    ("TCS shares fall 3% after weak Q2 results", "bad", "Weak results"),
    ("Stocks to watch today: TCS, Infosys, HDFC Bank", "neutral", "Market roundup"),
    ("HDFC Bank board to consider fund raise on Nov 25", "neutral", ""),
])
def test_plain_rules_mark_a_headline_and_say_why(title, tone, why):
    reading = nd.rule_tone(title)
    assert (reading["tone"], reading["why"]) == (tone, why)


def test_the_same_headline_under_two_companies_is_one_item(tmp_path):
    items = nd.collect(_ctx(tmp_path), ["TCS", "INFY"])
    watch = [i for i in items if "Stocks to watch" in i["title"]]
    assert len(watch) == 1 and watch[0]["symbols"] == ["TCS", "INFY"]
    assert all("old story" not in i["title"] for i in items)  # older than two weeks
    assert [i["published"] for i in items] == sorted((i["published"] for i in items), reverse=True)


# -------------------------------------------------------------------- AI
def test_ai_rereads_new_headlines_and_its_reading_is_kept_on_disk(tmp_path, monkeypatch):
    ctx = _ctx(tmp_path, llm_api_key="g")
    asked = []

    async def extract(settings, **kwargs):
        asked.append((settings.assistant_provider, kwargs["prompt"]))
        lines = kwargs["prompt"].splitlines()
        return {"items": [{"n": n, "tone": "good" if "deal" in line else "neutral", "impact": "high", "why": "Won a big deal"} for n, line in enumerate(lines, 1)]}, "Groq"

    monkeypatch.setattr(trade_ai, "extract", extract)
    items = nd.collect(ctx, ["TCS"])
    assert nd.read_with_ai(ctx.settings, items, {"TCS": "Tata Consultancy Services"}) == len(items)
    assert asked[0][0] == "groq,bedrock"  # the free service first
    assert "[TCS (Tata Consultancy Services)] TCS bags large deal" in asked[0][1]
    deal = next(i for i in nd.collect(ctx, ["TCS"]) if "deal" in i["title"])
    assert (deal["tone"], deal["why"], deal["by"]) == ("good", "Won a big deal", "ai")
    # Read once only: a second pass asks nothing.
    assert nd.read_with_ai(ctx.settings, items, {}) == 0 and len(asked) == 1
    # And it survives a restart.
    nd._tones.clear()
    nd._tones_loaded.clear()
    deal = next(i for i in nd.collect(ctx, ["TCS"]) if "deal" in i["title"])
    assert deal["by"] == "ai"


def test_a_headline_ai_finds_is_not_about_the_company_is_hidden(tmp_path, monkeypatch):
    namesake = {"TRENT": [
        {"title": "England draw the Test at Trent Bridge", "source": "SI", "published": ago(2), "url": ""},
        {"title": "Trent Q2 profit jumps 30%", "source": "ET", "published": ago(3), "url": ""},
    ]}
    ctx = _ctx(tmp_path, market=Market(namesake), llm_api_key="g")

    async def extract(settings, **kwargs):
        return {"items": [{"n": 1, "tone": "neutral", "impact": "low", "why": "Sports, not the company", "about": False},
                          {"n": 2, "tone": "good", "impact": "high", "why": "Profit up", "about": True}]}, "Groq"

    monkeypatch.setattr(trade_ai, "extract", extract)
    assert len(nd.collect(ctx, ["TRENT"])) == 2  # until AI has read them, the rules keep both
    nd.read_with_ai(ctx.settings, nd.collect(ctx, ["TRENT"]), {})
    assert [i["title"] for i in nd.collect(ctx, ["TRENT"])] == ["Trent Q2 profit jumps 30%"]


def test_a_known_namesake_is_dropped_without_waiting_for_ai(tmp_path):
    clash = {
        "TRENT": [{"title": "Severn Trent stock: Operating profit rises", "source": "X", "published": ago(1), "url": ""},
                  {"title": "Trent Ltd opens 20 new Zudio stores", "source": "ET", "published": ago(2), "url": ""}],
        "ITC": [{"title": "GST ITC mismatch demand quashed by Calcutta HC", "source": "X", "published": ago(1), "url": ""},
                {"title": "ITC stock: brokerage keeps Buy view", "source": "Mint", "published": ago(2), "url": ""}],
    }
    clash["HAL"] = [{"title": "Halliburton Company $HAL Stock: fund increases stake", "source": "MarketBeat", "published": ago(1), "url": ""},
                    {"title": "HAL bags order for 97 Tejas jets", "source": "ET", "published": ago(2), "url": ""}]
    titles = [i["title"] for i in nd.collect(_ctx(tmp_path, market=Market(clash)), ["TRENT", "ITC", "HAL"])]
    assert sorted(titles) == ["HAL bags order for 97 Tejas jets", "ITC stock: brokerage keeps Buy view", "Trent Ltd opens 20 new Zudio stores"]


def test_ai_reading_stops_at_the_days_allowance(tmp_path, monkeypatch):
    many = {"TCS": [{"title": f"TCS headline number {n}", "source": "X", "published": ago(n / 10), "url": ""} for n in range(100)]}
    ctx = _ctx(tmp_path, market=Market(many), llm_api_key="g", news_ai_daily_batches=1)
    calls = []

    async def extract(settings, **kwargs):
        calls.append(1)
        return {"items": []}, "Groq"

    monkeypatch.setattr(trade_ai, "extract", extract)
    nd.read_with_ai(ctx.settings, nd.collect(ctx, ["TCS"]), {}, batches=3)
    assert len(calls) == 1
    assert not nd.ai_available(_ctx(tmp_path, llm_api_key="g", news_ai_daily_batches=0).settings)


def test_without_ai_the_rules_still_mark_everything(tmp_path):
    ctx = _ctx(tmp_path)
    assert not nd.ai_available(ctx.settings)
    assert nd.read_with_ai(ctx.settings, nd.collect(ctx, ["TCS"]), {}) == 0
    assert {i["by"] for i in nd.collect(ctx, ["TCS"])} == {"rules"}


# ----------------------------------------------------------------- signals
def test_a_stock_shows_good_signs_when_news_and_score_agree(tmp_path):
    ctx = _ctx(tmp_path)
    items = nd.collect(ctx, ["TCS", "INFY", "ITC"])
    rows = {r["symbol"]: r for r in nd.signals(items, nd._scores(ctx), {}, {})}
    assert rows["TCS"]["signal"] == "good" and rows["TCS"]["good"] == 2
    assert rows["TCS"]["reason"] == "2 good and 0 bad headlines this week; long-term score 68/100."
    assert rows["INFY"]["signal"] == "bad"
    assert rows["ITC"]["signal"] == "quiet"
    assert [r["symbol"] for r in nd.signals(items, nd._scores(ctx), {}, {})][:2] == ["TCS", "INFY"]


def test_good_news_with_a_weak_score_is_not_called_good(tmp_path):
    items = nd.collect(_ctx(tmp_path), ["TCS"])
    [row] = [r for r in nd.signals(items, {"TCS": {"value": 35, "tone": "against", "label": "Weak"}}, {}, {}) if r["symbol"] == "TCS"]
    assert row["signal"] == "mixed"


# -------------------------------------------------------------------- views
def test_my_stocks_shows_only_what_i_hold_and_marks_it(tmp_path):
    ctx = _ctx(tmp_path)
    _hold(ctx, "INFY")
    out = nd.feed(ctx, scope="mine")
    assert out["held"] == ["INFY"] and out["updating"] is False
    assert all("INFY" in i["symbols"] and i["held"] for i in out["items"])
    assert out["counts"] == {"all": 3, "good": 0, "bad": 2, "neutral": 1}


def test_every_stock_is_gathered_in_the_background_and_filtered_and_sorted(tmp_path, monkeypatch):
    ctx = _ctx(tmp_path)
    monkeypatch.setattr(nd, "EQUITY_UNIVERSE", ["TCS", "INFY", "ITC"])
    first = nd.feed(ctx, scope="all")
    assert first["updating"] or first["items"]  # a request never waits for the gathering
    for _ in range(200):
        if not nd._desk["building"]:
            break
        asyncio.run(asyncio.sleep(0.01))
    out = nd.feed(ctx, scope="all")
    assert out["updating"] is False and out["total"] == 6
    assert [i["tone"] for i in nd.feed(ctx, scope="all", tone="bad")["items"]] == ["bad", "bad"]
    assert nd.feed(ctx, scope="all", sort="good")["items"][0]["tone"] == "good"
    assert nd.feed(ctx, scope="all", sort="important")["items"][0]["impact"] == "high"
    assert {i["id"] for i in nd.feed(ctx, scope="all", symbol="ITC")["items"]} == {nd.key("ITC board meets on Friday")}
    assert all("Infosys" in i["title"] or "INFY" in i["symbols"] for i in nd.feed(ctx, scope="all", q="infosys")["items"])
    assert nd.feed(ctx, scope="all", sector="IT")["counts"]["all"] == 5


def test_the_endpoint(tmp_path):
    from app.deps import get_ctx
    from app.main import app

    ctx = _ctx(tmp_path)
    _hold(ctx, "TCS")
    app.dependency_overrides[get_ctx] = lambda: ctx
    try:
        client = TestClient(app)
        body = client.get("/api/news", params={"scope": "mine", "tone": "good"}).json()
        assert [i["tone"] for i in body["items"]] == ["good", "good"] and body["stocks"][0]["symbol"] == "TCS"
        assert body["stocks"][0]["held"] is True
        assert client.get("/api/news", params={"tone": "great"}).status_code == 422
    finally:
        app.dependency_overrides.clear()
