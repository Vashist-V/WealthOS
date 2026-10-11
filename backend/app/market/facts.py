"""Company facts that outlive the place they were fetched from.

Yahoo serves price history to anyone, but refuses company fundamentals,
statements and calendars to most hosting providers' addresses. A server there
would score every company on price alone. So wherever those lookups do work
(a developer's machine), each result is mirrored into the shared
`market_facts` table, and a server that cannot fetch them starts from that
copy and keeps trying for something fresher.

Reading needs only the public key: the table holds market reference data and
nothing of any user's. Writing needs the service-role key.

    python -m app.market.facts            # look up every tracked company here and store the results
    python -m app.market.facts --cached   # store what is already in the local cache, without looking anything up
"""
from __future__ import annotations

import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from .provider import MarketData

log = logging.getLogger("wealthos.facts")

TABLE = "market_facts"
# The per-company lookups that are shared: key figures, financial statements, and results and dividend dates.
KINDS = ("info", "financials", "calendar")
PAGE = 500


def row(kind: str, symbol: str, data: object, at: float) -> dict:
    return {"symbol": symbol, "kind": kind, "data": data, "fetched_at": datetime.fromtimestamp(at, timezone.utc).isoformat()}


def read(url: str, key: str, since: str | None = None, client: httpx.Client | None = None) -> list[dict]:
    """Every stored fact, or only those stored after `since`. An empty list if the table is missing or unreachable:
    the app then works as it did without it."""
    own = client is None
    client = client or httpx.Client(timeout=30.0)
    out: list[dict] = []
    try:
        while True:
            params = {"select": "symbol,kind,data,fetched_at", "order": "symbol,kind", "limit": PAGE, "offset": len(out)}
            if since:
                params["fetched_at"] = f"gt.{since}"
            res = client.get(f"{url.rstrip('/')}/rest/v1/{TABLE}", params=params, headers={"apikey": key, "Authorization": f"Bearer {key}"})
            if res.status_code >= 400:
                log.info("Stored company facts are unavailable (HTTP %s). Has supabase/migrations/0003_market_facts.sql been run?", res.status_code)
                return out
            page = res.json()
            out.extend(page)
            if len(page) < PAGE:
                return out
    except (httpx.HTTPError, ValueError) as exc:
        log.info("Stored company facts could not be read: %s", exc)
        return out
    finally:
        if own:
            client.close()


def adopt(market: MarketData, url: str, key: str) -> int:
    """Hand the market cache every stored fact that is newer than what it holds. Returns how many it took.
    Asked again later, it reads only what has been stored since the last time."""
    taken = 0
    newest = market.facts_since
    for item in read(url, key, market.facts_since):
        try:
            stamp = str(item["fetched_at"])
            at = datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
        except (KeyError, ValueError):
            continue
        newest = max(newest or stamp, stamp)
        if item.get("kind") in KINDS and item.get("data") is not None and market.adopt(item["kind"], item["symbol"], at, item["data"]):
            taken += 1
    market.facts_since = newest
    if taken:
        log.info("Took %s stored company facts", taken)
    return taken


def write(url: str, service_key: str, rows: list[dict], client: httpx.Client | None = None) -> bool:
    """Store facts, replacing older copies of the same company and kind."""
    own = client is None
    client = client or httpx.Client(timeout=60.0)
    try:
        for i in range(0, len(rows), 100):
            res = client.post(
                f"{url.rstrip('/')}/rest/v1/{TABLE}",
                params={"on_conflict": "symbol,kind"},
                json=rows[i : i + 100],
                headers={"apikey": service_key, "Authorization": f"Bearer {service_key}", "Content-Type": "application/json",
                         "Prefer": "resolution=merge-duplicates,return=minimal"},
            )
            if res.status_code >= 400:
                log.warning("Could not store company facts (HTTP %s): %s", res.status_code, res.text[:200])
                return False
        return True
    except httpx.HTTPError as exc:
        log.warning("Could not store company facts: %s", exc)
        return False
    finally:
        if own:
            client.close()


def cached(cache_dir: str) -> list[dict]:
    """Every shared fact in the local cache, as rows ready to store."""
    from .provider import _safe
    from .universe import INSTRUMENTS

    # Files written before they recorded their symbol are matched to a tracked instrument by name.
    by_file = {_safe(symbol): symbol for symbol in INSTRUMENTS}
    rows = []
    for kind in KINDS:
        for path in sorted((Path(cache_dir) / "meta" / kind).glob("*.json")):
            try:
                saved = json.loads(path.read_text(encoding="utf-8"))
                symbol = saved.get("symbol") or by_file.get(path.stem)
                if symbol and saved["data"] is not None:
                    rows.append(row(kind, symbol, saved["data"], saved["at"]))
            except (OSError, ValueError, KeyError, AttributeError):
                continue
    return rows


def main(argv: list[str]) -> int:
    from ..config import get_settings
    from .provider import MarketData
    from .universe import EQUITY_UNIVERSE

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()
    if not (settings.supabase_url and settings.supabase_service_role_key):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first: storing facts needs the service-role key.")
        return 1
    if "--cached" not in argv:
        market = MarketData(settings.cache_dir)
        missing = 0
        for n, symbol in enumerate(EQUITY_UNIVERSE, 1):
            found = [market.refetch(kind, symbol) for kind in KINDS]
            missing += not found[0]
            print(f"{n:>3}/{len(EQUITY_UNIVERSE)} {symbol:<12} " + "  ".join(f"{kind}: {'ok' if ok else 'none'}" for kind, ok in zip(KINDS, found)), flush=True)
            time.sleep(0.4)  # stay well inside what the source allows
        if missing:
            print(f"{missing} companies returned no key figures here; their stored copies, if any, are left as they are.")
    rows = cached(settings.cache_dir)
    if not rows:
        print("Nothing in the local cache to store.")
        return 1
    done = write(settings.supabase_url, settings.supabase_service_role_key, rows)
    print(f"Stored {len(rows)} facts for {len({r['symbol'] for r in rows})} companies." if done else "Storing failed; see the message above.")
    return 0 if done else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
