"""The stock assistant: briefing text, data-only answers, and the Claude
stream handled against a recorded transport (no network, no API key)."""
import asyncio
import json

import anthropic
import httpx2

from app.config import Settings
from app.services import assistant

BRIEFING = {
    "symbol": "HAL", "name": "Hindustan Aeronautics", "sector": "Defence", "industry": "Aerospace", "is_index": False,
    "today": "2026-10-06", "market": "Closed", "summary": "Makes aircraft and helicopters. Serves the Indian armed forces. Also repairs engines.",
    "quote": {"price": 4816.0, "prev_close": 4680.0, "change": 136.0, "change_pct": 2.906, "high_52w": 5149.9, "low_52w": 3479.1,
              "volume": 935635.0, "avg_volume": 776000.0, "as_of": "2026-10-06"},
    "returns": {"1 week": 5.9, "1 month": -0.8, "3 months": 10.0, "6 months": 17.1, "1 year": -0.6, "3 years": 141.8, "5 years": 597.0},
    "benchmark_name": "NIFTY 50",
    "benchmark_returns": {"1 week": -0.02, "1 month": -4.6, "3 months": -6.65, "6 months": None, "1 year": -8.5, "3 years": None, "5 years": None},
    "trend": {"sma_50": 4827.1, "sma_200": 4419.3, "rsi_14": 52.0, "volatility": 0.278, "beta": 0.98, "from_high": -6.5, "from_low": 38.4,
              "drawdown": {"value": -0.21, "peak": "2026-01-05", "trough": "2026-03-23", "recovered": "2026-07-10"}, "relative_volume": 1.2},
    "fundamentals": {"market_cap": 3.22e12, "pe": 34.6, "forward_pe": 27.9, "pb": 7.8, "eps": 139.38, "roe": 0.222, "roce": 0.138,
                     "debt_to_equity": 0.0016, "profit_margin": 0.276, "revenue_growth": 0.144, "earnings_growth": 0.149,
                     "dividend_yield": 0.93, "dividend_per_share": 45.0},
    "financial_history": {"periods": ["2025-03-31", "2026-03-31"], "revenue": [30105.0, 31792.0], "net_income": [8364.0, 9116.0]},
    "events": {"dividends": [{"date": "2026-08-14", "amount": 10.0}], "splits": [{"date": "2023-09-28", "ratio": 2.0}],
               "results": "2026-11-11", "ex_dividend": None},
    "position": {"quantity": 15.0, "avg_cost": 3700.32, "invested": 55504.8, "value": 72240.0, "pnl": 16735.2, "pnl_pct": 30.15,
                 "holding_days": 765.0, "first_buy": "2024-04-08", "realized_pnl": 3200.0, "day_pnl": 2040.0},
    "weight": 8.5,
    "trades": [{"date": "2024-04-08", "type": "BUY", "quantity": 12.0, "price": 3583.55, "portfolio": "Long-Term"}],
    "journal": [{"action": "BUY", "entry_date": "2024-04-08", "entry_price": 3583.55, "status": "open", "horizon": "5+ years",
                 "thesis": "Long-term exposure to the defence sector.", "reasons": ["Strong order book"],
                 "exit_conditions": "Fundamental deterioration.", "outcome_notes": ""}],
    "alerts": [{"alert_type": "price_below", "threshold": 4330, "note": "Add zone"}],
    "watchlists": ["Defence & PSU"],
    "news": [{"title": "HAL to set up new engine line", "source": "Business Standard", "published": "2026-10-06T08:00:00+00:00", "url": "https://example.com/1"}],
}


def test_indian_number_formatting():
    assert assistant._inr(1234567) == "₹12,34,567"
    assert assistant._inr(999.5, 2) == "₹999.50"
    assert assistant._inr(-4826) == "−₹4,826"
    assert assistant._crore(3.22e12) == "₹3.22 lakh crore"
    assert assistant._crore(8.475e11) == "₹84,750 crore"


def test_briefing_carries_the_users_own_numbers_and_is_stable():
    text = assistant.render_briefing(BRIEFING)
    assert text == assistant.render_briefing(BRIEFING)  # same data, same bytes
    for expected in (
        "Holds 15 shares at an average cost of ₹3,700.32",
        "8.5% of their holdings",
        "Next results expected 11 Nov 2026",
        "Thesis: Long-term exposure to the defence sector.",
        "Business Standard: HAL to set up new engine line",
        "P/E 34.6 (forward 27.9)",
        "ROE 22.2%",
    ):
        assert expected in text


def test_suggestions_lead_with_what_is_personal():
    ids = [s["id"] for s in assistant.suggestions(BRIEFING)]
    assert ids[:2] == ["position", "thesis"]
    unheld = {**BRIEFING, "position": None, "journal": []}
    assert "position" not in [s["id"] for s in assistant.suggestions(unheld)]


