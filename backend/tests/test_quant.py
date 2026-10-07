"""Offline checks of the ledger, return and simulation maths."""
from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.quant import backtest, ledger, risk, simulate
from app.quant.returns import cagr, max_drawdown, time_weighted_returns, xirr


def tx(day: str, symbol: str, kind: str, qty: float, price: float, fees: float = 0.0) -> dict:
    return {"transaction_date": day, "symbol": symbol, "transaction_type": kind, "quantity": qty, "price": price, "fees": fees}


# The ledger from the proposal: two buys and a partial sale of AIRTEL.
AIRTEL = [
    tx("2026-01-12", "AIRTEL", "BUY", 2, 1420),
    tx("2026-02-23", "AIRTEL", "BUY", 3, 1510),
    tx("2026-04-17", "AIRTEL", "SELL", 1, 1720),
]


def test_average_cost_and_realised_gain():
    pos = ledger.build_positions(ledger.sort_transactions(AIRTEL))["AIRTEL"]
    average = (2 * 1420 + 3 * 1510) / 5
    assert pos.quantity == 4
    assert pos.avg_cost == pytest.approx(average)
    assert pos.realized_pnl == pytest.approx(1720 - average)
    assert pos.cost_basis == pytest.approx(4 * average)


def test_fees_raise_cost_and_reduce_proceeds():
    rows = [tx("2026-01-01", "X", "BUY", 10, 100, fees=20), tx("2026-02-01", "X", "SELL", 10, 110, fees=30)]
    pos = ledger.build_positions(rows)["X"]
    assert pos.quantity == 0
    assert pos.realized_pnl == pytest.approx(10 * 110 - 30 - (10 * 100 + 20))


def test_holding_period_uses_fifo_lots():
    pos = ledger.build_positions(ledger.sort_transactions(AIRTEL))["AIRTEL"]
    # The sale consumes the oldest share; one January share and three February shares remain.
    today = date(2026, 5, 1)
    expected = (1 * (today - date(2026, 1, 12)).days + 3 * (today - date(2026, 2, 23)).days) / 4
    assert pos.holding_days(today) == pytest.approx(expected)


def test_position_reopened_after_full_exit_starts_fresh():
    rows = [tx("2026-01-01", "X", "BUY", 5, 100), tx("2026-02-01", "X", "SELL", 5, 150), tx("2026-03-01", "X", "BUY", 2, 200)]
    pos = ledger.build_positions(rows)["X"]
    assert pos.avg_cost == pytest.approx(200)
    assert pos.realized_pnl == pytest.approx(250)
    assert pos.first_buy == date(2026, 3, 1)


def test_split_restates_earlier_trades():
    splits = {"X": [(pd.Timestamp("2026-03-01"), 2.0)]}
    rows = ledger.adjust_for_splits([tx("2026-01-01", "X", "BUY", 10, 1000), tx("2026-04-01", "X", "BUY", 10, 520)], splits)
    assert (rows[0]["quantity"], rows[0]["price"], rows[0]["split_factor"]) == (20, 500, 2.0)
    assert (rows[1]["quantity"], rows[1]["price"], rows[1]["split_factor"]) == (10, 520, 1.0)
    assert ledger.build_positions(rows)["X"].quantity == 30


def test_oversold_detects_selling_more_than_held():
    assert ledger.oversold(AIRTEL) is None
    assert ledger.oversold(AIRTEL + [tx("2026-04-18", "AIRTEL", "SELL", 5, 1700)]) == "AIRTEL"
    # A sale dated before the purchase that funds it is also invalid.
    assert ledger.oversold([tx("2026-02-01", "X", "SELL", 1, 10), tx("2026-03-01", "X", "BUY", 1, 10)]) == "X"


