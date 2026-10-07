from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from ..deps import get_ctx, get_registry, ok
from ..market.universe import BENCHMARKS, is_index, normalize
from ..quant import ledger
from ..services import analytics, book as books
from ..services.book import ALL, Ctx

router = APIRouter(prefix="/api", tags=["portfolios"])

TxType = Literal["BUY", "SELL", "DIVIDEND"]


class PortfolioIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=240)
    kind: Literal["investment", "paper"] = "investment"
    color: str = Field(default="#6E7BFF", pattern=r"^#[0-9A-Fa-f]{6}$")
    benchmark: str = "^NSEI"
    cash_balance: float = Field(default=0, ge=0)
    initial_capital: float = Field(default=0, ge=0)

    @field_validator("benchmark")
    @classmethod
    def known_benchmark(cls, v: str) -> str:
        if v not in BENCHMARKS:
            raise ValueError("Unknown benchmark")
        return v


class PortfolioPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=240)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    benchmark: str | None = None
    cash_balance: float | None = Field(default=None, ge=0)


class TransactionIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=24)
    transaction_type: TxType
    quantity: float = Field(gt=0)
    price: float = Field(ge=0)
    fees: float = Field(default=0, ge=0)
    transaction_date: date
    notes: str = Field(default="", max_length=500)

    @field_validator("symbol")
    @classmethod
    def clean_symbol(cls, v: str) -> str:
        symbol = normalize(v)
        if is_index(symbol):
            raise ValueError("An index can't be held directly. Pick a stock or an ETF that tracks it.")
        return symbol

    @field_validator("transaction_date")
    @classmethod
    def not_future(cls, v: date) -> date:
        if v > books.today_ist():
            raise ValueError("Transaction date cannot be in the future")
        return v

    def row(self, portfolio_id: str, source: str = "manual") -> dict:
        return {
            "portfolio_id": portfolio_id,
            "symbol": self.symbol,
            "transaction_type": self.transaction_type,
            "quantity": self.quantity,
            "price": self.price,
            "fees": self.fees,
            "transaction_date": self.transaction_date.isoformat(),
            "notes": self.notes,
            "source": source,
        }


class BulkIn(BaseModel):
    transactions: list[TransactionIn] = Field(min_length=1, max_length=5000)
    source: Literal["import", "manual"] = "import"


class OrderIn(BaseModel):
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float = Field(gt=0)


def _portfolio(ctx: Ctx, portfolio_id: str) -> dict:
    portfolio = ctx.store.get("portfolios", portfolio_id)
    if not portfolio:
        raise HTTPException(404, "Portfolio not found")
    return portfolio


def _check_ledger(ctx: Ctx, portfolio: dict, transactions: list[dict]) -> None:
    """Reject a ledger that sells shares it never held, or (paper) overdraws cash."""
    adjusted = ledger.adjust_for_splits(
        transactions, books.splits_for(ctx.market, sorted({t["symbol"] for t in transactions}))
    )
    symbol = ledger.oversold(adjusted)
    if symbol:
        raise HTTPException(422, f"This would sell more {symbol} than the portfolio holds on that date.")
    if portfolio.get("kind") == "paper":
        cash = float(portfolio.get("initial_capital") or 0)
        for _, amount in sorted(ledger.cash_flows(adjusted), key=lambda f: f[0]):
            cash += amount
            if cash < -0.01:
                raise HTTPException(422, "Not enough virtual cash for this order.")


# ---------------------------------------------------------------- portfolios
@router.get("/portfolios")
def list_portfolios(ctx: Ctx = Depends(get_ctx)):
    out = []
    for p in ctx.store.list("portfolios", order="created_at.asc"):
        book = books.load_book(ctx, p["id"])
        rows = books.holdings(ctx, book)
        summary = books.summarize(ctx, book, rows)
        out.append({**p, "benchmark_name": analytics.benchmark_name(book.benchmark), "summary": summary})
    return ok(out)


@router.post("/portfolios")
def create_portfolio(body: PortfolioIn, ctx: Ctx = Depends(get_ctx)):
    data = body.model_dump()
    if body.kind == "paper":
        if body.initial_capital <= 0:
            raise HTTPException(422, "A paper portfolio needs starting capital.")
        data["cash_balance"] = 0
    else:
        data["initial_capital"] = 0
    return ok(ctx.store.insert("portfolios", data)[0], 201)


