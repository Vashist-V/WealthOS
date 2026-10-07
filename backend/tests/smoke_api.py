"""Manual end-to-end run against live market data.

    python -m tests.smoke_api

Not collected by pytest: it needs the network and takes a while on a cold cache.
"""
import json
import time

from fastapi.testclient import TestClient

from app.main import app

H = {"X-Demo-Session": "smoke-test-session-01"}


def main() -> None:
    with TestClient(app) as c:
        def call(method: str, path: str, **kw):
            started = time.time()
            r = c.request(method, path, headers=H, **kw)
            print(f"{r.status_code} {method} {path} {time.time() - started:.1f}s {len(r.content) // 1024}kB")
            if r.status_code >= 400:
                print("    ", r.text[:400])
                return None
            return r.json()

        def get(path: str, **params):
            return call("GET", path, params=params or None)

        def post(path: str, body: dict | None = None):
            return call("POST", path, json=body or {})

        print(get("/api/health"))
        print(get("/api/me"))
        ps = get("/api/portfolios")
        for p in ps:
            s = p["summary"]
            print(
                f"  {p['name']:24} {p['kind']:10} value={s['value']:>12,.0f} invested={s['invested']:>12,.0f} "
                f"pnl%={s['unrealized_pct']:6.1f} day={s['day_pnl']:>9,.0f} xirr={s['xirr']} cash={s['cash']:,.0f} "
                f"n={s['holdings_count']} tx={s['transactions_count']}"
            )
        pid = ps[0]["id"]
        ov = get(f"/api/portfolios/{pid}/overview")
        print("  summary:", json.dumps(ov["summary"])[:700])
        for h in ov["holdings"][:4]:
            print("  ", {k: h[k] for k in ("symbol", "quantity", "avg_cost", "price", "value", "pnl_pct", "weight", "day_pnl", "holding_days", "sector")})
        print("  conc:", ov["allocation"]["concentration"])
        print("  assets:", [(a["name"], round(a["weight"], 1)) for a in ov["allocation"]["asset_classes"]])
        for rng in ("1M", "1Y", "ALL"):
            pf = get(f"/api/portfolios/{pid}/performance", range=rng)
            print("  ", rng, len(pf["dates"]), pf["dates"][:1], pf["dates"][-1:], json.dumps(pf["stats"])[:460])
        rk = get(f"/api/portfolios/{pid}/risk", lookback="1Y")
        print("  risk:", json.dumps(rk["summary"])[:1000])
        print("  variance:", rk["variance"], "corr avg", rk["correlation"]["average"], rk["correlation"]["highest"][:1])
        print("  top risk:", [(h["symbol"], round(h["weight"], 1), round(h["risk_contribution"], 1), h["beta"] and round(h["beta"], 2)) for h in rk["holdings"][:4]])
        xr = get(f"/api/portfolios/{pid}/xray")
        print("  metrics:", xr["metrics"])
        for o in xr["observations"]:
            print("   -", o["title"], "|", o["detail"][:110])
        dv = get(f"/api/portfolios/{pid}/dividends")
        print("  div:", {k: dv[k] for k in ("total", "trailing_12m", "forward_income", "portfolio_yield", "yield_on_cost")}, dv["by_year"], dv["events"][:2])
        allv = get("/api/portfolios/all/overview")
        print("  ALL:", allv["summary"]["value"], allv["summary"]["holdings_count"])
        cmp_ = get("/api/portfolios/compare", ids=",".join(p["id"] for p in ps))
        for i in cmp_["portfolios"]:
            print("  cmp", i["name"], {k: (round(i[k], 3) if isinstance(i[k], float) else i[k]) for k in ("cagr", "total_return", "volatility", "max_drawdown", "sharpe", "beta", "window_return")})
        tx = get(f"/api/portfolios/{pid}/transactions")
        print("  tx", len(tx["transactions"]), tx["totals"], tx["transactions"][0])
        mk = get("/api/market/overview")
        print("  mkt", mk["status"], mk["breadth"], [(i["short"], i["price"], round(i["change_pct"], 2)) for i in mk["indices"][:6]])
        print("  gainers", [(g["symbol"], round(g["change_pct"], 2)) for g in mk["gainers"][:4]], "sectors", [(s["name"], round(s["change_pct"], 2)) for s in mk["sectors"][:3]], "idx", len(mk["indices"]), "heat", len(mk["heatmap"]))
        st = get("/api/market/stocks/HAL")
        print("  HAL", st["quote"]["price"], st["fundamentals"], st["technicals"], st["position"])
        get("/api/market/stocks/M%26M")
        get("/api/market/stocks/%5ENSEI")
        hs = get("/api/market/stocks/HAL/history", range="1D")
        print("  1D candles", len(hs["candles"]), hs["intraday"])
        hs = get("/api/market/stocks/HAL/history", range="1Y")
        print("  1Y candles", len(hs["candles"]))
        fn = get("/api/market/stocks/HAL/financials")
        print("  fin", fn["income"]["annual"]["periods"], [r["label"] for r in fn["income"]["annual"]["rows"]], fn["ratios"])
        ev = get("/api/market/stocks/HAL/events")
        print("  ev", ev["dividends"][:2], ev["splits"], ev["upcoming"])
        print("  search", [r["symbol"] for r in get("/api/market/search", q="tata")], [r["symbol"] for r in get("/api/market/search", q="suzlon")])
        print("  universe", len(get("/api/market/universe")["stocks"]))
        wl = get("/api/watchlists")
        print("  wl", [(w["name"], len(w["stocks"])) for w in wl], wl[0]["stocks"][0])
        al = post("/api/alerts/evaluate")
        print("  alerts", [(a["symbol"], a["alert_type"], a["threshold"], a["is_active"], a["message"]) for a in al["alerts"]], al["fired"])
        jr = get("/api/journal")
        print("  journal", [(j["symbol"], j["status"], j["return_pct"] and round(j["return_pct"], 1), j["benchmark_return_pct"] and round(j["benchmark_return_pct"], 1), j["days"]) for j in jr])
        print("  review", len(get(f"/api/journal/{jr[0]['id']}/review")["dates"]))
        cal = get("/api/calendar")
        print("  cal", len(cal["events"]), [e for e in cal["events"] if e["upcoming"]][:3])
        pr = post("/api/simulate/projection", {"scenarios": [
            {"label": "A", "initial": 200000, "monthly": 5000, "years": 5, "annual_return": 0.12},
            {"label": "B", "initial": 200000, "monthly": 10000, "years": 5, "annual_return": 0.12},
        ]})
        print("  proj", [(s["label"], s["final_value"], s["total_invested"]) for s in pr["scenarios"]])
        sh = post("/api/simulate/shock", {"portfolio_id": pid, "kind": "market", "magnitude": -0.2})
        print("  shock", sh["title"], sh["before"], sh["after"], round(sh["change_pct"], 4))
        sh = post("/api/simulate/shock", {"portfolio_id": pid, "kind": "largest", "magnitude": -0.5})
        print("  shock", sh["title"], sh["before"], sh["after"])
        print("  assume", get(f"/api/simulate/assumptions/{pid}"))
        mc = post("/api/simulate/monte-carlo", {"portfolio_id": pid, "monthly": 5000, "years": 5, "paths": 5000})
        print("  mc", mc["terminal"], mc["probability_of_loss"], mc["assumptions"])
        mc = post("/api/simulate/monte-carlo", {"portfolio_id": pid, "monthly": 5000, "years": 5, "paths": 2000, "method": "bootstrap"})
        print("  mc boot", mc["terminal"])
        for preset in get("/api/backtest/meta")["presets"]:
            b = post("/api/backtest/run", {"symbol": "RELIANCE", "start_date": "2021-01-01", "capital": 100000, "config": preset["config"]})
            s = b["stats"]
            print("  bt", preset["key"], s["final_value"], s["cagr"] and round(s["cagr"], 4), round(s["max_drawdown"], 4), s["total_trades"], s["win_rate"], "B&H", s["buy_hold_final"], [o["name"] for o in b["price"]["overlays"]])
        paper = next(p for p in ps if p["kind"] == "paper")
        od = post(f"/api/portfolios/{paper['id']}/orders", {"symbol": "ITC", "side": "BUY", "quantity": 50})
        print("  order", od and (od["price"], od["value"]))
        post(f"/api/portfolios/{paper['id']}/orders", {"symbol": "ITC", "side": "SELL", "quantity": 500})
        post(f"/api/portfolios/{paper['id']}/orders", {"symbol": "RELIANCE", "side": "BUY", "quantity": 50000})
        share = call("PUT", f"/api/portfolios/{pid}/share", json={"show_values": False})
        shared = c.get(f"/api/shared/{share['id']}")
        print("shared", shared.status_code, list(shared.json().keys()), shared.json()["holdings"][0])
        print("401 check:", c.get("/api/portfolios").status_code)


if __name__ == "__main__":
    main()
