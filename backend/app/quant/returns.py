"""Return measures: XIRR, CAGR, time-weighted return and drawdowns."""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
from scipy.optimize import brentq

TRADING_DAYS = 252


def xirr(flows: list[tuple[date, float]]) -> float | None:
    """Money-weighted annual return. Outflows negative, inflows positive."""
    flows = [(d, a) for d, a in flows if abs(a) > 1e-9]
    if len(flows) < 2:
        return None
    amounts = np.array([a for _, a in flows], dtype=float)
    if (amounts > 0).all() or (amounts < 0).all():
        return None
    start = min(d for d, _ in flows)
    years = np.array([(d - start).days / 365.0 for d, _ in flows])
    if years.max() <= 0:
        return None

    def npv(rate: float) -> float:
        return float(np.sum(amounts / np.power(1.0 + rate, years)))

    low, high = -0.9999, 10.0
    try:
        f_low, f_high = npv(low), npv(high)
        while f_low * f_high > 0 and high < 1e6:
            high *= 10
            f_high = npv(high)
        if f_low * f_high > 0:
            return None
        return float(brentq(npv, low, high, maxiter=200))
    except (ValueError, OverflowError, FloatingPointError):
        return None


def cagr(growth: float, days: float) -> float | None:
    """Annualised growth from a total growth factor (end / start)."""
    if days <= 0 or growth <= 0:
        return None
    return float(growth ** (365.0 / days) - 1)


def time_weighted_returns(value: pd.Series, inflow: pd.Series, outflow: pd.Series) -> pd.Series:
    """Daily returns with the effect of deposits and withdrawals removed.

    Money added is treated as invested at the start of the day and money
    withdrawn as leaving at the end, so a full exit still earns its final day.
    """
    base = value.shift(1).fillna(0.0) + inflow
    with np.errstate(divide="ignore", invalid="ignore"):
        r = (value + outflow) / base - 1.0
    return r.where(base > 1e-9, 0.0).replace([np.inf, -np.inf], 0.0).fillna(0.0)


def cumulative(returns: pd.Series) -> pd.Series:
    return (1.0 + returns).cumprod() - 1.0


def drawdown_series(returns: pd.Series) -> pd.Series:
    wealth = (1.0 + returns).cumprod()
    return wealth / wealth.cummax() - 1.0


def max_drawdown(returns: pd.Series) -> dict:
    """Depth and dates of the worst peak-to-trough fall."""
    if returns.empty:
        return {"value": 0.0, "peak": None, "trough": None, "recovered": None}
    wealth = (1.0 + returns).cumprod()
    dd = wealth / wealth.cummax() - 1.0
    trough = dd.idxmin()
    depth = float(dd.min())
    if depth >= 0:
        return {"value": 0.0, "peak": None, "trough": None, "recovered": None}
    peak = wealth.loc[:trough].idxmax()
    after = wealth.loc[trough:]
    back = after[after >= wealth.loc[peak]]
    return {
        "value": depth,
        "peak": peak.date().isoformat(),
        "trough": trough.date().isoformat(),
        "recovered": back.index[0].date().isoformat() if len(back) else None,
    }


def annualized_return(returns: pd.Series) -> float | None:
    if len(returns) < 2:
        return None
    growth = float((1.0 + returns).prod())
    days = (returns.index[-1] - returns.index[0]).days
    return cagr(growth, days) if days >= 30 else None


def annualized_volatility(returns: pd.Series) -> float | None:
    return float(returns.std(ddof=1) * np.sqrt(TRADING_DAYS)) if len(returns) > 2 else None
