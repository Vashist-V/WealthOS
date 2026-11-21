"""How much of each AI feature a person has used today.

Every AI feature that costs money per use is counted here, per person and per
day (India's date), against an allowance in the settings. Today the allowances
are the same for everyone and only keep costs in check; a paid plan would raise
or remove them for the people on it, which is why each feature asks this module
first and records what it used afterwards.

The counts live in the server's memory, so a restart starts the day afresh.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from ..config import Settings

# Feature -> (setting that holds its daily allowance, what one unit is called, plural).
FEATURES: dict[str, tuple[str, str, str]] = {
    "screenshots": ("screenshot_daily_limit", "screenshot", "screenshots"),
    "trade_text": ("trade_text_daily_limit", "trade typed in your words", "trades typed in your words"),
}

# (day, user, feature) -> units used.
_used: dict[tuple[str, str, str], int] = {}


def _today() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date().isoformat()


def limit(settings: Settings, feature: str) -> int:
    return max(0, int(getattr(settings, FEATURES[feature][0])))


def used(user: str, feature: str) -> int:
    return _used.get((_today(), user, feature), 0)


def left(settings: Settings, user: str, feature: str) -> int | None:
    """Units left today, or None when there is no limit."""
    cap = limit(settings, feature)
    return None if not cap else max(0, cap - used(user, feature))


def check(settings: Settings, user: str, feature: str, units: int = 1) -> None:
    """Refuse, in plain words, when this would go past today's allowance."""
    remaining = left(settings, user, feature)
    if remaining is None or units <= remaining:
        return
    _, one, many = FEATURES[feature]
    cap = limit(settings, feature)
    if remaining == 0:
        raise HTTPException(429, f"You've used today's {cap} {many if cap != 1 else one}. It starts again at midnight.")
    raise HTTPException(429, f"Only {remaining} {many if remaining != 1 else one} left for today. Choose fewer and try again.")


def record(user: str, feature: str, units: int = 1) -> None:
    today = _today()
    for key in [k for k in _used if k[0] != today]:
        del _used[key]
    key = (today, user, feature)
    _used[key] = _used.get(key, 0) + units


def summary(settings: Settings, user: str) -> dict:
    """What the app shows: used, allowance and left today, per feature."""
    return {
        feature: {"used": used(user, feature), "limit": limit(settings, feature) or None, "left": left(settings, user, feature)}
        for feature in FEATURES
    }
