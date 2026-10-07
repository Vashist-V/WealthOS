"""Storage abstraction.

Every user-owned table is reached through this small interface. Two
implementations exist: `SupabaseStore` (PostgREST, called with the signed-in
user's JWT so row-level security is the access boundary) and `MemoryStore`
(the local demo workspace, persisted to a JSON file).
"""
from __future__ import annotations

from typing import Any, Protocol

Row = dict[str, Any]
Filters = dict[str, Any]  # column -> value (eq) or list of values (in)

# Tables whose primary key is not a generated `id`.
COMPOSITE_KEYS: dict[str, tuple[str, ...]] = {
    "holdings": ("portfolio_id", "symbol"),
    "portfolio_snapshots": ("portfolio_id", "snapshot_date"),
}

USER_TABLES = (
    "portfolios",
    "transactions",
    "holdings",
    "watchlists",
    "watchlist_stocks",
    "journal_entries",
    "alerts",
    "backtest_strategies",
    "backtest_results",
    "portfolio_snapshots",
    "portfolio_shares",
)


class Store(Protocol):
    user_id: str

    def list(self, table: str, filters: Filters | None = None, order: str | None = None) -> list[Row]: ...

    def get(self, table: str, id: str) -> Row | None: ...

    def insert(self, table: str, rows: Row | list[Row]) -> list[Row]: ...

    def update(self, table: str, id: str, patch: Row) -> Row | None: ...

    def delete(self, table: str, filters: Filters) -> int: ...

    def upsert(self, table: str, rows: list[Row], on_conflict: str) -> list[Row]: ...