def test_data_answers_use_the_briefing():
    position = assistant.data_answer(BRIEFING, "position")
    assert "₹72,240" in position and "+30.1%" in position
    # 4,816 is under the 50-day average (4,827) but over the 200-day (4,419).
    assert "pullback inside a longer rise" in assistant.data_answer(BRIEFING, "trend")
    assert "11 Nov 2026" in assistant.data_answer(BRIEFING, "events")
    assert "HAL to set up new engine line" in assistant.data_answer(BRIEFING, "news")
    assert "P/E 34.6" in assistant.data_answer(BRIEFING, "valuation")
    assert "don't hold" in assistant.data_answer({**BRIEFING, "position": None}, "position")
    assert "API key to backend/.env" in assistant.data_answer(BRIEFING, None)


def test_free_text_is_routed_to_an_intent():
    assert assistant.guess_intent("any news on this?") == "news"
    assert assistant.guess_intent("is it overvalued") == "valuation"
    assert assistant.guess_intent("how is my investment doing") == "position"
    assert assistant.guess_intent("zzz") is None


def test_history_is_normalised_into_alternating_turns():
    turns = assistant._messages(
        [
            {"role": "assistant", "content": "hello"},
            {"role": "user", "content": "a"},
            {"role": "user", "content": "b"},
            {"role": "assistant", "content": "c"},
        ],
        "next",
    )
    assert [t["role"] for t in turns] == ["user", "assistant", "user"]
    assert turns[0]["content"] == "a\n\nb" and turns[-1]["content"] == "next"


# ----------------------------------------------------------- Claude stream
def _sse(*events: dict) -> bytes:
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


def _reply(with_search: bool = True) -> bytes:
    events = [
        {
            "type": "message_start",
            "message": {
                "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [],
                "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1},
            },
        }
    ]
    index = 0
    if with_search:
        events += [
            {"type": "content_block_start", "index": 0,
             "content_block": {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {}}},
            {"type": "content_block_stop", "index": 0},
            {"type": "content_block_start", "index": 1,
             "content_block": {
                 "type": "web_search_tool_result", "tool_use_id": "srvtoolu_1",
                 "content": [{"type": "web_search_result", "url": "https://example.com/hal", "title": "HAL order win",
                              "encrypted_content": "x", "page_age": None}],
             }},
            {"type": "content_block_stop", "index": 1},
        ]
        index = 2
    events += [
        {"type": "content_block_start", "index": index, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": index, "delta": {"type": "text_delta", "text": "Your shares are "}},
        {"type": "content_block_delta", "index": index, "delta": {"type": "text_delta", "text": "up 30%."}},
        {"type": "content_block_stop", "index": index},
        {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 9}},
        {"type": "message_stop"},
    ]
    return _sse(*events)


def _run(monkeypatch, handler, **overrides) -> list[dict]:
    settings = Settings(_env_file=None, anthropic_api_key="test-key", **overrides)
    client = anthropic.AsyncAnthropic(
        api_key="test-key",
        max_retries=0,
        http_client=anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler)),
    )
    monkeypatch.setattr(assistant, "_client", lambda _settings: client)
    history = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]

    async def collect():
        return [e async for e in assistant.stream_answer(settings, BRIEFING, history, "How am I doing?")]

    return asyncio.run(collect())


def test_stream_relays_text_search_status_and_sources(monkeypatch):
    seen = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen["body"] = json.loads(request.content)
        seen["beta"] = request.headers.get("anthropic-beta", "")
        return httpx2.Response(200, content=_reply(), headers={"content-type": "text/event-stream"})

    events = _run(monkeypatch, handler)
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Your shares are up 30%."
    assert {"type": "status", "text": "Searching the web"} in events
    assert events[-2] == {"type": "sources", "items": [{"title": "HAL order win", "url": "https://example.com/hal"}]}
    assert events[-1] == {"type": "done", "truncated": False}

    body = seen["body"]
    assert body["model"] == "claude-opus-5-5" and body["stream"] is True
    assert body["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in seen["beta"]
    assert body["output_config"] == {"effort": "medium"}
    assert body["tools"][0]["type"] == "web_search_20260209"
    assert "thinking" not in body  # adaptive by default on this model
    assert body["system"][1]["text"].startswith("BRIEFING FOR Hindustan Aeronautics")
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user"]


def test_stream_drops_web_search_when_the_key_cannot_use_it(monkeypatch):
    calls = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        calls.append("tools" in body)
        if "tools" in body:
            error = {"type": "invalid_request_error", "message": "web_search is not enabled for this organization"}
            return httpx2.Response(400, json={"type": "error", "error": error})
        return httpx2.Response(200, content=_reply(with_search=False), headers={"content-type": "text/event-stream"})

    events = _run(monkeypatch, handler)
    assert calls == [True, False]
    assert events[-1]["type"] == "done"
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Your shares are up 30%."


def test_web_search_can_be_switched_off(monkeypatch):
    seen = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen["body"] = json.loads(request.content)
        return httpx2.Response(200, content=_reply(with_search=False), headers={"content-type": "text/event-stream"})

    _run(monkeypatch, handler, assistant_web_search=False)
    assert "tools" not in seen["body"]


def test_a_rejected_key_becomes_a_plain_message(monkeypatch):
    def handler(request: httpx2.Request) -> httpx2.Response:
        error = {"type": "authentication_error", "message": "invalid x-api-key"}
        return httpx2.Response(401, json={"type": "error", "error": error})

    events = _run(monkeypatch, handler)
    assert events == [{"type": "error", "message": "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in backend/.env."}]
