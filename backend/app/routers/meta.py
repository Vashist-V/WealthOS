"""Session info, sample data and public portfolio sharing."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import memory
from ..config import Settings, get_settings
from ..deps import get_ctx, get_market, get_registry, ok
from ..market.provider import MarketData, market_status
from ..services import analytics, assistant, book as books, sample
from ..services.book import Ctx
from ..store.supabase import SupabaseStore

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)):
    """Is the server up. Answered without waiting for a worker thread, so the host's checks still pass while
    every thread is busy with slow work. `memory` is how much the server is using, where the system says."""
    return ok({"status": "ok", "accounts": settings.supabase_configured, "demo": settings.demo_enabled,
               "market": market_status(), "memory": memory.usage()})


@router.get("/me")
def me(ctx: Ctx = Depends(get_ctx)):
    return ok(
        {
            "user_id": ctx.store.user_id,
            "mode": ctx.mode,
            "email": ctx.email,
            "portfolios": len(ctx.store.list("portfolios")),
            "has_sample_data": sample.has_sample(ctx),
            "assistant": assistant.provider(ctx.settings) is not None,
            "assistant_provider": assistant.provider(ctx.settings),
            "risk_free_rate": ctx.settings.risk_free_rate,
            "market": market_status(),
        }
    )


@router.post("/sample-data")
def load_sample_data(ctx: Ctx = Depends(get_ctx)):
    """Add the sample portfolios, watchlists and journal to this workspace."""
    try:
        return ok(sample.seed(ctx), 201)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.delete("/sample-data")
def remove_sample_data(ctx: Ctx = Depends(get_ctx)):
    """Delete the sample portfolios, watchlists, journal entries, alerts and
    strategies. Anything the user created or changed is left alone."""
    forget = get_registry().forget_share if ctx.mode == "demo" else None
    return ok(sample.remove(ctx, forget))


@router.post("/demo/reset")
def reset_demo(ctx: Ctx = Depends(get_ctx)):
    if ctx.mode != "demo":
        raise HTTPException(400, "Only the demo workspace can be reset.")
    for share in ctx.store.list("portfolio_shares"):
        get_registry().forget_share(share["id"])
    store = ctx.store
    store.clear()  # type: ignore[attr-defined]
    try:
        with store.batch():  # type: ignore[attr-defined]
            result = sample.seed(ctx)
            store.seeded = True  # type: ignore[attr-defined]
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return ok(result)


# ---------------------------------------------------------------- sharing
class ShareIn(BaseModel):
    show_values: bool = False


@router.get("/portfolios/{portfolio_id}/share")
def get_share(portfolio_id: str, ctx: Ctx = Depends(get_ctx)):
    rows = ctx.store.list("portfolio_shares", {"portfolio_id": portfolio_id})
    return ok(rows[0] if rows else None)


@router.put("/portfolios/{portfolio_id}/share")
def set_share(portfolio_id: str, body: ShareIn, ctx: Ctx = Depends(get_ctx)):
    if not ctx.store.get("portfolios", portfolio_id):
        raise HTTPException(404, "Portfolio not found")
    existing = ctx.store.list("portfolio_shares", {"portfolio_id": portfolio_id})
    if existing:
        share = ctx.store.update("portfolio_shares", existing[0]["id"], {"show_values": body.show_values})
    else:
        share = ctx.store.insert("portfolio_shares", {"portfolio_id": portfolio_id, "show_values": body.show_values})[0]
    if ctx.mode == "demo":
        get_registry().remember_share(share["id"], ctx.store.session_id)  # type: ignore[attr-defined]
    return ok(share)


@router.delete("/portfolios/{portfolio_id}/share")
def revoke_share(portfolio_id: str, ctx: Ctx = Depends(get_ctx)):
    for share in ctx.store.list("portfolio_shares", {"portfolio_id": portfolio_id}):
        if ctx.mode == "demo":
            get_registry().forget_share(share["id"])
    ctx.store.delete("portfolio_shares", {"portfolio_id": portfolio_id})
    return ok({"deleted": True})


def _shared_ctx(token: str, settings: Settings, market: MarketData) -> tuple[Ctx, dict] | None:
    """Resolve a share token to a read-only context for its owner's data."""
    session = get_registry().session_for_share(token)
    if session:
        store = get_registry().get(session)
        share = store.get("portfolio_shares", token)
        return (Ctx(store=store, market=market, settings=settings, mode="demo"), share) if share else None
    if settings.supabase_configured and settings.supabase_service_role_key:
        key = settings.supabase_service_role_key
        store = SupabaseStore(settings.supabase_url, key, key, user_id="service")
        try:
            share = store.get("portfolio_shares", token)
        except HTTPException:
            return None
        return (Ctx(store=store, market=market, settings=settings, mode="supabase"), share) if share else None
    return None


@router.get("/shared/{token}")
def shared_portfolio(token: str, settings: Settings = Depends(get_settings), market: MarketData = Depends(get_market)):
    """Public, read-only view of a shared portfolio. Rupee amounts and
    quantities are included only when the owner chose to show them."""
    if len(token) != 36:
        raise HTTPException(404, "This link is not valid.")
    resolved = _shared_ctx(token, settings, market)
    if not resolved:
        raise HTTPException(404, "This link is not valid or has been revoked.")
    ctx, share = resolved
    book = books.load_book(ctx, share["portfolio_id"])
    rows = books.holdings(ctx, book)
    summary = books.summarize(ctx, book, rows)
    stats = analytics.lifetime_stats(ctx, book)
    alloc = books.allocation(book, rows)
    perf = analytics.performance(ctx, book, "ALL")
    show = bool(share.get("show_values"))

    def holding(r: dict) -> dict:
        base = {k: r[k] for k in ("symbol", "name", "sector", "asset_class", "weight", "pnl_pct", "day_change_pct", "price")}
        if show:
            base.update({k: r[k] for k in ("quantity", "avg_cost", "value", "invested", "pnl")})
        return base

    public_summary = {
        "unrealized_pct": summary["unrealized_pct"], "day_pct": summary["day_pct"], "xirr": summary["xirr"],
        "cagr": stats["cagr"], "total_return": stats["total_return"], "volatility": stats["volatility"],
        "max_drawdown": stats["max_drawdown"], "holdings_count": summary["holdings_count"],
        "since": summary["first_investment"], "as_of": summary["as_of"],
    }
    if show:
        public_summary.update({k: summary[k] for k in ("value", "invested", "unrealized_pnl", "day_pnl")})
    portfolio = book.portfolios[0]
    return ok(
        {
            "name": book.name,
            "description": portfolio.get("description") or "",
            "kind": book.kind,
            "color": portfolio.get("color"),
            "benchmark": analytics.benchmark_name(book.benchmark),
            "show_values": show,
            "summary": public_summary,
            "holdings": [holding(r) for r in rows],
            "allocation": {
                "asset_classes": [{"name": a["name"], "weight": a["weight"]} for a in alloc["asset_classes"]],
                "sectors": [{"name": s["name"], "weight": s["weight"]} for s in alloc["sectors"]],
                "concentration": alloc["concentration"],
            },
            "performance": {k: perf[k] for k in ("dates", "portfolio_return", "benchmark_return")},
        }
    )
