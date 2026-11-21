"""Trades read from Groww screenshots or a typed sentence: how a sentence is read,
how a stock and portfolio are matched, which fields are marked for a second look,
the daily allowances, and the endpoints. No network, no keys, no model: the model
is replaced by what it would have returned."""
import asyncio
import base64
from datetime import date

import pandas as pd
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.config import Settings
from app.market.universe import INSTRUMENTS
from app.services import assistant, book as books, metering, trade_ai, trade_entry as te
from app.services.book import Ctx
from app.store.memory import MemoryStore

TODAY = date(2026, 11, 21)  # a Saturday


# ------------------------------------------------------------------ fakes
def _bars(low: float, high: float, split: tuple[str, float] | None = None) -> pd.DataFrame:
    days = pd.bdate_range("2026-10-01", "2026-11-20")
    frame = pd.DataFrame(
        {"Open": low, "High": high, "Low": low, "Close": (low + high) / 2, "Volume": 1e6, "Dividends": 0.0, "Splits": 0.0}, index=days
    )
    if split:
        when, ratio = pd.Timestamp(split[0]), split[1]
        frame.loc[frame.index < when, ["Open", "High", "Low", "Close"]] /= ratio  # prices before a split, restated as the market shows them
        frame.loc[when, "Splits"] = ratio
    return frame


class Market:
    """The market cache, as far as reading trades needs it."""

    def __init__(self):
        self.data = {"TCS": _bars(3000, 3100), "INFY": _bars(1480, 1520), "ITC": _bars(400, 410, split=("2026-11-10", 2.0)),
                     "HDFCBANK": _bars(1600, 1700)}

    def bars(self, symbols):
        return {s: self.data[s] for s in symbols if s in self.data}

    def instrument(self, symbol):
        inst = INSTRUMENTS.get(symbol)
        return inst.as_dict() if inst else {"symbol": symbol, "name": symbol, "sector": "Other", "industry": "Other", "asset_class": "Equity"}

    def search(self, query, limit=12):
        q = query.upper()
        return [i.as_dict() for s, i in INSTRUMENTS.items() if q in s or q in i.name.upper()][:limit]


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    metering._used.clear()
    assistant._spent.clear()
    monkeypatch.setattr(books, "today_ist", lambda: TODAY)
    yield
    metering._used.clear()
    assistant._spent.clear()


def _ctx(**settings) -> Ctx:
    store = MemoryStore("trades-test-session")
    return Ctx(store=store, market=Market(), settings=Settings(_env_file=None, **settings), mode="demo")


def _portfolio(ctx: Ctx, name: str, **holdings: float) -> str:
    pid = ctx.store.insert("portfolios", {"name": name, "kind": "investment", "benchmark": "^NSEI", "cash_balance": 0, "initial_capital": 0})[0]["id"]
    for symbol, quantity in holdings.items():
        ctx.store.insert("transactions", {"portfolio_id": pid, "symbol": symbol, "transaction_type": "BUY", "quantity": quantity, "price": 1000,
                                          "fees": 0, "transaction_date": "2026-10-05", "notes": "", "source": "manual"})
    return pid


def _run(coro):
    return asyncio.run(coro)


# ----------------------------------------------------- is it a trade at all
@pytest.mark.parametrize("text", [
    "I sold 2 shares of TCS at 4,120 yesterday",
    "I bought 10 Infosys at 1,500 on 3 Nov",
    "bought 10 infy 1500",
    "record a buy of 25 ITC at 405 last friday",
    "sold half my TCS today",
])
def test_a_trade_already_made_is_recognised(text):
    assert te.looks_like_record(text)


@pytest.mark.parametrize("text", [
    "Should I buy TCS?",
    "I want to sell 10 TCS",
    "If I bought 10 TCS at 4000 what would I make",
    "I bought 3 years ago, what now",
    "Which sector did well today",
    "The stocks I bought are falling",
])
def test_questions_and_plans_are_left_to_the_assistant(text):
    assert not te.looks_like_record(text)


