"""Choosing between model services, and the OpenAI-compatible one (Groq and the
like) against a recorded transport. No network, no keys."""
import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.services import assistant
from tests.test_assistant import BRIEFING


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)


@pytest.fixture(autouse=True)
def rested():
    """No service starts a test already passed over."""
    assistant._resting.clear()
    yield
    assistant._resting.clear()


def _ask(settings: Settings) -> list[dict]:
    async def collect():
        return [e async for e in assistant.stream_answer(settings, BRIEFING, [], "How am I doing?")]

    return asyncio.run(collect())


def _scripted(monkeypatch, **outcomes):
    """Replace each service with one that replays the given events, and record the order they were asked in."""
    asked: list[str] = []

    def make(name):
        async def stream(settings, system, context, history, question, length):
            asked.append(name)
            for event in outcomes[name]:
                yield dict(event)

        return stream

    for name, attribute in (("gemini", "_stream_gemini"), ("compatible", "_stream_compatible"), ("anthropic", "_stream_claude")):
        if name in outcomes:
            monkeypatch.setattr(assistant, attribute, make(name))
    return asked


ANSWER = [{"type": "delta", "text": "Fine."}, {"type": "done", "truncated": False}]
NO_QUOTA = [{"type": "error", "message": "The free Gemini quota is used up for now. Try again in a minute.", "reason": "quota"}]


# ------------------------------------------------------------ which services
def test_auto_prefers_the_free_services_and_never_adds_a_paid_one():
    assert assistant.providers(_settings()) == []
    assert assistant.providers(_settings(gemini_api_key="g")) == ["gemini"]
    assert assistant.providers(_settings(llm_api_key="q")) == ["compatible"]
    assert assistant.providers(_settings(gemini_api_key="g", llm_api_key="q")) == ["gemini", "compatible"]
    # A Claude key is paid: in auto it is used only when it is the only key.
    assert assistant.providers(_settings(anthropic_api_key="a")) == ["anthropic"]
    assert assistant.providers(_settings(gemini_api_key="g", llm_api_key="q", anthropic_api_key="a")) == ["gemini", "compatible"]


def test_naming_services_uses_exactly_those_in_that_order():
    keys = {"gemini_api_key": "g", "llm_api_key": "q", "anthropic_api_key": "a"}
    assert assistant.providers(_settings(assistant_provider="groq,gemini", **keys)) == ["compatible", "gemini"]
    assert assistant.providers(_settings(assistant_provider="anthropic", **keys)) == ["anthropic"]
    assert assistant.providers(_settings(assistant_provider="gemini", **keys)) == ["gemini"]
    # A named service with no key is left out rather than failing every question.
    assert assistant.providers(_settings(assistant_provider="claude, groq", llm_api_key="q")) == ["compatible"]
    assert assistant.provider(_settings(assistant_provider="groq,gemini", **keys)) == "compatible"
    assert assistant.provider(_settings()) is None


def test_the_groq_name_for_the_key_is_accepted(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "from-groq-name")
    assert Settings(_env_file=None).llm_api_key == "from-groq-name"


# ------------------------------------------------------------- taking over
def test_the_second_service_answers_when_the_first_is_out_of_quota(monkeypatch):
    asked = _scripted(monkeypatch, gemini=NO_QUOTA, compatible=ANSWER)
    events = _ask(_settings(gemini_api_key="g", llm_api_key="q"))
    assert asked == ["gemini", "compatible"]
    # The first service's error is not shown: the user just gets the answer.
    assert events == ANSWER


def test_a_service_out_of_quota_is_passed_over_for_a_while(monkeypatch):
    asked = _scripted(monkeypatch, gemini=NO_QUOTA, compatible=ANSWER)
    settings = _settings(gemini_api_key="g", llm_api_key="q")
    _ask(settings)
    _ask(settings)
    assert asked == ["gemini", "compatible", "compatible"]


