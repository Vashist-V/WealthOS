"""Mirror market reference data into Supabase.

When a service-role key is configured, daily bars, dividends and splits are
written to the shared `price_history`, `dividends` and `corporate_actions`
tables from a background thread. The API itself keeps reading from its
in-memory cache; this only makes the data durable and queryable in SQL.
"""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
from pathlib import Path

import httpx
import pandas as pd

log = logging.getLogger("wealthos.persist")
YEARS_KEPT = 5
CHUNK = 1000


class MarketPersistence:
    def __init__(self, url: str, service_key: str, cache_dir: str):
        self._base = f"{url.rstrip('/')}/rest/v1"
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }
        self._marks_path = Path(cache_dir) / "persisted.json"
        try:
            self._marks: dict[str, str] = json.loads(self._marks_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self._marks = {}
        self._queue: queue.Queue[tuple[str, pd.DataFrame]] = queue.Queue(maxsize=2000)
        self._sent: dict[str, tuple[pd.Timestamp, float]] = {}
        self._client = httpx.Client(timeout=30.0)
        self._paused_until = 0.0
        threading.Thread(target=self._run, name="market-persist", daemon=True).start()

    def submit(self, symbol: str, bars: pd.DataFrame) -> None:
        """Queue a symbol's full bar history. Intraday refreshes of the same
        session are throttled to one sync every 15 minutes."""
        if bars.empty or time.time() < self._paused_until:
            return
        last, now = bars.index[-1], time.time()
        seen = self._sent.get(symbol)
        if seen and seen[0] == last and now - seen[1] < 900:
            return
        self._sent[symbol] = (last, now)
        try:
            self._queue.put_nowait((symbol, bars))
        except queue.Full:
            self._sent.pop(symbol, None)  # the next refresh will carry the same rows

    def _upsert(self, table: str, rows: list[dict], conflict: str) -> bool:
        for i in range(0, len(rows), CHUNK):
            res = self._client.post(
                f"{self._base}/{table}", params={"on_conflict": conflict}, json=rows[i : i + CHUNK], headers=self._headers
            )
            if res.status_code >= 400:
                log.warning("Could not write %s (HTTP %s); pausing sync for 10 minutes. Has the schema migration been run?",
                            table, res.status_code)
                self._paused_until = time.time() + 600
                return False
        return True

    def _run(self) -> None:
        dirty = 0
        while True:
            symbol, bars = self._queue.get()
            if time.time() < self._paused_until:
                self._sent.pop(symbol, None)  # dropped; the next refresh re-submits past the watermark
                continue
            try:
                since = pd.Timestamp.now().normalize() - pd.DateOffset(years=YEARS_KEPT)
                mark = self._marks.get(symbol)
                if mark:  # re-send a few sessions so late corrections land
                    since = max(since, pd.Timestamp(mark) - pd.Timedelta(days=5))
                fresh = bars[bars.index >= since]
                if fresh.empty:
                    continue
                prices = [
                    {"symbol": symbol, "trade_date": d.date().isoformat(), "open": round(float(r.Open), 4),
                     "high": round(float(r.High), 4), "low": round(float(r.Low), 4), "close": round(float(r.Close), 4),
                     "volume": int(r.Volume)}
                    for d, r in zip(fresh.index, fresh.itertuples())
                ]
                if not self._upsert("price_history", prices, "symbol,trade_date"):
                    self._sent.pop(symbol, None)
                    continue
                paid = fresh[fresh["Dividends"] > 0]
                split = fresh[fresh["Splits"] > 0]
                if len(paid):
                    self._upsert(
                        "dividends",
                        [{"symbol": symbol, "ex_date": d.date().isoformat(), "amount": round(float(v), 4)} for d, v in paid["Dividends"].items()],
                        "symbol,ex_date",
                    )
                actions = [
                    {"symbol": symbol, "action_type": "dividend", "action_date": d.date().isoformat(), "details": {"amount": float(v)}}
                    for d, v in paid["Dividends"].items()
                ] + [
                    {"symbol": symbol, "action_type": "split", "action_date": d.date().isoformat(), "details": {"ratio": float(v)}}
                    for d, v in split["Splits"].items()
                ]
                if actions:
                    self._upsert("corporate_actions", actions, "symbol,action_type,action_date")
                self._marks[symbol] = fresh.index[-1].date().isoformat()
                dirty += 1
                if dirty >= 20 or self._queue.empty():
                    self._marks_path.write_text(json.dumps(self._marks), encoding="utf-8")
                    dirty = 0
            except Exception:
                log.exception("Persisting %s failed", symbol)