# ---------------------------------------------------------- reading by rules
def test_the_users_own_examples_are_read_without_a_model():
    [sale] = te.parse_sentence("I sold 2 shares of TCS at 4,120 yesterday", TODAY)
    assert sale == {"side": "SELL", "date": "2026-11-20", "price": 4120.0, "quantity": 2.0, "symbol": "TCS", "stock": "Tata Consultancy Services"}
    [buy] = te.parse_sentence("I bought 10 Infosys at 1,500 on 3 Nov", TODAY)
    assert (buy["side"], buy["symbol"], buy["quantity"], buy["price"], buy["date"]) == ("BUY", "INFY", 10, 1500, "2026-11-03")
    assert te._complete(sale) and te._complete(buy)


def test_two_trades_in_one_sentence_share_the_date_said_once():
    first, second = te.parse_sentence("Yesterday I bought 5 HDFC Bank at ₹1,650 and sold 3 ITC @ 410.5", TODAY)
    assert (first["symbol"], first["side"], first["quantity"], first["price"]) == ("HDFCBANK", "BUY", 5, 1650)
    assert (second["symbol"], second["side"], second["quantity"], second["price"]) == ("ITC", "SELL", 3, 410.5)
    assert first["date"] == second["date"] == "2026-11-20"


@pytest.mark.parametrize("text, field, value", [
    ("bought 10 infy 1500", "price", 1500),  # a second bare number is the price
    ("bought 10 infy at 1.5k", "price", 1500),
    ("bought 10 infy for 15000", "total", 15000),  # "for" a sum is the whole amount
    ("bought 10 infy for 1500 each", "price", 1500),
    ("sold 4 reliance at 1400 on 18/11", "date", "2026-11-18"),
    ("bought 2 itc at 4.5 on 12.11.2026", "price", 4.5),  # a decimal price is not a date
    ("bought 5 infy at 1500 on 25 Dec", "date", "2025-12-25"),  # a date with no year is the latest one already past
    ("bought 5 infy at 1500 last monday", "date", "2026-11-16"),
    ("bought 10 sun pharma at 1700", "symbol", "SUNPHARMA"),
])
def test_prices_totals_and_dates_are_read_as_people_write_them(text, field, value):
    [trade] = te.parse_sentence(text, TODAY)
    assert trade[field] == value
    if "sun pharma" in text:
        assert "date" not in trade  # "sun" is the company, not Sunday


def test_on_a_stock_page_a_trade_with_no_company_is_in_that_stock():
    [trade] = te.parse_sentence("I bought 10 more at 1500", TODAY, page_symbol="INFY")
    assert trade["symbol"] == "INFY" and te._complete(trade)


def test_a_named_portfolio_is_kept():
    [trade] = te.parse_sentence("sold 4 tcs at 3050 in my Long-Term portfolio", TODAY)
    assert trade["portfolio"] == "Long-Term" and trade["symbol"] == "TCS"


# ------------------------------------------------------------- matching
def test_a_stock_is_matched_by_name_symbol_or_what_the_user_holds():
    ctx = _ctx()
    assert te.resolve_symbol(ctx, "Tata Consultancy Services Ltd", "TCS", {})[:2] == ("TCS", "Tata Consultancy Services")
    assert te.resolve_symbol(ctx, "INFOSYS LIMITED", None, {})[0] == "INFY"
    assert te.resolve_symbol(ctx, "Infosys", "INFOSYS", {})[0] == "INFY"  # a wrong symbol from the model is corrected by the name
    assert te.resolve_symbol(ctx, "Acme Widgets", None, {"ACME": "Acme Widgets"}) == ("ACME", "Acme Widgets", None)
    symbol, _, why = te.resolve_symbol(ctx, "Nothing Like It", None, {})
    assert symbol is None and "Couldn't find" in why


# -------------------------------------------------------------- checking
def test_a_price_outside_the_days_range_is_marked_with_the_range():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term", TCS=10)
    [p] = te.finish(ctx, [{"stock": "TCS", "side": "SELL", "quantity": 2, "price": 30500, "date": "2026-11-18"}], today=TODAY, active=pid)
    assert "between ₹3,000.00 and ₹3,100.00" in p["check"]["price"]
    [p] = te.finish(ctx, [{"stock": "TCS", "side": "SELL", "quantity": 2, "price": 3050, "date": "2026-11-18"}], today=TODAY, active=pid)
    assert p["check"] == {}