def test_xirr_matches_a_known_rate():
    # 1,000 growing 10% a year for exactly two years.
    flows = [(date(2024, 1, 1), -1000.0), (date(2025, 12, 31), 1000.0 * 1.1**2)]
    assert xirr(flows) == pytest.approx(0.10, abs=1e-3)


def test_xirr_needs_both_directions():
    assert xirr([(date(2024, 1, 1), -1000.0), (date(2024, 6, 1), -500.0)]) is None
    assert xirr([]) is None


def test_time_weighted_return_ignores_deposits():
    index = pd.date_range("2026-01-01", periods=4, freq="D")
    # 100 invested, +10%; then 110 more added and the whole pot gains 5%; then flat.
    value = pd.Series([100.0, 110.0, 231.0, 231.0], index=index)
    inflow = pd.Series([100.0, 0.0, 110.0, 0.0], index=index)
    outflow = pd.Series(0.0, index=index)
    returns = time_weighted_returns(value, inflow, outflow)
    assert list(returns.round(6)) == [0.0, 0.1, 0.05, 0.0]


def test_time_weighted_return_survives_a_full_exit():
    index = pd.date_range("2026-01-01", periods=3, freq="D")
    value = pd.Series([100.0, 0.0, 0.0], index=index)
    returns = time_weighted_returns(value, pd.Series([100.0, 0, 0], index=index), pd.Series([0, 102.0, 0], index=index))
    assert returns.iloc[1] == pytest.approx(0.02)
    assert returns.iloc[2] == 0.0


def test_max_drawdown_reports_peak_and_trough():
    index = pd.date_range("2026-01-01", periods=6, freq="D")
    wealth = pd.Series([100, 120, 90, 96, 121, 125], index=index, dtype=float)
    dd = max_drawdown(wealth.pct_change().fillna(0.0))
    assert dd["value"] == pytest.approx(90 / 120 - 1)
    assert (dd["peak"], dd["trough"], dd["recovered"]) == ("2026-01-02", "2026-01-03", "2026-01-05")


def test_cagr():
    assert cagr(2.0, 365 * 2) == pytest.approx(2**0.5 - 1)
    assert cagr(1.5, 0) is None


def test_beta_of_a_leveraged_copy_is_its_leverage():
    rng = np.random.default_rng(7)
    bench = pd.Series(rng.normal(0.0005, 0.01, 300), index=pd.date_range("2025-01-01", periods=300, freq="B"))
    beta, alpha = risk.beta_alpha(bench * 1.5, bench, 0.0)
    assert beta == pytest.approx(1.5)
    assert alpha == pytest.approx(0.0, abs=1e-9)


def test_risk_contributions_sum_to_one():
    rng = np.random.default_rng(3)
    returns = pd.DataFrame(rng.normal(0, 0.01, (250, 3)), columns=list("ABC"))
    contrib, variance, diversification = risk.risk_contributions(returns, pd.Series({"A": 0.5, "B": 0.3, "C": 0.2}))
    assert contrib.sum() == pytest.approx(1.0)
    assert variance > 0 and diversification >= 1.0


def test_var_is_a_positive_loss():
    returns = pd.Series(np.linspace(-0.05, 0.05, 101))
    var = risk.value_at_risk(returns, 0.95)
    assert var["historical"] == pytest.approx(0.045)
    assert var["cvar"] >= var["historical"]


def test_projection_compounds_monthly_contributions():
    out = simulate.projection(200_000, 5_000, 5, 0.12)
    assert out["total_invested"] == 200_000 + 5_000 * 60
    assert out["final_value"] > out["total_invested"]
    assert out["points"][-1]["year"] == 5
    flat = simulate.projection(1000, 100, 2, 0.0)
    assert flat["final_value"] == pytest.approx(1000 + 100 * 24)


