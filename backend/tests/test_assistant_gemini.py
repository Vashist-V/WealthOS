"""The assistant's Gemini path, against a stub client (no network, no key)."""
import asyncio

from google.genai import errors, types

from app.config import Settings
from app.services import assistant
from tests.test_assistant import BRIEFING


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **{"gemini_api_key": "test-key", **overrides})


def _chunk(text: str | None = None, *, thought: bool = False, finish: str | None = None, sources=(), suggestions: str | None = None):
    parts = [types.Part(text=text, thought=thought or None)] if text is not None else []
    grounding = None
    if sources or suggestions:
        grounding = types.GroundingMetadata(
            grounding_chunks=[types.GroundingChunk(web=types.GroundingChunkWeb(uri=uri, title=title)) for title, uri in sources],
            search_entry_point=types.SearchEntryPoint(rendered_content=suggestions) if suggestions else None,
        )
    candidate = types.Candidate(
        content=types.Content(role="model", parts=parts),
        finish_reason=types.FinishReason[finish] if finish else None,
        grounding_metadata=grounding,
    )
    return types.GenerateContentResponse(candidates=[candidate])


class _Stub:
    """Stands in for genai.Client: replays one scripted outcome per call."""

    def __init__(self, *outcomes):
        self.calls: list[dict] = []
        self._outcomes = list(outcomes)
        self.aio = self
        self.models = self

    async def generate_content_stream(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome

        async def stream():
            for chunk in outcome:
                yield chunk

        return stream()


def _run(monkeypatch, stub: _Stub, **overrides) -> list[dict]:
    monkeypatch.setattr(assistant, "_gemini_client", lambda _settings: stub)
    history = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]

    async def collect():
        return [e async for e in assistant.stream_answer(_settings(**overrides), BRIEFING, history, "How am I doing?")]

    return asyncio.run(collect())


def _quota() -> errors.ClientError:
    return errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}})


def test_provider_choice():
    assert assistant.provider(Settings(_env_file=None)) is None
    assert assistant.provider(_settings()) == "gemini"
    assert assistant.provider(Settings(_env_file=None, anthropic_api_key="a")) == "anthropic"
    both = {"gemini_api_key": "g", "anthropic_api_key": "a"}
    assert assistant.provider(Settings(_env_file=None, **both)) == "gemini"  # auto prefers Gemini
    assert assistant.provider(Settings(_env_file=None, assistant_provider="anthropic", **both)) == "anthropic"
    assert assistant.provider(Settings(_env_file=None, assistant_provider="gemini", anthropic_api_key="a")) is None


def test_gemini_stream_relays_text_sources_and_search_suggestions(monkeypatch):
    stub = _Stub([
        _chunk("thinking it over", thought=True),
        _chunk("Your shares are "),
        _chunk("up 30%.", finish="STOP", sources=[("economictimes.com", "https://redirect.example/1")], suggestions="<div>chips</div>"),
    ])
    events = _run(monkeypatch, stub)
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Your shares are up 30%."  # thoughts are not shown
    assert {"type": "sources", "items": [{"title": "economictimes.com", "url": "https://redirect.example/1", "label": "economictimes.com"}]} in events
    assert {"type": "search_suggestions", "html": "<div>chips</div>"} in events
    assert events[-1] == {"type": "done", "truncated": False}

    call = stub.calls[0]
    assert call["model"] == "gemini-2.5-flash"
    assert call["config"].tools[0].google_search is not None
    assert assistant.render_briefing(BRIEFING) in call["config"].system_instruction
    assert [c.role for c in call["contents"]] == ["user", "model", "user"]
    assert call["contents"][-1].parts[0].text == "How am I doing?"


def test_gemini_steps_down_when_search_quota_is_spent(monkeypatch):
    stub = _Stub(_quota(), [_chunk("From the briefing alone.", finish="STOP")])
    events = _run(monkeypatch, stub)
    assert [(c["model"], bool(c["config"].tools)) for c in stub.calls] == [("gemini-2.5-flash", True), ("gemini-2.5-flash", False)]
    assert events[-1]["type"] == "done"
    assert events[0] == {"type": "delta", "text": "From the briefing alone."}


def test_gemini_falls_back_to_another_model(monkeypatch):
    busy = errors.ServerError(503, {"error": {"code": 503, "message": "overloaded", "status": "UNAVAILABLE"}})
    stub = _Stub(_quota(), busy, [_chunk("Answered by the fallback.", finish="STOP")])
    events = _run(monkeypatch, stub)
    assert [c["model"] for c in stub.calls] == ["gemini-2.5-flash", "gemini-2.5-flash", "gemini-3.5-flash"]
    assert events[-1] == {"type": "done", "truncated": False}


def test_gemini_reports_exhausted_quota_plainly(monkeypatch):
    events = _run(monkeypatch, _Stub(_quota(), _quota(), _quota()))
    assert events == [{"type": "error", "message": "The free Gemini quota is used up for now. Try again in a minute."}]


def test_gemini_rejected_key(monkeypatch):
    bad = errors.ClientError(400, {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT"}})
    events = _run(monkeypatch, _Stub(bad))
    assert events == [{"type": "error", "message": "The Gemini API key was rejected. Check GEMINI_API_KEY in backend/.env."}]


def test_gemini_without_web_search_sends_no_tools(monkeypatch):
    stub = _Stub([_chunk("ok", finish="MAX_TOKENS")])
    events = _run(monkeypatch, stub, assistant_web_search=False)
    assert not stub.calls[0]["config"].tools
    assert events[-1] == {"type": "done", "truncated": True}


def test_gemini_safety_block_is_a_plain_message(monkeypatch):
    events = _run(monkeypatch, _Stub([_chunk(finish="SAFETY")]))
    assert events == [{"type": "error", "message": "The assistant declined to answer that. Try asking it another way."}]
