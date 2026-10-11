"""Arithmetic for a savings goal: what a sum and a monthly amount grow to, and
what monthly amount a target needs.

Every rate here is an assumption handed in by the caller. Nothing in this
module predicts a return; it only shows what follows if a given return
happened, steadily, every year. Real returns arrive unevenly, which is why a
goal is shown under several assumptions and never under one.
"""
from __future__ import annotations

from datetime import date


def months_between(start: date, end: date) -> int:
    """Whole months from `start` to `end`; zero when `end` is not after `start`."""
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        months -= 1
    return max(months, 0)


def add_months(start: date, months: int) -> date:
    """The first day of the month that is `months` after `start`'s."""
    index = start.year * 12 + (start.month - 1) + months
    return date(index // 12, index % 12 + 1, 1)


def monthly_rate(annual_rate: float) -> float:
    """The monthly growth that compounds to the given yearly growth."""
    return (1 + annual_rate) ** (1 / 12) - 1


def future_value(present: float, monthly: float, annual_rate: float, months: int) -> float:
    """What `present` becomes after `months`, with `monthly` added at the end of each month."""
    if months <= 0:
        return present
    r = monthly_rate(annual_rate)
    growth = (1 + r) ** months
    added = monthly * (growth - 1) / r if r else monthly * months
    return present * growth + added


def required_monthly(target: float, present: float, annual_rate: float, months: int) -> float:
    """The monthly amount that turns `present` into `target` in `months`. Zero if `present` gets there by itself."""
    if months <= 0:
        return max(target - present, 0.0)
    r = monthly_rate(annual_rate)
    growth = (1 + r) ** months
    shortfall = target - present * growth
    if shortfall <= 0:
        return 0.0
    return shortfall * r / (growth - 1) if r else shortfall / months


def months_to_reach(target: float, present: float, monthly: float, annual_rate: float, limit: int = 720) -> int | None:
    """How many months until `target` is reached. None if it is not reached within `limit` months (sixty years)."""
    if present >= target:
        return 0
    r = monthly_rate(annual_rate)
    value = present
    for month in range(1, limit + 1):
        value = value * (1 + r) + monthly
        if value >= target:
            return month
    return None


def in_todays_money(amount: float, inflation: float, months: int) -> float:
    """What `amount`, received `months` from now, buys in today's prices."""
    return amount / (1 + inflation) ** (months / 12)
