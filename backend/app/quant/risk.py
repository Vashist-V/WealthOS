"""Portfolio risk analytics on daily return series."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from .returns import TRADING_DAYS, annualized_return, annualized_volatility, drawdown_series, max_drawdown


def weighted_returns(returns: pd.DataFrame, weights: pd.Series) -> pd.Series:
    """Portfolio return per day, re-normalising weights over the names that
    actually traded (so a recent listing does not drag earlier days to zero)."""
    w = weights.reindex(returns.columns).fillna(0.0)
    live = returns.notna().mul(w, axis=1).sum(axis=1)
    total = returns.mul(w, axis=1).sum(axis=1, min_count=1)
    return (total / live.where(live > 1e-9)).dropna()


def beta_alpha(portfolio: pd.Series, benchmark: pd.Series, risk_free: float) -> tuple[float | None, float | None]:
    joined = pd.concat([portfolio, benchmark], axis=1, join="inner").dropna()
    if len(joined) < 20:
        return None, None
    p, b = joined.iloc[:, 0], joined.iloc[:, 1]
    var_b = float(b.var(ddof=1))
    if var_b <= 0:
        return None, None
    beta = float(p.cov(b) / var_b)
    daily_rf = risk_free / TRADING_DAYS
    alpha = float(((p.mean() - daily_rf) - beta * (b.mean() - daily_rf)) * TRADING_DAYS)
    return beta, alpha


def sharpe(returns: pd.Series, risk_free: float) -> float | None:
    vol = annualized_volatility(returns)
    if not vol:
        return None
    return float((returns.mean() * TRADING_DAYS - risk_free) / vol)


def sortino(returns: pd.Series, risk_free: float) -> float | None:
    if len(returns) < 3:
        return None
    daily_rf = risk_free / TRADING_DAYS
    downside = np.minimum(returns - daily_rf, 0.0)
    dev = float(np.sqrt((downside**2).mean()) * np.sqrt(TRADING_DAYS))
    return float((returns.mean() * TRADING_DAYS - risk_free) / dev) if dev > 0 else None


def value_at_risk(returns: pd.Series, level: float) -> dict:
    """One-day VaR and CVaR as positive loss fractions."""
    if len(returns) < 20:
        return {"historical": None, "parametric": None, "cvar": None}
    q = float(np.percentile(returns, (1 - level) * 100))
    tail = returns[returns <= q]
    mu, sigma = float(returns.mean()), float(returns.std(ddof=1))
    return {
        "historical": max(-q, 0.0),
        "parametric": max(-(mu + sigma * stats.norm.ppf(1 - level)), 0.0),
        "cvar": max(-float(tail.mean()), 0.0) if len(tail) else max(-q, 0.0),
    }


def risk_contributions(returns: pd.DataFrame, weights: pd.Series) -> tuple[pd.Series, float, float]:
    """Share of portfolio variance attributable to each holding.

    Returns (contribution fractions, annualised portfolio variance,
    diversification ratio).
    """
    cols = [c for c in returns.columns if weights.get(c, 0) > 0]
    if not cols:
        return pd.Series(dtype=float), 0.0, 1.0
    w = weights.reindex(cols).fillna(0.0)
    w = w / w.sum()
    cov = returns[cols].cov(min_periods=20).fillna(0.0) * TRADING_DAYS
    marginal = cov.values @ w.values
    variance = float(w.values @ marginal)
    if variance <= 0:
        return pd.Series(0.0, index=cols), 0.0, 1.0
    contrib = pd.Series(w.values * marginal / variance, index=cols)
    weighted_vol = float((w.values * np.sqrt(np.diag(cov.values))).sum())
    return contrib, variance, weighted_vol / np.sqrt(variance)


def correlation(returns: pd.DataFrame) -> dict:
    corr = returns.corr(min_periods=30)
    symbols = list(corr.columns)
    pairs = []
    for i, a in enumerate(symbols):
        for b in symbols[i + 1 :]:
            v = corr.loc[a, b]
            if pd.notna(v):
                pairs.append({"a": a, "b": b, "value": float(v)})
    pairs.sort(key=lambda p: p["value"])
    return {
        "symbols": symbols,
        "matrix": [[None if pd.isna(v) else round(float(v), 3) for v in row] for row in corr.values],
        "average": float(np.mean([p["value"] for p in pairs])) if pairs else None,
        "highest": pairs[-3:][::-1],
        "lowest": pairs[:3],
    }


def histogram(returns: pd.Series, bins: int = 31) -> dict:
    if returns.empty:
        return {"edges": [], "counts": []}
    limit = float(max(abs(returns.quantile(0.005)), abs(returns.quantile(0.995)), 0.01))
    counts, edges = np.histogram(returns.clip(-limit, limit), bins=bins, range=(-limit, limit))
    return {"edges": [round(float(e) * 100, 3) for e in edges], "counts": [int(c) for c in counts]}


def summarize(returns: pd.Series, benchmark: pd.Series, risk_free: float) -> dict:
    """Headline risk numbers for a daily return series against a benchmark."""
    beta, alpha = beta_alpha(returns, benchmark, risk_free)
    joined = pd.concat([returns, benchmark], axis=1, join="inner").dropna()
    tracking = (
        float((joined.iloc[:, 0] - joined.iloc[:, 1]).std(ddof=1) * np.sqrt(TRADING_DAYS)) if len(joined) > 20 else None
    )
    up = joined[joined.iloc[:, 1] > 0]
    down = joined[joined.iloc[:, 1] < 0]
    return {
        "annual_return": annualized_return(returns),
        "volatility": annualized_volatility(returns),
        "benchmark_volatility": annualized_volatility(benchmark),
        "benchmark_return": annualized_return(benchmark),
        "beta": beta,
        "alpha": alpha,
        "sharpe": sharpe(returns, risk_free),
        "sortino": sortino(returns, risk_free),
        "max_drawdown": max_drawdown(returns),
        "benchmark_max_drawdown": max_drawdown(benchmark)["value"],
        "tracking_error": tracking,
        "var_95": value_at_risk(returns, 0.95),
        "var_99": value_at_risk(returns, 0.99),
        "best_day": float(returns.max()) if len(returns) else None,
        "worst_day": float(returns.min()) if len(returns) else None,
        "positive_days": float((returns > 0).mean()) if len(returns) else None,
        "up_capture": float(up.iloc[:, 0].mean() / up.iloc[:, 1].mean()) if len(up) > 5 else None,
        "down_capture": float(down.iloc[:, 0].mean() / down.iloc[:, 1].mean()) if len(down) > 5 else None,
        "skew": float(stats.skew(returns)) if len(returns) > 20 else None,
        "kurtosis": float(stats.kurtosis(returns)) if len(returns) > 20 else None,
        "observations": int(len(returns)),
    }


def rolling_volatility(returns: pd.Series, window: int = 30) -> pd.Series:
    return (returns.rolling(window).std(ddof=1) * np.sqrt(TRADING_DAYS)).dropna()


__all__ = [
    "beta_alpha",
    "correlation",
    "drawdown_series",
    "histogram",
    "risk_contributions",
    "rolling_volatility",
    "sharpe",
    "sortino",
    "summarize",
    "value_at_risk",
    "weighted_returns",
]