def test_a_price_before_a_split_is_checked_in_that_days_terms():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term")
    # ITC's bars before 10 Nov are halved for the 2:1 split; a real price of 405 on 5 Nov is right.
    [p] = te.finish(ctx, [{"stock": "ITC", "side": "BUY", "quantity": 2, "price": 405, "date": "2026-11-05"}], today=TODAY, active=pid)
    assert "price" not in p["check"]


def test_a_day_the_market_was_shut_is_marked():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term")
    [p] = te.finish(ctx, [{"stock": "INFY", "side": "BUY", "quantity": 2, "price": 1500, "date": "2026-11-15"}], today=TODAY, active=pid)
    assert p["check"]["transaction_date"] == "The market was closed on Sun 15 Nov 2026. Check the date."


def test_a_weekend_is_marked_even_before_its_prices_are_in():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term")
    # The fake market's last prices are for Friday 20 Nov; Saturday 21 Nov is today.
    [p] = te.finish(ctx, [{"stock": "INFY", "side": "BUY", "quantity": 2, "price": 1500, "date": "2026-11-21"}], today=TODAY, active=pid)
    assert p["check"]["transaction_date"] == "The market was closed on Sat 21 Nov 2026. Check the date."


def test_a_missing_price_is_filled_from_the_close_and_marked():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term")
    [p] = te.finish(ctx, [{"stock": "INFY", "side": "BUY", "quantity": 2, "date": "2026-11-18"}], today=TODAY, active=pid)
    assert p["price"] == 1500 and "closing price" in p["check"]["price"]


def test_a_total_is_divided_into_a_price_per_share():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term")
    [p] = te.finish(ctx, [{"stock": "INFY", "side": "BUY", "quantity": 10, "total": 15000, "date": "2026-11-18"}], today=TODAY, active=pid)
    assert p["price"] == 1500 and "total" in p["check"]["price"]


def test_a_date_that_has_not_come_yet_means_last_year():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term")
    [p] = te.finish(ctx, [{"stock": "INFY", "side": "BUY", "quantity": 1, "price": 1500, "date": "2026-12-02"}], today=TODAY, active=pid)
    assert p["transaction_date"] == "2025-12-02" and "Check the year" in p["check"]["transaction_date"]


def test_no_date_means_today_and_says_so():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term")
    [p] = te.finish(ctx, [{"stock": "INFY", "side": "BUY", "quantity": 1, "price": 1500}], today=TODAY, active=pid)
    assert p["transaction_date"] == TODAY.isoformat() and "uses today" in p["check"]["transaction_date"]


def test_a_sale_goes_to_the_portfolio_that_holds_the_shares():
    ctx = _ctx()
    long_term = _portfolio(ctx, "Long-Term", TCS=5)
    trading = _portfolio(ctx, "Trading")
    [p] = te.finish(ctx, [{"stock": "TCS", "side": "SELL", "quantity": 2, "price": 3050, "date": "2026-11-18"}], today=TODAY, active=trading)
    assert p["portfolio_id"] == long_term and p["portfolio_name"] == "Long-Term" and p["check"] == {}
    # A new buy goes where the user is looking.
    [p] = te.finish(ctx, [{"stock": "INFY", "side": "BUY", "quantity": 2, "price": 1500, "date": "2026-11-18"}], today=TODAY, active=trading)
    assert p["portfolio_id"] == trading
    # Unless they named one.
    [p] = te.finish(ctx, [{"stock": "INFY", "side": "BUY", "quantity": 2, "price": 1500, "date": "2026-11-18", "portfolio": "long term"}],
                    today=TODAY, active=trading)
    assert p["portfolio_id"] == long_term


