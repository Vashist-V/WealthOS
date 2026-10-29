"""Claude on Bedrock: which service answers first, the day's limit, follow-up questions,
model settings, and the research tools' safety rules. No network, no keys."""
import asyncio

import pytest

from app.config import Settings
from app.services import assistant, bedrock, research
from tests.test_assistant import BRIEFING


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)


@pytest.fixture(autouse=True)
def fresh():
    assistant._spent.clear()
    research._cache.clear()
    yield
    assistant._spent.clear()


# --------------------------------------------------------------- the order
def test_bedrock_answers_first_and_the_free_services_cover_for_it():
    assert assistant.providers(_settings(aws_bearer_token_bedrock="b")) == ["bedrock"]
    assert assistant.providers(_settings(aws_bearer_token_bedrock="b", gemini_api_key="g", llm_api_key="q")) == ["bedrock", "gemini", "compatible"]
    # A first-party key is still only used alone.
    assert assistant.providers(_settings(aws_bearer_token_bedrock="b", anthropic_api_key="a")) == ["bedrock"]
    assert assistant.providers(_settings(assistant_provider="groq,bedrock", aws_bearer_token_bedrock="b", llm_api_key="q")) == ["compatible", "bedrock"]


def test_past_the_days_limit_the_paid_model_steps_aside():
    settings = _settings(aws_bearer_token_bedrock="b", gemini_api_key="g", assistant_daily_limit=2)
    for _ in range(2):
        assistant._spend()
    assert assistant.providers(settings) == ["gemini"]
    assert assistant.providers(_settings(aws_bearer_token_bedrock="b", assistant_daily_limit=0)) == ["bedrock"]


def test_the_chat_names_the_model_that_answers():
    assert assistant.ai_label(_settings(aws_bearer_token_bedrock="b")) == "Claude Opus 4.5"
    assert assistant.ai_label(_settings(gemini_api_key="g")) == "Gemini"
    assert assistant.ai_label(_settings()) is None
    assert bedrock.model_label("global.anthropic.claude-sonnet-4-6") == "Claude Sonnet 4.6"
    assert bedrock.model_label("anthropic.claude-opus-4-1-20250805-v1:0") == "Claude Opus 4.1"


def test_each_model_gets_the_thinking_it_accepts():
    settings = _settings(assistant_thinking_tokens=3000)
    params, betas, cap = bedrock._shape("global.anthropic.claude-opus-4-5-20251101-v1:0", settings)
    assert params == {"thinking": {"type": "enabled", "budget_tokens": 3000}}
    assert betas == ["interleaved-thinking-2025-05-14"] and cap > 3000
    params, betas, _ = bedrock._shape("global.anthropic.claude-opus-4-5-20251101-v1:0", _settings(bedrock_effort="medium"))
    assert params["output_config"] == {"effort": "medium"} and "effort-2025-11-24" in betas
    params, betas, _ = bedrock._shape("global.anthropic.claude-sonnet-4-6", settings)
    assert params == {"thinking": {"type": "adaptive"}, "output_config": {"effort": "high"}} and betas == []
    params, betas, _ = bedrock._shape("global.anthropic.claude-opus-4-5-20251101-v1:0", _settings(assistant_thinking_tokens=0))
    assert params == {} and betas == []


def test_the_sdk_sends_an_api_version_bedrock_accepts_for_opus_4_5():
    """Anthropic's SDK 2.x sends 2026-10-21, which Bedrock rejects for models before Claude 4.7
    ("Invalid API version"). requirements.txt keeps the SDK below 2.0 for that reason."""
    from anthropic.lib.bedrock._client import DEFAULT_VERSION

    assert DEFAULT_VERSION == "bedrock-2023-05-31"


