"""Savings goals: a target amount by a date, and what it takes to get there.

A goal is shown under three assumed yearly returns, never one, and each is
labelled as an assumption. What is "saved so far" is either a figure the user
types in or the value of one of their portfolios.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..deps import get_ctx, ok
from ..quant import goals as sums
from ..services import book as books
from ..services.book import Ctx

router = APIRouter(prefix="/api", tags=["goals"])

# The yearly returns a goal is worked out under. They are illustrations chosen to span a
# cautious to a hopeful view of a mostly-equity portfolio in India, not forecasts.
ASSUMPTIONS = (
    ("cautious", "Cautious", 0.07, "About what a fixed deposit or a debt fund has paid."),
    ("middle", "Middle", 0.10, "A blend of shares and safer holdings over a long stretch."),
    ("hopeful", "Hopeful", 0.13, "Roughly what Indian shares have returned in good decades."),
)
INFLATION = 0.06


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    target_amount: float = Field(gt=0, le=1e12)
    target_date: date
    # When set, this portfolio's value counts as what has been saved so far.
    portfolio_id: str | None = Field(default=None, max_length=64)
    saved_amount: float = Field(default=0, ge=0, le=1e12)
    monthly_amount: float = Field(default=0, ge=0, le=1e10)

    def row(self) -> dict:
        data = self.model_dump()
        data["name"] = self.name.strip()
        data["portfolio_id"] = self.portfolio_id or None
        data["target_date"] = self.target_date.isoformat()
        return data


def view(goal: dict, saved: float, linked: str | None, today: date) -> dict:
    """A goal with everything worked out: progress, and what each assumption implies."""
    target = float(goal["target_amount"])
    monthly = float(goal.get("monthly_amount") or 0)
    due = date.fromisoformat(str(goal["target_date"])[:10])
    months = sums.months_between(today, due)
    scenarios = []
    for id, label, rate, basis in ASSUMPTIONS:
        projected = sums.future_value(saved, monthly, rate, months)
        reach = sums.months_to_reach(target, saved, monthly, rate)
        scenarios.append(
            {
                "id": id, "label": label, "rate": rate, "basis": basis,
                "required_monthly": round(sums.required_monthly(target, saved, rate, months), 2),
                "projected": round(projected, 2),
                "reaches": projected >= target,
                "shortfall": round(max(target - projected, 0.0), 2),
                "reach_date": sums.add_months(today, reach).isoformat() if reach is not None else None,
            }
        )
    middle = scenarios[1]
    if saved >= target:
        status = "reached"
    elif months == 0:
        status = "overdue"
    elif middle["reaches"]:
        status = "on_track"
    elif scenarios[2]["reaches"]:
        status = "close"
    else:
        status = "behind"
    return {
        **goal,
        "target_amount": target,
        "monthly_amount": monthly,
        "saved_amount": float(goal.get("saved_amount") or 0),
        "saved": round(saved, 2),
        "linked_portfolio": linked,
        "progress": min(saved / target * 100, 100.0) if target > 0 else 0.0,
        "months_left": months,
        "status": status,
        "scenarios": scenarios,
        "todays_money": round(sums.in_todays_money(target, INFLATION, months), 2),
        "inflation": INFLATION,
    }


def _views(ctx: Ctx, goals: list[dict]) -> list[dict]:
    today = books.today_ist()
    portfolios = {p["id"]: p for p in ctx.store.list("portfolios")}
    worth: dict[str, float] = {}
    out = []
    for goal in goals:
        pid = goal.get("portfolio_id")
        portfolio = portfolios.get(pid) if pid else None
        if portfolio:
            if pid not in worth:
                book = books.load_book(ctx, pid)
                worth[pid] = books.summarize(ctx, book, books.holdings(ctx, book))["net_worth"]
            out.append(view(goal, worth[pid], portfolio["name"], today))
        else:
            out.append(view(goal, float(goal.get("saved_amount") or 0), None, today))
    return out


def _checked(ctx: Ctx, body: GoalIn) -> dict:
    row = body.row()
    if row["portfolio_id"] and not ctx.store.get("portfolios", row["portfolio_id"]):
        raise HTTPException(404, "Portfolio not found")
    return row


@router.get("/goals")
def list_goals(ctx: Ctx = Depends(get_ctx)):
    """Every goal, with the assumptions they are worked out under so that the page can state them."""
    return ok({
        "goals": _views(ctx, ctx.store.list("goals", order="target_date.asc")),
        "assumptions": [{"id": id, "label": label, "rate": rate, "basis": basis} for id, label, rate, basis in ASSUMPTIONS],
        "inflation": INFLATION,
    })


@router.post("/goals")
def create_goal(body: GoalIn, ctx: Ctx = Depends(get_ctx)):
    goal = ctx.store.insert("goals", _checked(ctx, body))[0]
    return ok(_views(ctx, [goal])[0], 201)


@router.patch("/goals/{goal_id}")
def update_goal(goal_id: str, body: GoalIn, ctx: Ctx = Depends(get_ctx)):
    if not ctx.store.get("goals", goal_id):
        raise HTTPException(404, "Goal not found")
    goal = ctx.store.update("goals", goal_id, _checked(ctx, body))
    return ok(_views(ctx, [goal])[0])


@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: str, ctx: Ctx = Depends(get_ctx)):
    if not ctx.store.get("goals", goal_id):
        raise HTTPException(404, "Goal not found")
    ctx.store.delete("goals", {"id": goal_id})
    return ok({"deleted": True})