def test_selling_more_than_is_held_is_marked_but_a_buy_read_alongside_counts():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term", TCS=5)
    too_many, fine = te.finish(ctx, [
        {"stock": "TCS", "side": "SELL", "quantity": 9, "price": 3050, "date": "2026-11-17"},
        {"stock": "TCS", "side": "SELL", "quantity": 4, "price": 3050, "date": "2026-11-18"},
    ], today=TODAY, active=pid)
    assert too_many["check"]["quantity"] == "Long-Term holds 5 TCS; this sells 9."
    assert "quantity" not in fine["check"]  # the sale that was refused does not use up the shares
    buy, sale = te.finish(ctx, [
        {"stock": "INFY", "side": "BUY", "quantity": 10, "price": 1500, "date": "2026-11-17"},
        {"stock": "INFY", "side": "SELL", "quantity": 10, "price": 1500, "date": "2026-11-18"},
    ], today=TODAY, active=pid)
    assert "quantity" not in sale["check"]


def test_what_the_model_was_unsure_of_is_marked():
    ctx = _ctx()
    pid = _portfolio(ctx, "Long-Term")
    read = [{"stock": "INFY", "side": "BUY", "quantity": 7, "price": 1500, "date": "2026-11-18", "unsure": ["quantity", "time"]}]
    [p] = te.finish(ctx, read, today=TODAY, active=pid, source="screenshot")
    assert p["check"] == {"quantity": "The number of shares was hard to read."}  # the time only goes into the notes, so it is not asked about
    [p] = te.finish(ctx, read, today=TODAY, active=pid, source="chat")
    assert p["check"] == {"quantity": "Worked out from what you typed. Check the number of shares."}


# ------------------------------------------------------------ screenshots
def _model_returns(monkeypatch, data, model="Claude Opus 4.5"):
    calls = []

    async def extract(settings, **kwargs):
        calls.append(kwargs)
        if isinstance(data, Exception):
            raise data
        return data, model

    monkeypatch.setattr(trade_ai, "extract", extract)
    return calls


def _png() -> trade_ai.Image:
    return trade_ai.Image(b"\x89PNG\r\n\x1a\n" + b"0" * 32, "image/png")


def test_screenshots_become_trades_to_confirm(monkeypatch):
    ctx = _ctx(aws_bearer_token_bedrock="b")
    pid = _portfolio(ctx, "Long-Term", TCS=5)
    calls = _model_returns(monkeypatch, {"trades": [
        {"stock": "Tata Consultancy Services", "side": "SELL", "quantity": 2, "price": 3050, "date": "2026-11-18", "time": "10:42", "status": "executed", "screenshot": 1},
        # The same order again, in the second, overlapping screenshot.
        {"stock": "Tata Consultancy Services", "side": "SELL", "quantity": 2, "price": 3050, "date": "2026-11-18", "time": "10:42", "status": "executed", "screenshot": 2},
        {"stock": "Infosys", "side": "BUY", "quantity": 3, "price": 1500, "date": "2026-11-19", "time": "14:05", "status": "executed", "screenshot": 2},
        {"stock": "ITC", "side": "BUY", "quantity": 10, "price": 405, "date": "2026-11-19", "status": "cancelled", "screenshot": 2},
    ], "ignored": ["Axis Bluechip Fund SIP (a mutual fund)"]})
    out = _run(te.read_screenshots(ctx, [_png(), _png()], pid))
    assert [(t["symbol"], t["transaction_type"], t["quantity"]) for t in out["trades"]] == [("TCS", "SELL", 2), ("INFY", "BUY", 3)]
    assert out["trades"][0]["notes"] == "From a Groww screenshot, 10:42"
    assert out["skipped"] == ["Cancelled: Buy 10 ITC"]
    assert out["notes"][0] == "1 order appeared in more than one screenshot and is listed once."
    assert "Axis Bluechip Fund SIP (a mutual fund)" in out["notes"]
    assert out["portfolio_id"] == pid and out["read_by"] == "Claude Opus 4.5"
    assert out["usage"] == {"used": 2, "limit": 40, "left": 38}
    assert len(calls[0]["images"]) == 2 and "21 Nov 2026" in calls[0]["system"]