@router.patch("/portfolios/{portfolio_id}")
def update_portfolio(portfolio_id: str, body: PortfolioPatch, ctx: Ctx = Depends(get_ctx)):
    _portfolio(ctx, portfolio_id)
    patch = body.model_dump(exclude_none=True)
    if "benchmark" in patch and patch["benchmark"] not in BENCHMARKS:
        raise HTTPException(422, "Unknown benchmark")
    if not patch:
        raise HTTPException(422, "Nothing to update")
    return ok(ctx.store.update("portfolios", portfolio_id, patch))


@router.delete("/portfolios/{portfolio_id}")
def delete_portfolio(portfolio_id: str, ctx: Ctx = Depends(get_ctx)):
    _portfolio(ctx, portfolio_id)
    if ctx.mode == "demo":
        for share in ctx.store.list("portfolio_shares", {"portfolio_id": portfolio_id}):
            get_registry().forget_share(share["id"])
    for table in ("transactions", "holdings", "portfolio_snapshots", "portfolio_shares"):
        ctx.store.delete(table, {"portfolio_id": portfolio_id})
    ctx.store.delete("portfolios", {"id": portfolio_id})
    return ok({"deleted": True})


@router.get("/portfolios/compare")
def compare(ids: str = Query(min_length=1), ctx: Ctx = Depends(get_ctx)):
    wanted = [i for i in ids.split(",") if i][:6]
    return ok(analytics.compare(ctx, wanted))


@router.get("/portfolios/{portfolio_id}/overview")
def overview(portfolio_id: str, ctx: Ctx = Depends(get_ctx)):
    return ok(analytics.overview(ctx, books.load_book(ctx, portfolio_id)))


@router.get("/portfolios/{portfolio_id}/performance")
def performance(portfolio_id: str, range: str = "1Y", ctx: Ctx = Depends(get_ctx)):
    return ok(analytics.performance(ctx, books.load_book(ctx, portfolio_id), range.upper()))


@router.get("/portfolios/{portfolio_id}/risk")
def risk(portfolio_id: str, lookback: str = "1Y", ctx: Ctx = Depends(get_ctx)):
    return ok(analytics.risk_report(ctx, books.load_book(ctx, portfolio_id), lookback.upper()))


@router.get("/portfolios/{portfolio_id}/xray")
def xray(portfolio_id: str, ctx: Ctx = Depends(get_ctx)):
    return ok(analytics.xray(ctx, books.load_book(ctx, portfolio_id)))


@router.get("/portfolios/{portfolio_id}/dividends")
def dividends(portfolio_id: str, ctx: Ctx = Depends(get_ctx)):
    return ok(analytics.dividend_report(ctx, books.load_book(ctx, portfolio_id)))


# -------------------------------------------------------------- transactions
@router.get("/portfolios/{portfolio_id}/transactions")
def list_transactions(portfolio_id: str, ctx: Ctx = Depends(get_ctx)):
    book = books.load_book(ctx, portfolio_id)
    names = {p["id"]: p["name"] for p in book.portfolios}
    factors = {t["id"]: t["split_factor"] for t in book.adjusted if "id" in t}
    rows = []
    for t in book.transactions:
        qty, price, fees = float(t["quantity"]), float(t["price"]), float(t.get("fees") or 0)
        gross = qty * price
        rows.append(
            {
                **t,
                "quantity": qty,
                "price": price,
                "fees": fees,
                "name": ctx.market.instrument(t["symbol"])["name"],
                "portfolio_name": names.get(t["portfolio_id"]),
                "amount": round(gross + fees if t["transaction_type"] == "BUY" else gross - fees, 2),
                "split_factor": factors.get(t["id"], 1.0),
            }
        )
    rows.sort(key=lambda t: (str(t["transaction_date"]), str(t.get("created_at", ""))), reverse=True)
    realized = sum(p.realized_pnl for p in book.positions.values())
    return ok(
        {
            "transactions": rows,
            "totals": {
                "bought": round(sum(p.bought for p in book.positions.values()), 2),
                "sold": round(sum(p.sold for p in book.positions.values()), 2),
                "fees": round(sum(p.fees for p in book.positions.values()), 2),
                "realized_pnl": round(realized, 2),
                "dividends": round(sum(p.dividends for p in book.positions.values()), 2),
            },
        }
    )


