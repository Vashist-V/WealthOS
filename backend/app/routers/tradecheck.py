"""The trade check: a buy or a sell run through every check, and its explanation as a stream."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..deps import get_ctx, ok
from ..services import assistant, tradecheck
from ..services.book import Ctx
from .assistant import _sse

router = APIRouter(prefix="/api/trade-check", tags=["trade-check"])


class Trade(BaseModel):
    symbol: str = Field(min_length=1, max_length=24)
    side: Literal["BUY", "SELL"]
    quantity: float = Field(gt=0, le=1e9)
    # The portfolio the trade would go into. Blank means the investment portfolios combined.
    portfolio_id: str | None = Field(default=None, max_length=64)


@router.post("")
def check(body: Trade, ctx: Ctx = Depends(get_ctx)):
    """Every check for one trade, with the confidence score they add up to."""
    report, _ = tradecheck.build(ctx, body.symbol, body.side, body.quantity, body.portfolio_id)
    return ok({**report, "ai": assistant.provider(ctx.settings) is not None})


@router.post("/explain")
async def explain(body: Trade, ctx: Ctx = Depends(get_ctx)):
    """The same result explained in plain words, as the stream of events the stock assistant uses.
    Without an AI key the explanation is written from the checks themselves."""
    report, briefing = await run_in_threadpool(tradecheck.build, ctx, body.symbol, body.side, body.quantity, body.portfolio_id)
    ai = assistant.provider(ctx.settings) is not None

    async def events():
        yield _sse({"type": "meta", "mode": "ai" if ai else "data"})
        if not ai:
            yield _sse({"type": "delta", "text": report["summary"]})
            yield _sse({"type": "done", "truncated": False})
            return
        context = f"{tradecheck.render(report)}\n\n{assistant.render_briefing(briefing)}"
        stream = assistant.stream_answer(
            ctx.settings, briefing, [], tradecheck.QUESTION, system=tradecheck.SYSTEM_PROMPT, context=context, length=tradecheck.LENGTH
        )
        async for event in stream:
            yield _sse(event)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
