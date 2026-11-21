"""Keeping a free host from switching the server off, except during the night's quiet hours.

A free host (Render's free plan) switches a server off after a quarter of an
hour without visitors, and the next person then waits a minute for it to
start. A visit that comes in through the front door counts like anyone else's,
so the server visits its own public address every few minutes and keeps itself
up. During the quiet hours it stops, the host switches it off, and the free
hours that saves stay in the workspace's monthly allowance. It cannot wake
itself once it is off: the "Morning wake-up" GitHub workflow does that.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time

import httpx

log = logging.getLogger("wealthos")

# (start, end, offset from UTC), all in minutes.
Quiet = tuple[int, int, int]

_QUIET = re.compile(
    r"\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(?:(?:UTC|GMT)?\s*([+-])(\d{1,2}):?(\d{2}))?\s*", re.I
)


def parse_quiet(raw: str) -> Quiet | None:
    """Read a window like "02:00-10:00 +05:30": start, end, and the clock's offset from UTC (none means UTC).

    Blank or "off" means no quiet hours."""
    if raw.strip().lower() in ("", "0", "off", "none"):
        return None
    m = _QUIET.fullmatch(raw)
    if not m:
        log.warning("KEEP_AWAKE_QUIET_HOURS=%r not understood (want e.g. 02:00-10:00 +05:30); no quiet hours", raw)
        return None
    h1, m1, h2, m2, sign, oh, om = m.groups()
    start, end = int(h1) * 60 + int(m1), int(h2) * 60 + int(m2)
    offset = (int(oh) * 60 + int(om)) * (-1 if sign == "-" else 1) if sign else 0
    if start > 1440 or end > 1440 or start % 1440 == end % 1440:
        return None
    return start % 1440, end % 1440, offset


def describe(quiet: Quiet | None) -> str:
    if not quiet:
        return "none"
    start, end, offset = quiet
    sign = "-" if offset < 0 else "+"
    return f"{start // 60:02d}:{start % 60:02d}-{end // 60:02d}:{end % 60:02d} UTC{sign}{abs(offset) // 60:02d}:{abs(offset) % 60:02d}"


def minutes_left(quiet: Quiet | None, now: float | None = None) -> float:
    """Minutes until the quiet hours end; 0 outside them. `now` is a Unix time."""
    if not quiet:
        return 0.0
    start, end, offset = quiet
    clock = ((time.time() if now is None else now) / 60 + offset) % 1440
    length = (end - start) % 1440
    into = (clock - start) % 1440
    return length - into if into < length else 0.0


async def keep_awake(address: str, minutes: float, quiet: Quiet | None) -> None:
    """Visit `address` every `minutes`, except during the quiet hours.

    Visits start again one interval before the quiet hours end, so a server
    woken shortly before then (by a visitor or the morning wake-up) stays up
    through the hand-over instead of being switched off just as they end."""
    resting = False
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            await asyncio.sleep(minutes * 60)
            left = minutes_left(quiet)
            if left > minutes:
                if not resting:
                    log.info("Quiet hours: letting the server sleep (%.0f min to go)", left)
                    resting = True
                continue
            resting = False
            try:
                await client.get(f"{address}/api/health")
            except httpx.HTTPError as exc:
                log.info("Keep-awake visit failed: %s", exc)