# -------------------------------------------------------------- follow-ups
def test_follow_ups_are_taken_off_the_answer_even_when_the_tag_arrives_in_pieces():
    follow = assistant.FollowUps()
    pieces = ["The stock is up **4%**.\n\n<fol", "lowups>\n- How does it compare", " with TCS?\n2. What's next?\n</followups>"]
    shown = "".join(follow.feed(p) for p in pieces)
    rest, questions = follow.finish()
    assert shown + rest == "The stock is up **4%**.\n\n"
    assert questions == ["How does it compare with TCS?", "What's next?"]


def test_text_that_only_looks_like_the_tag_is_shown():
    follow = assistant.FollowUps()
    shown = follow.feed("a < b and <fo")
    rest, questions = follow.finish()
    assert shown + rest == "a < b and <fo" and questions == []


def test_stream_answer_sends_follow_ups_as_their_own_event(monkeypatch):
    async def fake(settings, system, context, history, question, length, toolbox=None):
        yield {"type": "delta", "text": "Fine.\n<followups>\nWhy?\n</followups>"}
        yield {"type": "done", "truncated": False}

    monkeypatch.setattr(assistant, "_stream_bedrock", fake)

    async def collect():
        return [e async for e in assistant.stream_answer(_settings(aws_bearer_token_bedrock="b"), BRIEFING, [], "How am I doing?")]

    events = asyncio.run(collect())
    assert [e for e in events if e["type"] == "delta"] == [{"type": "delta", "text": "Fine.\n"}]
    assert {"type": "followups", "items": ["Why?"]} in events
    assert events[-1] == {"type": "done", "truncated": False}


# ---------------------------------------------------------------- research
def test_only_public_addresses_are_read():
    for url in ("http://127.0.0.1/admin", "http://localhost:8000/api/me", "http://169.254.169.254/latest", "http://10.0.0.5/", "file:///etc/passwd", "ftp://example.com"):
        assert not asyncio.run(research.public_address(url)), url


def test_a_page_can_only_be_read_if_a_search_returned_it_or_the_user_linked_it():
    box = research.Toolbox()
    text, failed = asyncio.run(box.run("read_page", {"url": "https://evil.example/?holdings=TCS"}))
    assert failed and "Only pages" in text
    box.allow_from_text("Can you read https://www.nseindia.com/notice for me?")
    assert "https://www.nseindia.com/notice" in box.allowed


def test_search_results_become_the_answers_sources(monkeypatch):
    async def found(query):
        return [{"title": "Infosys beats estimates", "url": "https://www.livemint.com/a", "source": "Livemint", "date": "28 Oct 2026", "snippet": "Revenue rose."},
                {"title": "Other", "url": "https://example.com/b", "source": "Example", "date": "", "snippet": ""}]

    monkeypatch.setattr(research, "search_news", found)
    box = research.Toolbox()
    text, failed = asyncio.run(box.run("search_news", {"query": "Infosys results"}))
    assert not failed and "Livemint · 28 Oct 2026 · https://www.livemint.com/a" in text
    answer = "Revenue rose ([Livemint, 28 Oct](https://www.livemint.com/a))."
    assert box.sources(answer) == [{"title": "Infosys beats estimates", "url": "https://www.livemint.com/a", "label": "Livemint"}]
    # A link the model made up is not listed as a source.
    assert box.sources("See [this](https://made.up/x).") == []


def test_article_text_is_read_without_menus_or_scripts():
    parser = research._Text()
    parser.feed(
        "<html><head><title>Results</title><meta property='og:site_name' content='Mint'></head><body>"
        "<nav><p>Home Markets Money Opinion and more links here</p></nav>"
        "<article><h1>Infosys Q2</h1><p>Infosys reported revenue growth of 8% in the quarter, ahead of estimates.</p>"
        "<script>var x = 'not text at all, should be skipped';</script></article><footer><p>Copyright notice for the whole site</p></footer></body></html>"
    )
    assert parser.parts == ["Infosys Q2", "Infosys reported revenue growth of 8% in the quarter, ahead of estimates."]
    assert parser.meta["og:site_name"] == "Mint" and parser.title == "Results"
