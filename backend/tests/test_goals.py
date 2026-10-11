"""The arithmetic behind a savings goal, and how a goal reads once it is worked out."""
from datetime import date

import pytest

from app.quant import goals as sums
from app.routers import goals

TODAY = date(2026, 10, 11)


def test_months_between_counts_whole_months_only():
    assert sums.months_between(date(2026, 10, 11), date(2027, 10, 11)) == 12
    assert sums.months_between(date(2026, 10, 11), date(2027, 10, 10)) == 11
    assert sums.months_between(date(2026, 10, 11), date(2026, 1, 1)) == 0


def test_add_months_rolls_over_the_year():
    assert sums.add_months(date(2026, 10, 11), 3) == date(2027, 1, 1)
    assert sums.add_months(date(2026, 10, 11), 0) == date(2026, 10, 1)


def test_a_year_at_the_yearly_rate_grows_by_exactly_that_rate():
    assert sums.future_value(100_000, 0, 0.10, 12) == pytest.approx(110_000)
    assert sums.future_value(100_000, 0, 0.10, 0) == 100_000


def test_monthly_additions_without_growth_simply_add_up():
    assert sums.future_value(0, 1_000, 0.0, 24) == pytest.approx(24_000)
    assert sums.required_monthly(24_000, 0, 0.0, 24) == pytest.approx(1_000)


def test_the_required_amount_is_the_one_that_reaches_the_target():
    for rate in (0.07, 0.10, 0.13):
        monthly = sums.required_monthly(2_500_000, 300_000, rate, 60)
        assert sums.future_value(300_000, monthly, rate, 60) == pytest.approx(2_500_000)


def test_nothing_more_is_needed_when_what_is_saved_gets_there_alone():
    assert sums.required_monthly(110_000, 100_000, 0.10, 12) == 0.0
    assert sums.required_monthly(500_000, 100_000, 0.10, 0) == 400_000  # the date is here: the gap is the answer


def test_months_to_reach_matches_the_growth_and_gives_up_after_sixty_years():
    assert sums.months_to_reach(100, 200, 0, 0.10) == 0
    assert sums.months_to_reach(105_000, 100_000, 0, 0.10) == 7  # 5% takes a little over six months at 10% a year
    assert sums.months_to_reach(1e12, 0, 1, 0.07) is None


def test_inflation_shrinks_what_a_future_sum_buys():
    assert sums.in_todays_money(106_000, 0.06, 12) == pytest.approx(100_000)


GOAL = {"id": "g1", "name": "A home", "target_amount": 2_500_000, "target_date": "2031-10-11", "portfolio_id": None, "saved_amount": 300_000, "monthly_amount": 0}


def test_a_goal_is_shown_under_three_assumptions_in_order():
    out = goals.view({**GOAL, "monthly_amount": 30_000}, 300_000, None, TODAY)
    assert [s["id"] for s in out["scenarios"]] == ["cautious", "middle", "hopeful"]
    needed = [s["required_monthly"] for s in out["scenarios"]]
    assert needed == sorted(needed, reverse=True)  # the more growth is assumed, the less has to be added
    assert out["months_left"] == 60 and out["progress"] == pytest.approx(12.0)
    assert out["todays_money"] < out["target_amount"]


def test_status_follows_the_middle_assumption():
    middle = goals.view(GOAL, 300_000, None, TODAY)["scenarios"][1]["required_monthly"]
    assert goals.view({**GOAL, "monthly_amount": middle + 100}, 300_000, None, TODAY)["status"] == "on_track"
    assert goals.view({**GOAL, "monthly_amount": 0}, 300_000, None, TODAY)["status"] == "behind"
    hopeful = goals.view(GOAL, 300_000, None, TODAY)["scenarios"][2]["required_monthly"]
    assert goals.view({**GOAL, "monthly_amount": (middle + hopeful) / 2}, 300_000, None, TODAY)["status"] == "close"


def test_a_goal_already_met_or_past_its_date_says_so():
    assert goals.view(GOAL, 2_600_000, "Long-Term", TODAY)["status"] == "reached"
    assert goals.view(GOAL, 2_600_000, "Long-Term", TODAY)["progress"] == 100.0
    late = goals.view({**GOAL, "target_date": "2026-01-01"}, 300_000, None, TODAY)
    assert late["status"] == "overdue" and late["months_left"] == 0


def test_a_linked_portfolio_is_what_counts_as_saved():
    out = goals.view(GOAL, 900_000, "Long-Term", TODAY)
    assert out["saved"] == 900_000 and out["linked_portfolio"] == "Long-Term" and out["saved_amount"] == 300_000


def test_a_short_plan_says_how_far_short_and_when_it_would_arrive():
    cautious = goals.view({**GOAL, "monthly_amount": 10_000}, 300_000, None, TODAY)["scenarios"][0]
    assert not cautious["reaches"] and cautious["shortfall"] > 0
    assert cautious["reach_date"] > GOAL["target_date"]