def test_monte_carlo_bands_are_ordered_and_reproducible():
    a = simulate.monte_carlo(100_000, 1_000, 3, 0.12, 0.18, paths=2000, seed=11)
    b = simulate.monte_carlo(100_000, 1_000, 3, 0.12, 0.18, paths=2000, seed=11)
    assert a["terminal"] == b["terminal"]
    t = a["terminal"]
    assert t["p5"] < t["p25"] < t["p50"] < t["p75"] < t["p95"]
    assert len(a["bands"]["p50"]) == 37
    assert a["bands"]["p50"][0] == 100_000


def test_monte_carlo_without_volatility_matches_the_projection():
    mc = simulate.monte_carlo(100_000, 2_000, 4, 0.10, 1e-9, paths=200, seed=1)
    plan = simulate.projection(100_000, 2_000, 4, 0.10)
    assert mc["terminal"]["p50"] == pytest.approx(plan["final_value"], rel=1e-4)


def test_shocks_revalue_holdings():
    holdings = [{"symbol": "A", "value": 600.0}, {"symbol": "B", "value": 400.0}]
    out = simulate.apply_shocks(holdings, {"A": -0.5})
    assert (out["before"], out["after"]) == (1000.0, 700.0)
    assert out["change_pct"] == pytest.approx(-0.3)


def _bars(close: list[float]) -> pd.DataFrame:
    index = pd.date_range("2025-01-01", periods=len(close), freq="B")
    c = pd.Series(close, index=index, dtype=float)
    return pd.DataFrame({"Open": c.shift(1).fillna(c.iloc[0]), "High": c * 1.01, "Low": c * 0.99, "Close": c, "Volume": 1000.0})


CROSSOVER = {
    "entry": {"op": "AND", "rules": [{"left": {"type": "SMA", "period": 5}, "cmp": "crosses_above", "right": {"type": "SMA", "period": 20}}]},
    "exit": {"op": "OR", "rules": [{"left": {"type": "SMA", "period": 5}, "cmp": "crosses_below", "right": {"type": "SMA", "period": 20}}]},
}


def test_backtest_trades_a_moving_average_crossover():
    # Fall, rally, fall: one round trip, bought after the upturn and sold after the downturn.
    close = list(np.linspace(120, 80, 40)) + list(np.linspace(80, 160, 60)) + list(np.linspace(160, 90, 50))
    result = backtest.run(_bars(close), CROSSOVER, 100_000)
    trades = result["trades"]
    assert len(trades) == 1
    assert trades[0]["exit_reason"] == "Exit rule"
    assert trades[0]["pnl"] > 0
    assert result["stats"]["final_value"] == pytest.approx(100_000 + trades[0]["pnl"])
    assert [o["name"] for o in result["price"]["overlays"]] == ["SMA 5", "SMA 20"]


def test_backtest_fills_on_the_next_open():
    close = list(np.linspace(120, 80, 40)) + list(np.linspace(80, 160, 60))
    bars = _bars(close)
    result = backtest.run(bars, CROSSOVER, 100_000)
    trade = result["trades"][0]
    signal = backtest.evaluate_group(CROSSOVER["entry"], bars)
    signal_day = signal[signal].index[0]
    fill_day = bars.index[bars.index.get_loc(signal_day) + 1]
    assert trade["entry_date"] == fill_day.date().isoformat()
    assert trade["entry_price"] == pytest.approx(bars["Open"].loc[fill_day], abs=0.01)


def test_backtest_stop_loss_closes_the_position():
    close = list(np.linspace(120, 80, 40)) + list(np.linspace(80, 120, 30)) + list(np.linspace(120, 60, 30))
    config = {**CROSSOVER, "exit": {"op": "OR", "rules": []}, "stop_loss_pct": 10}
    trades = backtest.run(_bars(close), config, 50_000)["trades"]
    assert trades and trades[0]["exit_reason"] == "Stop loss"


def test_rsi_stays_in_range():
    series = backtest.rsi(_bars(list(100 + 10 * np.sin(np.arange(120) / 5)))["Close"], 14).dropna()
    assert series.between(0, 100).all()
