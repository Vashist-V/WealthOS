"""Transaction ledger maths.

Positions are derived from the full transaction history, never stored as the
source of truth. Cost uses the average-cost method; open lots are tracked FIFO
so holding periods are exact.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime

import numpy as np
import pandas as pd

EPS = 1e-9
_ORDER = {"BUY": 0, "DIVIDEND": 1, "SELL": 2}
Splits = dict[str, list[tuple[pd.Timestamp, float]]]


def to_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


@dataclass
class Lot:
    date: date
    quantity: float
    price: float


@dataclass
class Position:
    symbol: str
    quantity: float = 0.0
    cost_basis: float = 0.0  # cost of the open quantity
    realized_pnl: float = 0.0
    dividends: float = 0.0
    fees: float = 0.0
    bought: float = 0.0
    sold: float = 0.0
    first_buy: date | None = None
    last_trade: date | None = None
    lots: deque[Lot] = field(default_factory=deque)

    @property
    def avg_cost(self) -> float:
        return self.cost_basis / self.quantity if self.quantity > EPS else 0.0

    @property
    def is_open(self) -> bool:
        return self.quantity > EPS

    def holding_days(self, today: date) -> float:
        """Quantity-weighted age of the open lots."""
        total = sum(l.quantity for l in self.lots)
        if total <= EPS:
            return 0.0
        return sum(l.quantity * (today - l.date).days for l in self.lots) / total


def sort_transactions(transactions: list[dict]) -> list[dict]:
    return sorted(
        transactions,
        key=lambda t: (str(t["transaction_date"])[:10], _ORDER.get(t["transaction_type"], 3), str(t.get("created_at", ""))),
    )


def adjust_for_splits(transactions: list[dict], splits: Splits) -> list[dict]:
    """Restate trades made before a split/bonus in today's share terms.

    Market prices are split-adjusted, so a purchase entered at its real
    pre-split quantity and price has to be scaled to stay comparable.
    """
    out = []
    for t in transactions:
        factor = 1.0
        when = pd.Timestamp(to_date(t["transaction_date"]))
        for split_date, ratio in splits.get(t["symbol"], []):
            if when < split_date and ratio > 0:
                factor *= ratio
        row = dict(t)
        row["quantity"] = float(t["quantity"]) * factor
        row["price"] = float(t["price"]) / factor
        row["fees"] = float(t.get("fees") or 0)
        row["split_factor"] = factor
        out.append(row)
    return sort_transactions(out)


def build_positions(transactions: list[dict]) -> dict[str, Position]:
    """Replay split-adjusted, sorted transactions into positions."""
    positions: dict[str, Position] = {}
    for t in transactions:
        pos = positions.setdefault(t["symbol"], Position(t["symbol"]))
        qty, price, fees = float(t["quantity"]), float(t["price"]), float(t.get("fees") or 0)
        when = to_date(t["transaction_date"])
        kind = t["transaction_type"]
        if kind == "BUY":
            pos.quantity += qty
            pos.cost_basis += qty * price + fees
            pos.bought += qty * price + fees
            pos.fees += fees
            pos.lots.append(Lot(when, qty, price))
            pos.first_buy = pos.first_buy or when
            pos.last_trade = when
        elif kind == "SELL":
            sell_qty = min(qty, pos.quantity)
            avg = pos.avg_cost
            pos.realized_pnl += sell_qty * (price - avg) - fees
            pos.cost_basis -= sell_qty * avg
            pos.quantity -= sell_qty
            pos.sold += sell_qty * price - fees
            pos.fees += fees
            remaining = sell_qty
            while remaining > EPS and pos.lots:
                lot = pos.lots[0]
                used = min(lot.quantity, remaining)
                lot.quantity -= used
                remaining -= used
                if lot.quantity <= EPS:
                    pos.lots.popleft()
            if pos.quantity <= EPS:
                pos.quantity, pos.cost_basis = 0.0, 0.0
                pos.lots.clear()
                pos.first_buy = None
            pos.last_trade = when
        elif kind == "DIVIDEND":
            pos.dividends += qty * price
    return positions


def oversold(transactions: list[dict]) -> str | None:
    """Return the first symbol whose sells exceed the quantity held, if any."""
    held: dict[str, float] = {}
    for t in sort_transactions(transactions):
        qty = float(t["quantity"])
        if t["transaction_type"] == "BUY":
            held[t["symbol"]] = held.get(t["symbol"], 0.0) + qty
        elif t["transaction_type"] == "SELL":
            held[t["symbol"]] = held.get(t["symbol"], 0.0) - qty
            if held[t["symbol"]] < -1e-6:
                return t["symbol"]
    return None


def cash_flows(transactions: list[dict]) -> list[tuple[date, float]]:
    """Investor cash flows: money out is negative, money in is positive."""
    flows = []
    for t in transactions:
        qty, price, fees = float(t["quantity"]), float(t["price"]), float(t.get("fees") or 0)
        when = to_date(t["transaction_date"])
        if t["transaction_type"] == "BUY":
            flows.append((when, -(qty * price + fees)))
        elif t["transaction_type"] == "SELL":
            flows.append((when, qty * price - fees))
        elif t["transaction_type"] == "DIVIDEND":
            flows.append((when, qty * price))
    return flows


@dataclass
class Timeline:
    quantity: pd.DataFrame  # shares held per symbol per day
    cost_basis: pd.Series
    inflow: pd.Series  # cash put in on the day
    outflow: pd.Series  # cash taken out on the day
    dividends: pd.Series
    realized: pd.Series  # cumulative realised P&L


def build_timeline(transactions: list[dict], index: pd.DatetimeIndex) -> Timeline:
    """Daily holdings and cash flows aligned to a trading calendar.

    A trade dated on a non-trading day lands on the next session.
    """
    symbols = sorted({t["symbol"] for t in transactions if t["transaction_type"] != "DIVIDEND"})
    col = {s: i for i, s in enumerate(symbols)}
    n = len(index)
    qty = np.zeros((n, len(symbols)))
    basis, inflow, outflow, divs, realized = (np.zeros(n) for _ in range(5))
    state: dict[str, list[float]] = {}  # symbol -> [quantity, cost]
    for t in transactions:
        row = min(int(index.searchsorted(pd.Timestamp(to_date(t["transaction_date"])))), n - 1)
        q, price, fees = float(t["quantity"]), float(t["price"]), float(t.get("fees") or 0)
        kind = t["transaction_type"]
        if kind == "DIVIDEND":
            divs[row] += q * price
            continue
        held = state.setdefault(t["symbol"], [0.0, 0.0])
        if kind == "BUY":
            cost = q * price + fees
            held[0] += q
            held[1] += cost
            qty[row, col[t["symbol"]]] += q
            basis[row] += cost
            inflow[row] += cost
        elif kind == "SELL":
            sell = min(q, held[0])
            avg = held[1] / held[0] if held[0] > EPS else 0.0
            held[0] -= sell
            held[1] -= sell * avg
            qty[row, col[t["symbol"]]] -= sell
            basis[row] -= sell * avg
            outflow[row] += sell * price - fees
            realized[row] += sell * (price - avg) - fees
    return Timeline(
        quantity=pd.DataFrame(qty, index=index, columns=symbols).cumsum().clip(lower=0),
        cost_basis=pd.Series(basis, index=index).cumsum(),
        inflow=pd.Series(inflow, index=index),
        outflow=pd.Series(outflow, index=index),
        dividends=pd.Series(divs, index=index),
        realized=pd.Series(realized, index=index).cumsum(),
    )
