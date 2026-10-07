"""The stock assistant: starter questions and a streamed chat."""
from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..deps import get_ctx, ok
from ..services import assistant, market_assistant, pulse
from ..services.book import Ctx

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class Ask(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    # Set when the user tapped a suggested question, so it can be answered from data without a model.
    intent: str | None = Field(default=None, max_length=24)
    history: list[Turn] = Field(default_factory=list, max_length=24)


@router.get("/stock/{symbol}")
def opening(symbol: str, ctx: Ctx = Depends(get_ctx)):
    """What the chat opens with: a greeting and the suggested questions."""
    briefing = assistant.build_briefing(ctx, symbol)
    ai = assistant.provider(ctx.settings) is not None
    return ok(
        {
            "symbol": briefing["symbol"],
            "name": briefing["name"],
            "ai": ai,
            "web_search": ai and ctx.settings.assistant_web_search,
            "greeting": assistant.greeting(briefing, ai),
            "suggestions": assistant.suggestions(briefing),
        }
    )


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.post("/stock/{symbol}")
async def ask(symbol: str, body: Ask, ctx: Ctx = Depends(get_ctx)):
    """Answer one question as a stream of server-sent events:
    `meta`, then `status` / `delta` / `sources` / `search_suggestions`, ending in `done` or `error`."""
    briefing = await run_in_threadpool(assistant.build_briefing, ctx, symbol)
    ai = assistant.provider(ctx.settings) is not None

    async def events():
        yield _sse({"type": "meta", "mode": "ai" if ai else "data"})
        if not ai:
            intent = body.intent or assistant.guess_intent(body.question)
            yield _sse({"type": "delta", "text": assistant.data_answer(briefing, intent)})
            yield _sse({"type": "done", "truncated": False})
            return
        history = [turn.model_dump() for turn in body.history]
        async for event in assistant.stream_answer(ctx.settings, briefing, history, body.question):
            yield _sse(event)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------------------------------------------- market
def _market(ctx: Ctx) -> dict:
    """The pulse with the market's own headlines beside it."""
    data = pulse.snapshot(ctx)
    return {**data, "news": market_assistant.headlines(ctx, data["benchmark"])}


@router.get("/market")
def market_opening(ctx: Ctx = Depends(get_ctx)):
    """What the market chat opens with: a greeting and the suggested questions."""
    data = pulse.snapshot(ctx)
    ai = assistant.provider(ctx.settings) is not None
    return ok(
        {
            "ai": ai,
            "web_search": ai and ctx.settings.assistant_web_search,
            "greeting": market_assistant.greeting(data, ai),
            "suggestions": market_assistant.suggestions(data),
        }
    )


@router.post("/market")
async def ask_market(body: Ask, ctx: Ctx = Depends(get_ctx)):
    """Answer one question about the market as a stream of events: `meta`, then `cards` (the app's own
    figures for what was asked), then `status` / `delta` / `sources` / `search_suggestions`, ending in `done` or `error`."""
    data = await run_in_threadpool(_market, ctx)
    me = await run_in_threadpool(market_assistant.about_user, ctx)
    history = [turn.model_dump() for turn in body.history]
    focus = market_assistant.resolve(body.question, history, body.intent)
    shown = market_assistant.cards(data, focus)
    ai = assistant.provider(ctx.settings) is not None

    async def events():
        yield _sse({"type": "meta", "mode": "ai" if ai else "data"})
        if shown:
            yield _sse({"type": "cards", "items": shown})
        written = market_assistant.data_answer(data, focus, me)
        if not ai:
            yield _sse({"type": "delta", "text": written})
            yield _sse({"type": "done", "truncated": False})
            return
        context = market_assistant.render_briefing(data, me, focus, shown)
        stream = assistant.stream_answer(
            ctx.settings, {}, history, body.question, system=market_assistant.SYSTEM_PROMPT, context=context, length=market_assistant.LENGTH
        )
        spoke = False
        async for event in stream:
            spoke = spoke or event["type"] == "delta"
            if event["type"] == "error" and not spoke:
                # The model is out of reach: the figures still stand, so answer from them and say so.
                yield _sse({"type": "meta", "mode": "data"})
                yield _sse({"type": "delta", "text": written})
                yield _sse({"type": "notice", "text": f"{event['message']} This answer is written from the app's data instead."})
                yield _sse({"type": "done", "truncated": False})
                return
            yield _sse(event)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
