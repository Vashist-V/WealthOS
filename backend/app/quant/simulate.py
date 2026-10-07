"""Scenario tools: deterministic projections, shocks and Monte Carlo paths."""
from __future__ import annotations

import numpy as np

PERCENTILES = (5, 25, 50, 75, 95)


def projection(initial: float, monthly: float, years: int, annual_return: float, step_up: float = 0.0) -> dict:
    """Compound an opening balance plus a monthly contribution.

    `step_up` raises the contribution once a year by that fraction.
    """
    monthly_rate = (1 + annual_return) ** (1 / 12) - 1
    value, invested, contribution = initial, initial, monthly
    points = [{"year": 0, "invested": round(invested, 2), "value": round(value, 2)}]
    for month in range(1, years * 12 + 1):
        value = (value + contribution) * (1 + monthly_rate)
        invested += contribution
        if month % 12 == 0:
            points.append({"year": month // 12, "invested": round(invested, 2), "value": round(value, 2)})
            contribution *= 1 + step_up
    return {
        "points": points,
        "final_value": round(value, 2),
        "total_invested": round(invested, 2),
        "gain": round(value - invested, 2),
        "multiple": round(value / invested, 3) if invested > 0 else None,
    }


def monte_carlo(
    initial: float,
    monthly: float,
    years: int,
    expected_return: float,
    volatility: float,
    paths: int = 5000,
    target: float | None = None,
    history: np.ndarray | None = None,
    seed: int | None = None,
) -> dict:
    """Simulate month-by-month portfolio paths.

    With `history` (monthly returns) the paths are bootstrapped from what
    actually happened; otherwise returns are log-normal with the given
    expected return and volatility.
    """
    rng = np.random.default_rng(seed)
    months = years * 12
    if history is not None and len(history) >= 12:
        growth = 1.0 + rng.choice(history, size=(paths, months), replace=True)
    else:
        dt = 1 / 12
        drift = (np.log1p(expected_return) - 0.5 * volatility**2) * dt
        growth = np.exp(drift + volatility * np.sqrt(dt) * rng.standard_normal((paths, months)))

    values = np.empty((paths, months + 1))
    values[:, 0] = initial
    for m in range(months):
        values[:, m + 1] = (values[:, m] + monthly) * growth[:, m]

    bands = np.percentile(values, PERCENTILES, axis=0)
    terminal = values[:, -1]
    invested = initial + monthly * months
    counts, edges = np.histogram(terminal, bins=40, range=(float(np.percentile(terminal, 0.5)), float(np.percentile(terminal, 99.5))))
    sample = values[rng.choice(paths, size=min(40, paths), replace=False)]
    return {
        "months": list(range(months + 1)),
        "bands": {f"p{p}": [round(float(v), 2) for v in bands[i]] for i, p in enumerate(PERCENTILES)},
        "invested": [round(initial + monthly * m, 2) for m in range(months + 1)],
        "terminal": {f"p{p}": round(float(np.percentile(terminal, p)), 2) for p in PERCENTILES},
        "mean": round(float(terminal.mean()), 2),
        "total_invested": round(invested, 2),
        "probability_of_loss": float((terminal < invested).mean()),
        "probability_of_target": float((terminal >= target).mean()) if target else None,
        "median_multiple": round(float(np.median(terminal) / invested), 3) if invested > 0 else None,
        "histogram": {"edges": [round(float(e), 2) for e in edges], "counts": [int(c) for c in counts]},
        "sample_paths": [[round(float(v), 2) for v in row] for row in sample],
        "paths": paths,
    }


def apply_shocks(holdings: list[dict], shocks: dict[str, float]) -> dict:
    """Revalue holdings after per-symbol percentage moves (-0.2 = down 20%)."""
    rows = []
    before = after = 0.0
    for h in holdings:
        move = max(shocks.get(h["symbol"], 0.0), -1.0)
        new_value = h["value"] * (1 + move)
        before += h["value"]
        after += new_value
        rows.append(
            {
                "symbol": h["symbol"],
                "name": h.get("name"),
                "sector": h.get("sector"),
                "value": round(h["value"], 2),
                "shock": move,
                "new_value": round(new_value, 2),
                "change": round(new_value - h["value"], 2),
            }
        )
    for r in rows:
        r["weight_before"] = r["value"] / before if before else 0.0
        r["weight_after"] = r["new_value"] / after if after else 0.0
    rows.sort(key=lambda r: r["change"])
    return {
        "before": round(before, 2),
        "after": round(after, 2),
        "change": round(after - before, 2),
        "change_pct": (after / before - 1) if before else 0.0,
        "holdings": rows,
    }