def test_when_every_service_fails_the_last_error_is_reported_without_internal_fields(monkeypatch):
    busy = [{"type": "error", "message": "Groq is busy right now. Try again shortly.", "reason": "busy"}]
    _scripted(monkeypatch, gemini=NO_QUOTA, compatible=busy)
    events = _ask(_settings(gemini_api_key="g", llm_api_key="q"))
    assert events == [{"type": "error", "message": "Groq is busy right now. Try again shortly."}]


def test_a_failure_part_way_through_an_answer_is_not_papered_over(monkeypatch):
    broken = [{"type": "delta", "text": "The trend is"}, {"type": "error", "message": "Gemini is busy right now. Try again shortly.", "reason": "busy"}]
    asked = _scripted(monkeypatch, gemini=broken, compatible=ANSWER)
    events = _ask(_settings(gemini_api_key="g", llm_api_key="q"))
    # Text is already on screen, so a second service starting over would garble it.
    assert asked == ["gemini"]
    assert [e["type"] for e in events] == ["delta", "error"]


# ------------------------------------------------- the OpenAI-compatible API
def _sse(*chunks: dict) -> str:
    return "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"


def _groq(monkeypatch, handler, **overrides) -> tuple[list[dict], list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    monkeypatch.setattr(assistant, "_http", lambda: httpx.AsyncClient(transport=httpx.MockTransport(record)))
    return _ask(_settings(llm_api_key="test-key", **overrides)), requests


def test_compatible_service_streams_the_answer(monkeypatch):
    body = _sse(
        {"choices": [{"delta": {"role": "assistant", "reasoning": "thinking"}}]},
        {"choices": [{"delta": {"content": "You are up "}}]},
        {"choices": [{"delta": {"content": "12%."}, "finish_reason": "stop"}]},
    )
    events, requests = _groq(monkeypatch, lambda request: httpx.Response(200, text=body, headers={"Content-Type": "text/event-stream"}))
    # The model's private reasoning is not part of the answer.
    assert events == [{"type": "delta", "text": "You are up "}, {"type": "delta", "text": "12%."}, {"type": "done", "truncated": False}]
    sent = json.loads(requests[0].content)
    assert str(requests[0].url) == "https://api.groq.com/openai/v1/chat/completions"
    assert requests[0].headers["Authorization"] == "Bearer test-key"
    assert sent["model"] == "openai/gpt-oss-120b" and sent["stream"] is True
    assert sent["reasoning_effort"] == "low"
    assert sent["messages"][0]["role"] == "system" and "HAL" in sent["messages"][0]["content"]
    assert sent["messages"][-1] == {"role": "user", "content": "How am I doing?"}


def test_compatible_service_can_be_pointed_elsewhere(monkeypatch):
    body = _sse({"choices": [{"delta": {"content": "Hello."}, "finish_reason": "length"}]})
    events, requests = _groq(
        monkeypatch, lambda request: httpx.Response(200, text=body),
        llm_base_url="https://api.cerebras.ai/v1/", llm_model="llama-3.3-70b",
    )
    assert str(requests[0].url) == "https://api.cerebras.ai/v1/chat/completions"
    assert "reasoning_effort" not in json.loads(requests[0].content)
    assert events[-1] == {"type": "done", "truncated": True}


@pytest.mark.parametrize(
    ("status", "message"),
    [
        (401, "The Groq API key was rejected. Check LLM_API_KEY."),
        (429, "The free Groq quota is used up for now. Try again in a minute."),
        (413, "This question carries more data than Groq's plan accepts at once."),
        (503, "Groq is busy right now. Try again shortly."),
    ],
)
def test_compatible_service_errors_are_put_in_plain_words(monkeypatch, status, message):
    events, _ = _groq(monkeypatch, lambda request: httpx.Response(status, json={"error": {"message": "nope"}}))
    assert events == [{"type": "error", "message": message}]


def test_service_is_named_from_its_address():
    assert assistant.service_name("https://api.groq.com/openai/v1") == "Groq"
    assert assistant.service_name("https://openrouter.ai/api/v1") == "OpenRouter"
    assert assistant.service_name("https://llm.example.org/v1") == "llm.example.org"
