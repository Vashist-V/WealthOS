"""The lab: what-if scenarios, Monte Carlo simulation and backtesting."""
from __future__ import annotations

from datetime import date
from typing import Any, Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..deps import get_ctx, ok
from ..market.universe import normalize
from ..quant import backtest as bt
from ..quant import simulate
from ..services import analytics, book as books
from ..services.book import Ctx

router = APIRouter(prefix="/api", tags=["lab"])


# ------------------------------------------------------------ projections
class Scenario(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    initial: float = Field(ge=0, le=1e12)
    monthly: float = Field(ge=0, le=1e10)
    years: int = Field(ge=1, le=50)
    annual_return: float = Field(ge=-0.5, le=1.0)
    step_up: float = Field(default=0, ge=0, le=0.5)


class ProjectionIn(BaseModel):
    scenarios: list[Scenario] = Field(min_length=1, max_length=6)


@router.post("/simulate/projection")
def projection(body: ProjectionIn, ctx: Ctx = Depends(get_ctx)):
    return ok(
        {
            "scenarios": [
                {**s.model_dump(), **simulate.projection(s.initial, s.monthly, s.years, s.annual_return, s.step_up)}
                for s in body.scenarios
            ]
        }
    )


# ----------------------------------------------------------------- shocks
class ShockIn(BaseModel):
    portfolio_id: str
    kind: Literal["market", "largest", "sector", "custom"]
    magnitude: float = Field(default=-0.2, ge=-1, le=2)
    sector: str | None = None
    use_beta: bool = True
    shocks: dict[str, float] = Field(default_factory=dict)


@router.post("/simulate/shock")
def shock(body: ShockIn, ctx: Ctx = Depends(get_ctx)):
    book = books.load_book(ctx, body.portfolio_id)
    params = analytics.portfolio_parameters(ctx, book, "1Y")
    rows = params["rows"]
    if not rows:
        raise HTTPException(422, "This portfolio has no priced holdings to shock.")
    betas = params["betas"]
    if body.kind == "market":
        moves = {r["symbol"]: body.magnitude * (betas.get(r["symbol"], 1.0) if body.use_beta else 1.0) for r in rows}
        title = f"Market moves {body.magnitude * 100:+.0f}%"
        note = (
            "Each holding moves by the market change multiplied by its one-year beta."
            if body.use_beta else "Every holding moves by the same percentage."
        )
    elif body.kind == "largest":
        top = max(rows, key=lambda r: r["value"])
        moves = {top["symbol"]: body.magnitude}
        title = f"{top['symbol']} moves {body.magnitude * 100:+.0f}%"
        note = "Only the largest holding moves; everything else is unchanged."
    elif body.kind == "sector":
        if not body.sector:
            raise HTTPException(422, "Choose a sector.")
        moves = {r["symbol"]: body.magnitude for r in rows if r["sector"] == body.sector}
        title = f"{body.sector} moves {body.magnitude * 100:+.0f}%"
        note = f"Only holdings in {body.sector} move."
    else:
        moves = {normalize(s): v for s, v in body.shocks.items()}
        title, note = "Custom scenario", "Each holding moves by the percentage you set."
    result = simulate.apply_shocks(rows, moves)
    return ok({**result, "title": title, "note": note, "betas": betas, "sectors": sorted({r["sector"] for r in rows})})


# ------------------------------------------------------------ monte carlo
class MonteCarloIn(BaseModel):
    portfolio_id: str | None = None
    initial: float | None = Field(default=None, ge=0, le=1e12)
    monthly: float = Field(default=0, ge=0, le=1e10)
    years: int = Field(default=5, ge=1, le=40)
    paths: int = Field(default=5000, ge=200, le=20000)
    expected_return: float | None = Field(default=None, ge=-0.5, le=1.0)
    volatility: float | None = Field(default=None, gt=0, le=1.5)
    method: Literal["parametric", "bootstrap"] = "parametric"
    target: float | None = Field(default=None, gt=0)


@router.get("/simulate/assumptions/{portfolio_id}")
def assumptions(portfolio_id: str, ctx: Ctx = Depends(get_ctx)):
    """Historical return and volatility of the current holdings: sensible
    defaults for the simulators."""
    params = analytics.portfolio_parameters(ctx, books.load_book(ctx, portfolio_id), "3Y")
    return ok(
        {
            "value": params["value"],
            "expected_return": params["expected_return"],
            "volatility": params["volatility"],
            "months_of_history": len(params["monthly_returns"]),
        }
    )


@router.post("/simulate/monte-carlo")
def monte_carlo(body: MonteCarloIn, ctx: Ctx = Depends(get_ctx)):
    params: dict[str, Any] = {"value": 0.0, "expected_return": None, "volatility": None, "monthly_returns": []}
    if body.portfolio_id:
        params = analytics.portfolio_parameters(ctx, books.load_book(ctx, body.portfolio_id), "3Y")
    initial = body.initial if body.initial is not None else params["value"]
    mu = body.expected_return if body.expected_return is not None else params["expected_return"]
    sigma = body.volatility if body.volatility is not None else params["volatility"]
    if mu is None or sigma is None:
        raise HTTPException(422, "Set an expected return and volatility, or pick a portfolio with price history.")
    history = np.array(params["monthly_returns"]) if body.method == "bootstrap" else None
    if body.method == "bootstrap" and (history is None or len(history) < 12):
        raise HTTPException(422, "Bootstrap needs at least a year of monthly history for the current holdings.")
    result = simulate.monte_carlo(initial, body.monthly, body.years, mu, sigma, body.paths, body.target, history)
    return ok({**result, "assumptions": {"initial": initial, "monthly": body.monthly, "years": body.years,
                                         "expected_return": mu, "volatility": sigma, "method": body.method,
                                         "target": body.target}})


# --------------------------------------------------------------- backtest
class BacktestIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=24)
    start_date: date
    end_date: date | None = None
    capital: float = Field(default=100000, gt=0, le=1e12)
    config: dict[str, Any]
    strategy_id: str | None = None
    strategy_name: str = Field(default="", max_length=80)
    save: bool = False


class StrategyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=400)
    config: dict[str, Any]


def _validate_config(config: dict) -> None:
    for side in ("entry", "exit"):
        group = config.get(side) or {}
        rules = group.get("rules") or []
        if side == "entry" and not rules:
            raise HTTPException(422, "Add at least one entry rule.")
        if len(rules) > 8:
            raise HTTPException(422, "A rule group can hold at most 8 rules.")
        for rule in rules:
            if rule.get("cmp") not in bt.COMPARATORS:
                raise HTTPException(422, f"Unknown comparison: {rule.get('cmp')}")
            for operand in (rule.get("left"), rule.get("right")):
                if not isinstance(operand, dict) or operand.get("type") not in bt.OPERANDS:
                    raise HTTPException(422, "A rule has an unknown indicator.")
                if not 1 <= int(operand.get("period") or 1) <= 400:
                    raise HTTPException(422, "Indicator periods must be between 1 and 400.")
    stops = (config.get("stop_loss_pct"), config.get("take_profit_pct"), config.get("trailing_stop_pct"))
    has_exit = bool((config.get("exit") or {}).get("rules")) or any(stops)
    if not has_exit:
        raise HTTPException(422, "Add an exit rule or a stop so positions can close.")


@router.get("/backtest/meta")
def backtest_meta(ctx: Ctx = Depends(get_ctx)):
    return ok({"operands": bt.OPERANDS, "comparators": bt.COMPARATORS, "presets": bt.PRESETS})


@router.post("/backtest/run")
def run_backtest(body: BacktestIn, ctx: Ctx = Depends(get_ctx)):
    _validate_config(body.config)
    symbol = normalize(body.symbol)
    df = ctx.market.bars([symbol]).get(symbol)
    if df is None or df.empty:
        raise HTTPException(404, f"No market data found for {symbol}")
    start = pd.Timestamp(body.start_date)
    end = pd.Timestamp(body.end_date or books.today_ist())
    window = df[(df.index >= start) & (df.index <= end)]
    if len(window) < 30:
        raise HTTPException(422, "Pick a longer period: at least 30 trading days are needed.")
    try:
        result = bt.run(window, body.config, body.capital, warmup=df[df.index < start].iloc[-420:])
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, f"The strategy could not be evaluated: {exc}") from exc
    result["symbol"] = symbol
    result["name"] = ctx.market.instrument(symbol)["name"]
    result["period"] = {"start": window.index[0].date().isoformat(), "end": window.index[-1].date().isoformat()}
    if body.save:
        stats = result["stats"]
        saved = ctx.store.insert(
            "backtest_results",
            {
                "strategy_id": body.strategy_id,
                "strategy_name": body.strategy_name or "Untitled strategy",
                "symbol": symbol,
                "start_date": result["period"]["start"],
                "end_date": result["period"]["end"],
                "initial_capital": stats["initial_capital"],
                "final_value": stats["final_value"],
                "cagr": stats["cagr"],
                "max_drawdown": stats["max_drawdown"],
                "total_trades": stats["total_trades"],
                "stats": {k: v for k, v in stats.items() if not isinstance(v, float) or np.isfinite(v)},
            },
        )[0]
        result["result_id"] = saved["id"]
    return ok(result)


@router.get("/backtest/strategies")
def list_strategies(ctx: Ctx = Depends(get_ctx)):
    return ok(ctx.store.list("backtest_strategies", order="created_at.desc"))


@router.post("/backtest/strategies")
def create_strategy(body: StrategyIn, ctx: Ctx = Depends(get_ctx)):
    _validate_config(body.config)
    return ok(ctx.store.insert("backtest_strategies", body.model_dump())[0], 201)


@router.patch("/backtest/strategies/{strategy_id}")
def update_strategy(strategy_id: str, body: StrategyIn, ctx: Ctx = Depends(get_ctx)):
    _validate_config(body.config)
    updated = ctx.store.update("backtest_strategies", strategy_id, body.model_dump())
    if not updated:
        raise HTTPException(404, "Strategy not found")
    return ok(updated)


@router.delete("/backtest/strategies/{strategy_id}")
def delete_strategy(strategy_id: str, ctx: Ctx = Depends(get_ctx)):
    ctx.store.delete("backtest_results", {"strategy_id": strategy_id})
    ctx.store.delete("backtest_strategies", {"id": strategy_id})
    return ok({"deleted": True})


@router.get("/backtest/results")
def list_results(ctx: Ctx = Depends(get_ctx)):
    return ok(ctx.store.list("backtest_results", order="created_at.desc")[:50])


@router.delete("/backtest/results/{result_id}")
def delete_result(result_id: str, ctx: Ctx = Depends(get_ctx)):
    ctx.store.delete("backtest_results", {"id": result_id})
    return ok({"deleted": True})