def test_screenshots_past_the_days_allowance_are_refused_before_any_model_is_asked(monkeypatch):
    ctx = _ctx(aws_bearer_token_bedrock="b", screenshot_daily_limit=3)
    calls = _model_returns(monkeypatch, {"trades": []})
    _run(te.read_screenshots(ctx, [_png(), _png()]))
    with pytest.raises(HTTPException) as refused:
        _run(te.read_screenshots(ctx, [_png(), _png()]))
    assert refused.value.status_code == 429 and refused.value.detail == "Only 1 screenshot left for today. Choose fewer and try again."
    assert len(calls) == 1


def test_screenshots_need_a_model():
    with pytest.raises(HTTPException) as refused:
        _run(te.read_screenshots(_ctx(), [_png()]))
    assert refused.value.status_code == 503


# --------------------------------------------------------------- sentences
def test_a_sentence_the_rules_can_read_costs_nothing(monkeypatch):
    ctx = _ctx(aws_bearer_token_bedrock="b")
    _portfolio(ctx, "Long-Term", TCS=5)
    calls = _model_returns(monkeypatch, {"trades": []})
    out = _run(te.read_sentence(ctx, "I sold 2 shares of TCS at 3,050 yesterday"))
    assert calls == [] and out["read_by"] == "WealthOS"
    [t] = out["trades"]
    assert (t["symbol"], t["transaction_type"], t["quantity"], t["price"], t["transaction_date"]) == ("TCS", "SELL", 2, 3050, "2026-11-20")
    assert out["usage"]["used"] == 0


def test_a_sentence_the_rules_cannot_finish_goes_to_the_model(monkeypatch):
    ctx = _ctx(aws_bearer_token_bedrock="b")
    _portfolio(ctx, "Long-Term", TCS=6)
    calls = _model_returns(monkeypatch, {"trades": [{"stock": "TCS", "symbol": "TCS", "side": "SELL", "quantity": 3, "date": "2026-11-20", "unsure": ["quantity"]}]})
    out = _run(te.read_sentence(ctx, "sold half my TCS yesterday"))
    assert len(calls) == 1 and "TCS (Tata Consultancy Services) 6 shares" in calls[0]["system"]
    [t] = out["trades"]
    assert t["quantity"] == 3 and t["price"] == 3050 and set(t["check"]) == {"quantity", "price"}
    assert out["read_by"] == "Claude Opus 4.5" and out["usage"]["used"] == 1


def test_when_the_model_is_out_of_reach_the_rules_answer(monkeypatch):
    ctx = _ctx(aws_bearer_token_bedrock="b")
    _portfolio(ctx, "Long-Term")
    _model_returns(monkeypatch, trade_ai.ReadError("busy"))
    out = _run(te.read_sentence(ctx, "bought 10 tata consultancy shares"))
    [t] = out["trades"]
    assert t["symbol"] == "TCS" and "price" in t["check"] and out["read_by"] == "WealthOS"


def test_a_sentence_with_no_trade_says_how_to_write_one():
    out = _run(te.read_sentence(_ctx(), "hello there"))
    assert out["trades"] == [] and "I bought 10 Infosys" in out["message"]


# ------------------------------------------------------------- the chain
def test_each_service_is_asked_in_turn_until_one_reads_it(monkeypatch):
    settings = Settings(_env_file=None, aws_bearer_token_bedrock="b", gemini_api_key="g")
    asked = []

    async def claude(*args, **kwargs):
        asked.append("bedrock")
        raise trade_ai._Failed("Claude is at its usage limit for the moment.", "quota")

    async def gemini(*args, **kwargs):
        asked.append("gemini")
        return {"trades": []}, "Gemini"

    monkeypatch.setattr(trade_ai, "_claude", claude)
    monkeypatch.setattr(trade_ai, "_gemini", gemini)
    data, model = _run(trade_ai.extract(settings, system="s", prompt="p", schema={}, images=[_png()]))
    assert asked == ["bedrock", "gemini"] and model == "Gemini" and data == {"trades": []}
    assert assistant._spent  # the paid model's try counts against its daily limit
    # Out of quota, Bedrock rests; the next reading goes straight to Gemini.
    asked.clear()
    _run(trade_ai.extract(settings, system="s", prompt="p", schema={}))
    assert asked == ["gemini"]
    assistant._resting.clear()


