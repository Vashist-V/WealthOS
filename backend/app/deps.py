"""Request context: who is calling and which store they act on."""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import threading
import time
from functools import lru_cache
from typing import Any

from fastapi import Depends, Header, HTTPException
from fastapi.responses import Response

from .config import Settings, get_settings
from .market.provider import MarketData
from .services import sample
from .services.book import Ctx
from .store.memory import DemoRegistry
from .store.supabase import SupabaseStore, verify_token

log = logging.getLogger("wealthos")
_SESSION = re.compile(r"^[A-Za-z0-9_-]{12,64}$")
_tokens: dict[str, tuple[float, dict]] = {}
_seed_lock = threading.Lock()


@lru_cache
def get_market() -> MarketData:
    return MarketData(get_settings().cache_dir)


@lru_cache
def get_registry() -> DemoRegistry:
    return DemoRegistry(get_settings().data_dir)


def _user_for(token: str, settings: Settings) -> dict:
    key = hashlib.sha256(token.encode()).hexdigest()
    hit = _tokens.get(key)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    user = verify_token(settings.supabase_url, settings.supabase_anon_key, token)
    if len(_tokens) > 5000:
        _tokens.clear()
    _tokens[key] = (time.time(), user)
    return user


def get_ctx(
    authorization: str | None = Header(default=None),
    x_demo_session: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    market: MarketData = Depends(get_market),
) -> Ctx:
    if authorization and authorization.lower().startswith("bearer "):
        if not settings.supabase_configured:
            raise HTTPException(401, "Accounts are not configured on this server")
        token = authorization[7:].strip()
        user = _user_for(token, settings)
        store = SupabaseStore(settings.supabase_url, settings.supabase_anon_key, token, user["id"])
        return Ctx(store=store, market=market, settings=settings, mode="supabase", email=user.get("email"))

    if x_demo_session and settings.demo_enabled:
        if not _SESSION.match(x_demo_session):
            raise HTTPException(400, "Invalid demo session")
        store = get_registry().get(x_demo_session)
        ctx = Ctx(store=store, market=market, settings=settings, mode="demo")
        if not store.seeded:
            with _seed_lock:
                if not store.seeded:
                    try:
                        with store.batch():
                            sample.seed(ctx)
                            store.seeded = True
                    except Exception:
                        log.exception("Could not seed the demo workspace")
                        store.clear()
                        raise HTTPException(503, "Market data is unavailable right now, so the demo could not be prepared.")
        return ctx

    raise HTTPException(401, "Sign in to continue")


def _clean(value: Any) -> Any:
    """Make a payload JSON-safe: NaN/inf become null, numpy scalars unwrap."""
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (str, int, bool)) or value is None:
        return value
    if hasattr(value, "item"):
        return _clean(value.item())
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def ok(payload: Any, status_code: int = 200) -> Response:
    body = json.dumps(_clean(payload), separators=(",", ":"), ensure_ascii=False)
    return Response(content=body, status_code=status_code, media_type="application/json")
