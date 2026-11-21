"""News about the companies the app tracks, and about the user's own stocks, each headline marked good, bad or neutral."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from starlette.concurrency import run_in_threadpool

from ..deps import get_ctx, ok
from ..services import newsdesk
from ..services.book import Ctx

router = APIRouter(prefix="/api/news", tags=["news"])


@router.get("")
async def news(
    scope: Literal["all", "mine"] = "all",
    tone: Literal["good", "bad", "neutral"] | None = None,
    symbol: str | None = Query(default=None, max_length=24),
    sector: str | None = Query(default=None, max_length=60),
    q: str | None = Query(default=None, max_length=80),
    sort: Literal["newest", "important", "good", "bad"] = "newest",
    limit: int = Query(default=120, ge=1, le=300),
    ctx: Ctx = Depends(get_ctx),
):
    """Headlines, newest first unless asked otherwise, with each company's signal.
    `updating` is true while the news for every stock is being gathered; ask again shortly."""
    return ok(await run_in_threadpool(newsdesk.feed, ctx, scope, tone, symbol, sector, q, sort, limit))