@router.post("/portfolios/{portfolio_id}/transactions")
def add_transaction(portfolio_id: str, body: TransactionIn, ctx: Ctx = Depends(get_ctx)):
    portfolio = _portfolio(ctx, portfolio_id)
    row = body.row(portfolio_id)
    existing = ctx.store.list("transactions", {"portfolio_id": portfolio_id})
    _check_ledger(ctx, portfolio, existing + [row])
    created = ctx.store.insert("transactions", row)[0]
    books.sync_holdings(ctx, portfolio_id)
    return ok(created, 201)


@router.post("/portfolios/{portfolio_id}/transactions/bulk")
def import_transactions(portfolio_id: str, body: BulkIn, ctx: Ctx = Depends(get_ctx)):
    portfolio = _portfolio(ctx, portfolio_id)
    rows = [t.row(portfolio_id, body.source) for t in body.transactions]
    existing = ctx.store.list("transactions", {"portfolio_id": portfolio_id})
    _check_ledger(ctx, portfolio, existing + rows)
    created = 0
    for i in range(0, len(rows), 500):
        created += len(ctx.store.insert("transactions", rows[i : i + 500]))
    books.sync_holdings(ctx, portfolio_id)
    return ok({"imported": created}, 201)


@router.patch("/transactions/{transaction_id}")
def update_transaction(transaction_id: str, body: TransactionIn, ctx: Ctx = Depends(get_ctx)):
    current = ctx.store.get("transactions", transaction_id)
    if not current:
        raise HTTPException(404, "Transaction not found")
    portfolio = _portfolio(ctx, current["portfolio_id"])
    patch = body.row(current["portfolio_id"], current.get("source") or "manual")
    others = [t for t in ctx.store.list("transactions", {"portfolio_id": current["portfolio_id"]}) if t["id"] != transaction_id]
    _check_ledger(ctx, portfolio, others + [{**current, **patch}])
    updated = ctx.store.update("transactions", transaction_id, patch)
    books.sync_holdings(ctx, current["portfolio_id"])
    return ok(updated)


@router.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: str, ctx: Ctx = Depends(get_ctx)):
    current = ctx.store.get("transactions", transaction_id)
    if not current:
        raise HTTPException(404, "Transaction not found")
    portfolio = _portfolio(ctx, current["portfolio_id"])
    others = [t for t in ctx.store.list("transactions", {"portfolio_id": current["portfolio_id"]}) if t["id"] != transaction_id]
    _check_ledger(ctx, portfolio, others)
    ctx.store.delete("transactions", {"id": transaction_id})
    books.sync_holdings(ctx, current["portfolio_id"])
    return ok({"deleted": True})


# ------------------------------------------------------------- paper orders
@router.post("/portfolios/{portfolio_id}/orders")
def place_order(portfolio_id: str, body: OrderIn, ctx: Ctx = Depends(get_ctx)):
    """Fill a simulated market order at the latest traded price."""
    portfolio = _portfolio(ctx, portfolio_id)
    if portfolio.get("kind") != "paper":
        raise HTTPException(422, "Orders can only be placed in a paper portfolio.")
    symbol = normalize(body.symbol)
    if is_index(symbol):
        raise HTTPException(422, "An index can't be traded directly. Pick a stock or an ETF that tracks it.")
    quote = ctx.market.quote(symbol)
    if not quote:
        raise HTTPException(422, f"No market price is available for {symbol}.")
    row = {
        "portfolio_id": portfolio_id,
        "symbol": symbol,
        "transaction_type": body.side,
        "quantity": body.quantity,
        "price": round(quote["price"], 2),
        "fees": 0.0,
        "transaction_date": books.today_ist().isoformat(),
        "notes": "Simulated market order",
        "source": "paper",
    }
    existing = ctx.store.list("transactions", {"portfolio_id": portfolio_id})
    _check_ledger(ctx, portfolio, existing + [row])
    created = ctx.store.insert("transactions", row)[0]
    books.sync_holdings(ctx, portfolio_id)
    return ok({**created, "value": round(body.quantity * quote["price"], 2)}, 201)
