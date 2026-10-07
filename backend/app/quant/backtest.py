"""Rule-based single-instrument backtester.

A strategy is two rule groups (entry and exit). Each rule compares two
operands — indicators, price or a constant. Signals are read on the close and
filled at the next session's open, so no rule can see its own fill price.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .returns import TRADING_DAYS, cagr

OPERANDS = {
    "PRICE": "Close price",
    "SMA": "Simple moving average",
    "EMA": "Exponential moving average",
    "RSI": "Relative strength index",
    "MACD": "MACD line",
    "MACD_SIGNAL": "MACD signal line",
    "BB_UPPER": "Bollinger upper band",
    "BB_LOWER": "Bollinger lower band",
    "HIGH": "Highest high (previous N days)",
    "LOW": "Lowest low (previous N days)",
    "VOLUME": "Volume",
    "VOLUME_SMA": "Average volume",
    "VALUE": "Fixed value",
}
COMPARATORS = ("crosses_above", "crosses_below", "greater_than", "less_than")
OVERLAY = {"SMA", "EMA", "BB_UPPER", "BB_LOWER", "HIGH", "LOW"}

PRESETS = [
    {
        "key": "golden_cross",
        "name": "20 / 50 DMA crossover",
        "description": "Buy when the 20-day average crosses above the 50-day; sell on the cross back below.",
        "config": {
            "entry": {"op": "AND", "rules": [{"left": {"type": "SMA", "period": 20}, "cmp": "crosses_above", "right": {"type": "SMA", "period": 50}}]},
            "exit": {"op": "OR", "rules": [{"left": {"type": "SMA", "period": 20}, "cmp": "crosses_below", "right": {"type": "SMA", "period": 50}}]},
        },
    },
    {
        "key": "rsi_reversion",
        "name": "RSI mean reversion",
        "description": "Buy when 14-day RSI drops under 30; sell once it recovers above 60.",
        "config": {
            "entry": {"op": "AND", "rules": [{"left": {"type": "RSI", "period": 14}, "cmp": "crosses_below", "right": {"type": "VALUE", "value": 30}}]},
            "exit": {"op": "OR", "rules": [{"left": {"type": "RSI", "period": 14}, "cmp": "crosses_above", "right": {"type": "VALUE", "value": 60}}]},
            "stop_loss_pct": 10,
        },
    },
    {
        "key": "breakout",
        "name": "55-day breakout",
        "description": "Buy a close above the prior 55-day high; exit on a close under the prior 20-day low.",
        "config": {
            "entry": {"op": "AND", "rules": [{"left": {"type": "PRICE"}, "cmp": "crosses_above", "right": {"type": "HIGH", "period": 55}}]},
            "exit": {"op": "OR", "rules": [{"left": {"type": "PRICE"}, "cmp": "crosses_below", "right": {"type": "LOW", "period": 20}}]},
        },
    },
    {
        "key": "macd",
        "name": "MACD crossover",
        "description": "Buy when MACD crosses above its signal line while price is over the 200-day average.",
        "config": {
            "entry": {
                "op": "AND",
                "rules": [
                    {"left": {"type": "MACD"}, "cmp": "crosses_above", "right": {"type": "MACD_SIGNAL"}},
                    {"left": {"type": "PRICE"}, "cmp": "greater_than", "right": {"type": "SMA", "period": 200}},
                ],
            },
            "exit": {"op": "OR", "rules": [{"left": {"type": "MACD"}, "cmp": "crosses_below", "right": {"type": "MACD_SIGNAL"}}]},
        },
    },
    {
        "key": "bollinger",
        "name": "Bollinger band bounce",
        "description": "Buy a close under the lower band; sell when price reclaims the 20-day average.",
        "config": {
            "entry": {"op": "AND", "rules": [{"left": {"type": "PRICE"}, "cmp": "crosses_below", "right": {"type": "BB_LOWER", "period": 20, "mult": 2}}]},
            "exit": {"op": "OR", "rules": [{"left": {"type": "PRICE"}, "cmp": "crosses_above", "right": {"type": "SMA", "period": 20}}]},
            "stop_loss_pct": 8,
        },
    },
]


def label(operand: dict) -> str:
    kind = operand.get("type", "PRICE")
    period = int(operand.get("period") or 0)
    if kind == "VALUE":
        return f"{operand.get('value', 0):g}"
    if kind in ("PRICE", "MACD", "MACD_SIGNAL", "VOLUME"):
        return {"PRICE": "Price", "MACD": "MACD", "MACD_SIGNAL": "MACD signal", "VOLUME": "Volume"}[kind]
    if kind in ("BB_UPPER", "BB_LOWER"):
        return f"BB {'upper' if kind == 'BB_UPPER' else 'lower'} ({period}, {operand.get('mult', 2):g})"
    names = {"SMA": "SMA", "EMA": "EMA", "RSI": "RSI", "HIGH": "High", "LOW": "Low", "VOLUME_SMA": "Vol SMA"}
    return f"{names.get(kind, kind)} {period}"


def rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).where(loss > 0, 100.0).where(gain.notna())


def series_for(operand: dict, bars: pd.DataFrame) -> pd.Series:
    kind = operand.get("type", "PRICE")
    close = bars["Close"]
    period = max(int(operand.get("period") or 14), 1)
    if kind == "PRICE":
        return close
    if kind == "VALUE":
        return pd.Series(float(operand.get("value") or 0), index=bars.index)
    if kind == "SMA":
        return close.rolling(period).mean()
    if kind == "EMA":
        return close.ewm(span=period, min_periods=period, adjust=False).mean()
    if kind == "RSI":
        return rsi(close, period)
    if kind in ("MACD", "MACD_SIGNAL"):
        macd = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
        return macd if kind == "MACD" else macd.ewm(span=9, adjust=False).mean()
    if kind in ("BB_UPPER", "BB_LOWER"):
        mid, dev = close.rolling(period).mean(), close.rolling(period).std(ddof=0)
        mult = float(operand.get("mult") or 2)
        return mid + mult * dev if kind == "BB_UPPER" else mid - mult * dev
    if kind == "HIGH":
        return bars["High"].rolling(period).max().shift(1)
    if kind == "LOW":
        return bars["Low"].rolling(period).min().shift(1)
    if kind == "VOLUME":
        return bars["Volume"]
    if kind == "VOLUME_SMA":
        return bars["Volume"].rolling(period).mean()
    raise ValueError(f"Unknown operand type: {kind}")


def evaluate_rule(rule: dict, bars: pd.DataFrame) -> pd.Series:
    left, right = series_for(rule["left"], bars), series_for(rule["right"], bars)
    cmp = rule.get("cmp", "greater_than")
    if cmp == "greater_than":
        out = left > right
    elif cmp == "less_than":
        out = left < right
    elif cmp == "crosses_above":
        out = (left > right) & (left.shift(1) <= right.shift(1))
    elif cmp == "crosses_below":
        out = (left < right) & (left.shift(1) >= right.shift(1))
    else:
        raise ValueError(f"Unknown comparator: {cmp}")
    return out & left.notna() & right.notna()


def evaluate_group(group: dict | None, bars: pd.DataFrame) -> pd.Series:
    rules = (group or {}).get("rules") or []
    if not rules:
        return pd.Series(False, index=bars.index)
    signals = [evaluate_rule(r, bars) for r in rules]
    combined = signals[0]
    for s in signals[1:]:
        combined = combined & s if (group or {}).get("op", "AND") == "AND" else combined | s
    return combined


def run(bars: pd.DataFrame, config: dict, capital: float, warmup: pd.DataFrame | None = None) -> dict:
    """Backtest `config` over `bars`. `warmup` is earlier history used only to
    seed the indicators so the first tradable day already has valid values."""
    full = pd.concat([warmup, bars]) if warmup is not None and len(warmup) else bars
    entry = evaluate_group(config.get("entry"), full).reindex(bars.index).fillna(False).to_numpy()
    exit_ = evaluate_group(config.get("exit"), full).reindex(bars.index).fillna(False).to_numpy()

    fee = float(config.get("fee_pct") or 0) / 100
    size = min(max(float(config.get("position_pct") or 100), 1), 100) / 100
    stop = float(config.get("stop_loss_pct") or 0) / 100
    take = float(config.get("take_profit_pct") or 0) / 100
    trail = float(config.get("trailing_stop_pct") or 0) / 100

    opens, closes = bars["Open"].to_numpy(), bars["Close"].to_numpy()
    dates = bars.index
    n = len(bars)
    cash, shares = capital, 0.0
    equity = np.empty(n)
    trades: list[dict] = []
    open_trade: dict | None = None
    pending: str | None = None
    peak = 0.0
    days_in_market = 0

    for i in range(n):
        price = opens[i] if opens[i] > 0 else closes[i]
        if pending == "buy" and shares == 0:
            budget = cash * size
            shares = budget / (price * (1 + fee))
            cash -= budget
            open_trade = {"entry_date": dates[i], "entry_price": price, "quantity": shares, "cost": budget, "reason": pending}
            peak = price
        elif pending and pending != "buy" and shares > 0 and open_trade:
            proceeds = shares * price * (1 - fee)
            cash += proceeds
            trades.append(_close(open_trade, dates[i], price, proceeds, pending))
            shares, open_trade = 0.0, None
        pending = None

        equity[i] = cash + shares * closes[i]
        if shares > 0 and open_trade:
            days_in_market += 1
            peak = max(peak, closes[i])
            change = closes[i] / open_trade["entry_price"] - 1
            if stop and change <= -stop:
                pending = "Stop loss"
            elif take and change >= take:
                pending = "Take profit"
            elif trail and closes[i] <= peak * (1 - trail):
                pending = "Trailing stop"
            elif exit_[i]:
                pending = "Exit rule"
        elif entry[i]:
            pending = "buy"

    if shares > 0 and open_trade:  # mark the open position at the last close
        proceeds = shares * closes[-1] * (1 - fee)
        trades.append(_close(open_trade, dates[-1], closes[-1], proceeds, "Open at end"))

    curve = pd.Series(equity, index=dates)
    hold = capital * bars["Close"] / bars["Close"].iloc[0]
    return {
        "stats": _stats(curve, hold, trades, capital, days_in_market),
        "equity": {
            "dates": [d.date().isoformat() for d in dates],
            "strategy": [round(float(v), 2) for v in curve],
            "buy_hold": [round(float(v), 2) for v in hold],
            "drawdown": [round(float(v) * 100, 2) for v in (curve / curve.cummax() - 1)],
        },
        "trades": trades,
        "price": {
            "dates": [d.date().isoformat() for d in dates],
            "ohlc": [[round(float(r.Open), 2), round(float(r.Close), 2), round(float(r.Low), 2), round(float(r.High), 2)] for r in bars.itertuples()],
            "close": [round(float(v), 2) for v in closes],
            "overlays": _overlays(config, full, bars.index),
        },
    }


def _close(trade: dict, date: pd.Timestamp, price: float, proceeds: float, reason: str) -> dict:
    pnl = proceeds - trade["cost"]
    return {
        "entry_date": trade["entry_date"].date().isoformat(),
        "entry_price": round(float(trade["entry_price"]), 2),
        "exit_date": date.date().isoformat(),
        "exit_price": round(float(price), 2),
        "quantity": round(float(trade["quantity"]), 4),
        "pnl": round(float(pnl), 2),
        "return_pct": float(pnl / trade["cost"]) if trade["cost"] else 0.0,
        "holding_days": int((date - trade["entry_date"]).days),
        "exit_reason": reason,
    }


def _overlays(config: dict, full: pd.DataFrame, index: pd.DatetimeIndex) -> list[dict]:
    """Indicator lines that share the price axis, for the chart."""
    seen: dict[str, dict] = {}
    for group in (config.get("entry"), config.get("exit")):
        for rule in (group or {}).get("rules") or []:
            for operand in (rule["left"], rule["right"]):
                name = label(operand)
                if operand.get("type") in OVERLAY and name not in seen:
                    values = series_for(operand, full).reindex(index)
                    seen[name] = {"name": name, "values": [None if pd.isna(v) else round(float(v), 2) for v in values]}
    return list(seen.values())


def _stats(curve: pd.Series, hold: pd.Series, trades: list[dict], capital: float, days_in_market: int) -> dict:
    days = max((curve.index[-1] - curve.index[0]).days, 1)
    returns = curve.pct_change().dropna()
    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    gross_win, gross_loss = sum(t["pnl"] for t in wins), -sum(t["pnl"] for t in losses)
    vol = float(returns.std(ddof=1) * np.sqrt(TRADING_DAYS)) if len(returns) > 2 else None
    return {
        "initial_capital": round(capital, 2),
        "final_value": round(float(curve.iloc[-1]), 2),
        "total_return": float(curve.iloc[-1] / capital - 1),
        "cagr": cagr(float(curve.iloc[-1] / capital), days),
        "max_drawdown": float((curve / curve.cummax() - 1).min()),
        "volatility": vol,
        "sharpe": float(returns.mean() * TRADING_DAYS / vol) if vol else None,
        "total_trades": len(trades),
        "win_rate": len(wins) / len(trades) if trades else None,
        "profit_factor": gross_win / gross_loss if gross_loss > 0 else None,
        "avg_win": float(np.mean([t["return_pct"] for t in wins])) if wins else None,
        "avg_loss": float(np.mean([t["return_pct"] for t in losses])) if losses else None,
        "best_trade": max((t["return_pct"] for t in trades), default=None),
        "worst_trade": min((t["return_pct"] for t in trades), default=None),
        "avg_holding_days": float(np.mean([t["holding_days"] for t in trades])) if trades else None,
        "exposure": days_in_market / len(curve) if len(curve) else 0.0,
        "buy_hold_final": round(float(hold.iloc[-1]), 2),
        "buy_hold_return": float(hold.iloc[-1] / capital - 1),
        "buy_hold_cagr": cagr(float(hold.iloc[-1] / capital), days),
        "buy_hold_max_drawdown": float((hold / hold.cummax() - 1).min()),
    }
