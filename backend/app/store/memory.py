from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .base import COMPOSITE_KEYS, USER_TABLES, Filters, Row

log = logging.getLogger("wealthos.store")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _matches(row: Row, filters: Filters | None) -> bool:
    if not filters:
        return True
    for col, want in filters.items():
        have = row.get(col)
        if isinstance(want, (list, tuple, set)):
            if have not in want:
                return False
        elif have != want:
            return False
    return True


class MemoryStore:
    """In-process store for one demo workspace, written through to disk."""

    def __init__(self, session_id: str, path: Path | None = None):
        self.user_id = f"demo-{session_id}"
        self.session_id = session_id
        self.path = path
        self.seeded = False
        self._lock = threading.RLock()
        self._deferred = 0
        self._tables: dict[str, list[Row]] = {t: [] for t in USER_TABLES}
        if path and path.exists():
            try:
                saved = json.loads(path.read_text(encoding="utf-8"))
                for table, rows in saved.get("tables", {}).items():
                    self._tables[table] = rows
                self.seeded = bool(saved.get("seeded"))
            except (OSError, ValueError):
                pass

    # -- persistence -------------------------------------------------------
    def save(self) -> None:
        """Write the workspace to disk. Memory stays the source of truth, so a
        failed write is logged, not raised."""
        if not self.path or self._deferred:
            return
        with self._lock:
            payload = json.dumps({"seeded": self.seeded, "tables": self._tables})
            tmp = self.path.with_suffix(".tmp")
            for attempt in range(4):
                try:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    tmp.write_text(payload, encoding="utf-8")
                    tmp.replace(self.path)
                    return
                except OSError as exc:  # Windows briefly locks freshly written files
                    if attempt == 3:
                        log.warning("Could not persist demo workspace %s: %s", self.session_id, exc)
                    else:
                        time.sleep(0.05 * (attempt + 1))

    @contextmanager
    def batch(self):
        """Group many writes into a single save."""
        with self._lock:
            self._deferred += 1
        try:
            yield
        finally:
            with self._lock:
                self._deferred -= 1
            self.save()

    def clear(self) -> None:
        with self._lock:
            self._tables = {t: [] for t in USER_TABLES}
            self.seeded = False
            self.save()

    # -- Store interface ---------------------------------------------------
    def list(self, table: str, filters: Filters | None = None, order: str | None = None) -> list[Row]:
        with self._lock:
            rows = [dict(r) for r in self._tables.setdefault(table, []) if _matches(r, filters)]
        if order:
            for part in reversed(order.split(",")):
                col, _, direction = part.partition(".")
                rows.sort(key=lambda r: (r.get(col) is None, r.get(col) or ""), reverse=direction == "desc")
        return rows

    def get(self, table: str, id: str) -> Row | None:
        with self._lock:
            for r in self._tables.setdefault(table, []):
                if r.get("id") == id:
                    return dict(r)
        return None

    def insert(self, table: str, rows: Row | list[Row]) -> list[Row]:
        batch = [rows] if isinstance(rows, dict) else rows
        out: list[Row] = []
        with self._lock:
            for row in batch:
                new = dict(row)
                if table not in COMPOSITE_KEYS:
                    new.setdefault("id", str(uuid.uuid4()))
                new["user_id"] = self.user_id
                new.setdefault("created_at", _now())
                self._tables.setdefault(table, []).append(new)
                out.append(dict(new))
            self.save()
        return out

    def update(self, table: str, id: str, patch: Row) -> Row | None:
        with self._lock:
            for r in self._tables.setdefault(table, []):
                if r.get("id") == id:
                    r.update(patch)
                    if "updated_at" in r or table in ("portfolios", "journal_entries", "backtest_strategies"):
                        r["updated_at"] = _now()
                    self.save()
                    return dict(r)
        return None

    def delete(self, table: str, filters: Filters) -> int:
        with self._lock:
            rows = self._tables.setdefault(table, [])
            keep = [r for r in rows if not _matches(r, filters)]
            removed = len(rows) - len(keep)
            self._tables[table] = keep
            if removed:
                self.save()
        return removed

    def upsert(self, table: str, rows: list[Row], on_conflict: str) -> list[Row]:
        keys = [k.strip() for k in on_conflict.split(",")]
        out: list[Row] = []
        with self._lock:
            existing = self._tables.setdefault(table, [])
            for row in rows:
                match = next((r for r in existing if all(r.get(k) == row.get(k) for k in keys)), None)
                if match is not None:
                    match.update(row)
                    out.append(dict(match))
                else:
                    new = dict(row)
                    if table not in COMPOSITE_KEYS:
                        new.setdefault("id", str(uuid.uuid4()))
                    new["user_id"] = self.user_id
                    new.setdefault("created_at", _now())
                    existing.append(new)
                    out.append(dict(new))
            self.save()
        return out


class DemoRegistry:
    """Keeps a bounded number of demo workspaces alive."""

    def __init__(self, data_dir: str, max_sessions: int = 200):
        self.data_dir = Path(data_dir)
        self.max_sessions = max_sessions
        self._stores: dict[str, MemoryStore] = {}
        self._lock = threading.Lock()
        self._shares_path = self.data_dir / "shares.json"
        try:
            self._shares: dict[str, str] = json.loads(self._shares_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self._shares = {}

    def get(self, session_id: str) -> MemoryStore:
        with self._lock:
            store = self._stores.pop(session_id, None)
            if store is None:
                store = MemoryStore(session_id, self.data_dir / f"demo-{session_id}.json")
            self._stores[session_id] = store  # move to most-recent
            while len(self._stores) > self.max_sessions:
                self._stores.pop(next(iter(self._stores)))
            return store

    # Share links are public, so a token has to lead back to its workspace.
    def _save_shares(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._shares_path.write_text(json.dumps(self._shares), encoding="utf-8")

    def remember_share(self, token: str, session_id: str) -> None:
        with self._lock:
            self._shares[token] = session_id
            self._save_shares()

    def forget_share(self, token: str) -> None:
        with self._lock:
            if self._shares.pop(token, None) is not None:
                self._save_shares()

    def session_for_share(self, token: str) -> str | None:
        return self._shares.get(token)
