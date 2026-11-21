"""Trades read from broker screenshots or from a typed sentence.

Nothing is saved here. Each endpoint answers with proposed transactions for the
user to check and correct; the app then saves them through the ordinary import
(`POST /api/portfolios/{id}/transactions/bulk`), so the ledger's checks apply.
Screenshots are decoded in memory, read, and dropped with the request.
"""
from __future__ import annotations

import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..deps import get_ctx, ok
from ..services import metering, trade_ai, trade_entry
from ..services.book import Ctx

router = APIRouter(prefix="/api/capture", tags=["capture"])

MAX_IMAGES = 10
MAX_IMAGE_BYTES = 8 * 1024 * 1024
_KINDS = ((b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"), (b"GIF87a", "image/gif"), (b"GIF89a", "image/gif"))


class ImageIn(BaseModel):
    # Base64, with or without a "data:image/...;base64," prefix. About 11 MB of text is 8 MB of picture.
    data: str = Field(min_length=16, max_length=11_500_000)
    # Which screenshot this is part of. The app cuts a very long screenshot into overlapping parts the model
    # can read; the parts share a number and count as one screenshot.
    group: int | None = Field(default=None, ge=0, le=1000)


class ScreenshotsIn(BaseModel):
    images: list[ImageIn] = Field(min_length=1, max_length=MAX_IMAGES)
    # The portfolio the user is looking at, preferred for new buys.
    portfolio_id: str | None = Field(default=None, max_length=64)


class SentenceIn(BaseModel):
    text: str = Field(min_length=2, max_length=500)
    portfolio_id: str | None = Field(default=None, max_length=64)
    # The stock page the user is on, for "I bought 10 more at 1,500".
    symbol: str | None = Field(default=None, max_length=24)


def picture(item: ImageIn, number: int) -> trade_ai.Image:
    """The decoded picture and its type, checked from its first bytes rather than trusted from the request."""
    text = item.data.split(",", 1)[1] if item.data.startswith("data:") else item.data
    try:
        data = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, f"Screenshot {number} couldn't be read. Choose it again.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"Screenshot {number} is larger than 8 MB.")
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return trade_ai.Image(data, "image/webp")
    kind = next((kind for magic, kind in _KINDS if data.startswith(magic)), None)
    if not kind:
        raise HTTPException(415, f"Screenshot {number} isn't a picture this can read. Use PNG or JPEG screenshots.")
    return trade_ai.Image(data, kind)


@router.post("/screenshots")
async def read_screenshots(body: ScreenshotsIn, ctx: Ctx = Depends(get_ctx)):
    """The trades in screenshots of Groww (or another broker's app), as proposals to confirm."""
    images = [picture(item, number) for number, item in enumerate(body.images, 1)]
    groups = [item.group if item.group is not None else -number for number, item in enumerate(body.images, 1)]
    result = await trade_entry.read_screenshots(ctx, images, body.portfolio_id, groups)
    del images
    return ok(result)


@router.post("/sentence")
async def read_sentence(body: SentenceIn, ctx: Ctx = Depends(get_ctx)):
    """The trades a sentence reports ("I sold 2 TCS at 4,120 yesterday"), as proposals to confirm."""
    return ok(await trade_entry.read_sentence(ctx, body.text, body.portfolio_id, body.symbol, source="typed"))


@router.get("/status")
def status(ctx: Ctx = Depends(get_ctx)):
    """Whether screenshots can be read on this server, and what is left of today's allowance."""
    return ok({"screenshots": trade_ai.available(ctx.settings), "usage": metering.summary(ctx.settings, ctx.store.user_id)})