def test_every_setting_sent_to_claude_is_one_the_library_takes():
    """The Anthropic library is held below 2.0 for Bedrock; a setting it does not know fails every reading."""
    import inspect

    from anthropic.resources.messages import AsyncMessages

    request = trade_ai._claude_request("m", "s", te.SCREEN_SCHEMA, [{"type": "text", "text": "p"}], "record_trades")
    assert set(request) <= set(inspect.signature(AsyncMessages.create).parameters)


def test_the_shapes_are_ones_gemini_accepts():
    from google.genai import types

    for schema in (te.SCREEN_SCHEMA, te.SENTENCE_SCHEMA):
        types.GenerateContentConfig(system_instruction="s", response_mime_type="application/json", response_json_schema=schema, max_output_tokens=10, temperature=0)


def test_with_no_service_at_all_reading_is_refused_in_plain_words():
    with pytest.raises(trade_ai.ReadError, match="no AI service"):
        _run(trade_ai.extract(Settings(_env_file=None), system="s", prompt="p", schema={}))


# --------------------------------------------------------------- metering
def test_the_daily_allowance_is_per_person_and_per_feature():
    settings = Settings(_env_file=None, trade_text_daily_limit=2)
    metering.record("a", "trade_text", 2)
    with pytest.raises(HTTPException, match="used today's 2 trades typed in your words"):
        metering.check(settings, "a", "trade_text")
    metering.check(settings, "b", "trade_text")
    metering.check(Settings(_env_file=None, trade_text_daily_limit=0), "a", "trade_text", 99)  # 0 means no limit
    assert metering.summary(settings, "a")["trade_text"] == {"used": 2, "limit": 2, "left": 0}


# --------------------------------------------------------------- the API
@pytest.fixture
def api(monkeypatch):
    from app.deps import get_ctx
    from app.main import app

    ctx = _ctx(aws_bearer_token_bedrock="b")
    app.dependency_overrides[get_ctx] = lambda: ctx
    yield TestClient(app), ctx
    app.dependency_overrides.clear()


def test_the_screenshot_endpoint_reads_pictures_and_refuses_anything_else(api, monkeypatch):
    client, ctx = api
    pid = _portfolio(ctx, "Long-Term")
    _model_returns(monkeypatch, {"trades": [{"stock": "Infosys", "side": "BUY", "quantity": 3, "price": 1500, "date": "2026-11-19", "status": "executed"}]})
    png = base64.b64encode(_png().data).decode()
    answer = client.post("/api/capture/screenshots", json={"images": [{"data": f"data:image/png;base64,{png}"}], "portfolio_id": pid})
    assert answer.status_code == 200 and answer.json()["trades"][0]["symbol"] == "INFY"
    text = base64.b64encode(b"<html>not a picture</html>").decode()
    refused = client.post("/api/capture/screenshots", json={"images": [{"data": text}]})
    assert refused.status_code == 415 and "Screenshot 1" in refused.json()["detail"]


def test_saving_goes_through_the_ordinary_import_and_hands_back_what_it_made(api):
    client, ctx = api
    pid = _portfolio(ctx, "Long-Term")
    saved = client.post(f"/api/portfolios/{pid}/transactions/bulk", json={"transactions": [
        {"symbol": "INFY", "transaction_type": "BUY", "quantity": 3, "price": 1500, "fees": 0, "transaction_date": "2026-11-19", "notes": "From a Groww screenshot, 14:05"},
    ]})
    assert saved.status_code == 201
    body = saved.json()
    assert body["imported"] == 1 and len(body["ids"]) == 1
    assert ctx.store.get("transactions", body["ids"][0])["source"] == "import"


def test_a_trade_typed_into_the_market_chat_comes_back_as_a_trade_to_confirm(api, monkeypatch):
    client, ctx = api
    _portfolio(ctx, "Long-Term", TCS=5)
    _model_returns(monkeypatch, {"trades": []})
    with client.stream("POST", "/api/assistant/market", json={"question": "I sold 2 shares of TCS at 3,050 yesterday", "history": []}) as reply:
        text = "".join(reply.iter_text())
    assert '"type": "trade"' in text and '"symbol": "TCS"' in text and "Nothing is saved until you press Save." in text
