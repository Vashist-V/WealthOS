"""Market data service.

Daily bars come from Yahoo Finance through `yfinance`, are held in memory and
mirrored to disk so restarts are instant. Reads are stale-while-revalidate:
a request only blocks when there is no data at all for a symbol; otherwise it
is served from cache and refreshed in the background.
"""
from __future__ import annotations

import json
import logging
import pickle
import re
import threading
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

from .universe import EQUITY_UNIVERSE, INDICES, INSTRUMENTS, YAHOO_SECTORS, normalize, yahoo_symbol

log = logging.getLogger("wealthos.market")
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

IST = ZoneInfo("Asia/Kolkata")
HISTORY_PERIOD = "10y"
BATCH = 50
DAY = 86_400
BAR_COLUMNS = ["Open", "High", "Low", "Close", "Volume", "Dividends", "Splits"]

INCOME_LINES = [
    ("revenue", "Revenue", ["Total Revenue", "Operating Revenue"]),
    ("cost_of_revenue", "Cost of revenue", ["Cost Of Revenue", "Reconciled Cost Of Revenue"]),
    ("gross_profit", "Gross profit", ["Gross Profit"]),
    ("operating_expense", "Operating expenses", ["Operating Expense"]),
    ("operating_income", "Operating income", ["Operating Income"]),
    ("ebitda", "EBITDA", ["EBITDA", "Normalized EBITDA"]),
    ("ebit", "EBIT", ["EBIT"]),
    ("interest_expense", "Interest expense", ["Interest Expense", "Interest Expense Non Operating"]),
    ("pretax_income", "Profit before tax", ["Pretax Income"]),
    ("tax", "Tax", ["Tax Provision"]),
    ("net_income", "Net profit", ["Net Income", "Net Income Common Stockholders"]),
    ("eps", "EPS (diluted)", ["Diluted EPS", "Basic EPS"]),
]
BALANCE_LINES = [
    ("total_assets", "Total assets", ["Total Assets"]),
    ("current_assets", "Current assets", ["Current Assets"]),
    ("cash", "Cash & equivalents", ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"]),
    ("net_ppe", "Net fixed assets", ["Net PPE"]),
    ("total_liabilities", "Total liabilities", ["Total Liabilities Net Minority Interest"]),
    ("current_liabilities", "Current liabilities", ["Current Liabilities"]),
    ("total_debt", "Total debt", ["Total Debt"]),
    ("long_term_debt", "Long-term debt", ["Long Term Debt"]),
    ("equity", "Shareholders' equity", ["Stockholders Equity", "Common Stock Equity"]),
    ("retained_earnings", "Retained earnings", ["Retained Earnings"]),
    ("working_capital", "Working capital", ["Working Capital"]),
]
CASHFLOW_LINES = [
    ("operating", "Cash from operations", ["Operating Cash Flow"]),
    ("investing", "Cash from investing", ["Investing Cash Flow"]),
    ("financing", "Cash from financing", ["Financing Cash Flow"]),
    ("capex", "Capital expenditure", ["Capital Expenditure"]),
    ("free_cash_flow", "Free cash flow", ["Free Cash Flow"]),
    ("dividends_paid", "Dividends paid", ["Cash Dividends Paid", "Common Stock Dividend Paid"]),
    ("end_cash", "Closing cash", ["End Cash Position"]),
]


def market_status(now: datetime | None = None) -> dict:
    now = now or datetime.now(IST)
    opens = now.replace(hour=9, minute=15, second=0, microsecond=0)
    closes = now.replace(hour=15, minute=30, second=0, microsecond=0)
    weekday = now.weekday() < 5
    is_open = weekday and opens <= now <= closes
    if is_open:
        label, detail = "Open", f"Closes {closes:%H:%M} IST"
    elif weekday and now < opens:
        label, detail = "Pre-open", f"Opens {opens:%H:%M} IST"
    else:
        nxt = now + timedelta(days=1)
        while nxt.weekday() >= 5:
            nxt += timedelta(days=1)
        label, detail = "Closed", f"Opens {nxt:%a} 09:15 IST"
    return {"is_open": is_open, "label": label, "detail": detail, "time_ist": now.isoformat()}


def _safe(symbol: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", symbol)


def _num(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def _loosely(typed: list[str], name: list[str]) -> bool:
    """Every typed word begins like a word of the name, so "hero motors" finds Hero MotoCorp."""
    return all(any(n.startswith(w) or (len(w) >= 4 and w[:4] == n[:4]) for n in name) for w in typed)


class MarketData:
    def __init__(self, cache_dir: str):
        self.dir = Path(cache_dir)
        (self.dir / "bars").mkdir(parents=True, exist_ok=True)
        (self.dir / "meta").mkdir(parents=True, exist_ok=True)
        self._bars: dict[str, pd.DataFrame] = {}
        self._fresh_at: dict[str, float] = {}
        self._full_at: dict[str, float] = {}
        self._saved_at: dict[str, float] = {}
        self._missing: dict[str, float] = {}
        self._lock = threading.RLock()
        self._fetch_lock = threading.Lock()
        self._refreshing: set[str] = set()
        self._meta: dict[tuple[str, str], tuple[float, object]] = {}
        self._meta_inflight: set[tuple[str, str]] = set()
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="market")
        self.on_bars: Callable[[str, pd.DataFrame], None] | None = None  # persistence hook

    # ------------------------------------------------------------------ bars
    def _ttl(self) -> float:
        return 60.0 if market_status()["is_open"] else 1800.0

    def _load_disk(self, symbol: str) -> None:
        path = self.dir / "bars" / f"{_safe(symbol)}.pkl"
        if not path.exists():
            return
        try:
            with path.open("rb") as fh:
                saved = pickle.load(fh)
            self._bars[symbol] = saved["df"]
            self._fresh_at[symbol] = saved.get("fresh_at", 0.0)
            self._full_at[symbol] = saved.get("full_at", 0.0)
            self._saved_at[symbol] = time.time()
        except Exception:  # corrupt cache file: refetch
            log.warning("Discarding unreadable cache for %s", symbol)

    def _save_disk(self, symbol: str) -> None:
        path = self.dir / "bars" / f"{_safe(symbol)}.pkl"
        try:
            with path.open("wb") as fh:
                pickle.dump(
                    {"df": self._bars[symbol], "fresh_at": self._fresh_at[symbol], "full_at": self._full_at[symbol]},
                    fh,
                )
            self._saved_at[symbol] = time.time()
        except OSError:
            log.warning("Could not write cache for %s", symbol)

    def _download(self, symbols: list[str], period: str) -> dict[str, pd.DataFrame]:
        tickers = [yahoo_symbol(s) for s in symbols]
        try:
            raw = yf.download(
                tickers,
                period=period,
                interval="1d",
                group_by="ticker",
                auto_adjust=False,
                actions=True,
                progress=False,
                threads=True,
            )
        except Exception as exc:
            log.warning("Download failed for %d symbols: %s", len(symbols), exc)
            return {}
        out: dict[str, pd.DataFrame] = {}
        if raw is None or raw.empty:
            return out
        multi = isinstance(raw.columns, pd.MultiIndex)
        for symbol, ticker in zip(symbols, tickers):
            try:
                df = raw[ticker] if multi else raw
            except KeyError:
                continue
            if "Close" not in df:
                continue
            df = df.dropna(subset=["Close"]).rename(columns={"Stock Splits": "Splits"})
            if df.empty:
                continue
            for col in ("Dividends", "Splits", "Volume"):
                if col not in df:
                    df[col] = 0.0
            df = df[BAR_COLUMNS].astype(float).fillna({"Dividends": 0.0, "Splits": 0.0, "Volume": 0.0})
            idx = pd.DatetimeIndex(df.index)
            if idx.tz is not None:
                idx = idx.tz_localize(None)
            df.index = idx.normalize()
            df = df[~df.index.duplicated(keep="last")].sort_index()
            df.columns.name = None
            out[symbol] = df
        return out

    def _fetch(self, symbols: list[str], full: bool) -> None:
        now = time.time()
        for i in range(0, len(symbols), BATCH):
            chunk = symbols[i : i + BATCH]
            want_full = [s for s in chunk if full or now - self._full_at.get(s, 0) > DAY or s not in self._bars]
            want_inc = [s for s in chunk if s not in want_full]
            if want_full:
                data = self._download(want_full, HISTORY_PERIOD)
                with self._lock:
                    for s in want_full:
                        if s in data:
                            self._bars[s] = data[s]
                            self._fresh_at[s] = self._full_at[s] = time.time()
                            self._missing.pop(s, None)
                            self._save_disk(s)
                            if self.on_bars:
                                self.on_bars(s, data[s])
                        elif s not in self._bars:
                            self._missing[s] = time.time()
            if want_inc:
                data = self._download(want_inc, "5d")
                resplit: list[str] = []
                with self._lock:
                    for s in want_inc:
                        new = data.get(s)
                        if new is None:
                            continue
                        if (new["Splits"] > 0).any() and (self._bars[s]["Splits"].reindex(new.index).fillna(0) == 0).all():
                            resplit.append(s)  # a fresh split rewrites history
                            continue
                        old = self._bars[s]
                        self._bars[s] = pd.concat([old[~old.index.isin(new.index)], new]).sort_index()
                        self._fresh_at[s] = time.time()
                        if time.time() - self._saved_at.get(s, 0) > 600:
                            self._save_disk(s)
                        if self.on_bars:
                            self.on_bars(s, self._bars[s])  # the hook decides how far back it still needs
                if resplit:
                    self._fetch(resplit, full=True)

    def _refresh_async(self, symbols: list[str]) -> None:
        with self._lock:
            todo = [s for s in symbols if s not in self._refreshing]
            self._refreshing.update(todo)
        if not todo:
            return

        def run() -> None:
            try:
                self._fetch(todo, full=False)
            except Exception:
                log.exception("Background refresh failed")
            finally:
                with self._lock:
                    self._refreshing.difference_update(todo)

        self._pool.submit(run)

    def bars(self, symbols: Iterable[str]) -> dict[str, pd.DataFrame]:
        wanted = list(dict.fromkeys(normalize(s) for s in symbols))
        now = time.time()
        ttl = self._ttl()
        need: list[str] = []
        stale: list[str] = []
        with self._lock:
            for s in wanted:
                if s not in self._bars:
                    self._load_disk(s)
                if s not in self._bars:
                    if now - self._missing.get(s, 0) > 3600:
                        need.append(s)
                elif now - self._fresh_at.get(s, 0) > ttl:
                    stale.append(s)
        if need:
            with self._fetch_lock:
                still = [s for s in need if s not in self._bars]
                if still:
                    self._fetch(still, full=True)
        if stale:
            self._refresh_async(stale)
        with self._lock:
            return {s: self._bars[s] for s in wanted if s in self._bars}

    def closes(self, symbols: Iterable[str], start: pd.Timestamp | None = None) -> pd.DataFrame:
        data = self.bars(symbols)
        if not data:
            return pd.DataFrame()
        frame = pd.DataFrame({s: df["Close"] for s, df in data.items()}).sort_index()
        return frame[frame.index >= start] if start is not None else frame

    # ---------------------------------------------------------------- quotes
    @staticmethod
    def _quote(symbol: str, df: pd.DataFrame) -> dict:
        last = df.iloc[-1]
        price = float(last["Close"])
        prev = float(df["Close"].iloc[-2]) if len(df) > 1 else price
        year = df.iloc[-252:]
        avg_volume = float(df["Volume"].iloc[-21:-1].mean()) if len(df) > 2 else float(last["Volume"])
        return {
            "symbol": symbol,
            "price": price,
            "prev_close": prev,
            "change": price - prev,
            "change_pct": (price / prev - 1) * 100 if prev else 0.0,
            "open": float(last["Open"]),
            "high": float(last["High"]),
            "low": float(last["Low"]),
            "volume": float(last["Volume"]),
            "avg_volume": avg_volume,
            "high_52w": float(year["High"].max()),
            "low_52w": float(year["Low"].min()),
            "as_of": df.index[-1].date().isoformat(),
        }

    def quotes(self, symbols: Iterable[str]) -> dict[str, dict]:
        return {s: self._quote(s, df) for s, df in self.bars(symbols).items() if not df.empty}

    def quote(self, symbol: str) -> dict | None:
        return self.quotes([symbol]).get(normalize(symbol))

    def spark(self, symbol: str, points: int = 30) -> list[float]:
        df = self.bars([symbol]).get(normalize(symbol))
        return [] if df is None else [round(float(v), 2) for v in df["Close"].iloc[-points:]]

    def splits(self, symbol: str) -> list[tuple[pd.Timestamp, float]]:
        df = self.bars([symbol]).get(normalize(symbol))
        if df is None:
            return []
        s = df["Splits"]
        return [(d, float(v)) for d, v in s[s > 0].items()]

    def dividends(self, symbol: str) -> list[tuple[pd.Timestamp, float]]:
        df = self.bars([symbol]).get(normalize(symbol))
        if df is None:
            return []
        s = df["Dividends"]
        return [(d, float(v)) for d, v in s[s > 0].items()]

    def trailing_dividend(self, symbol: str) -> float:
        cutoff = pd.Timestamp.now().normalize() - pd.Timedelta(days=365)
        return sum(v for d, v in self.dividends(symbol) if d >= cutoff)

    # ------------------------------------------------------ cached metadata
    def _meta_path(self, kind: str, symbol: str) -> Path:
        folder = self.dir / "meta" / kind
        folder.mkdir(parents=True, exist_ok=True)
        return folder / f"{_safe(symbol)}.json"

    def _cached(self, kind: str, symbol: str, ttl: float, loader: Callable[[], object], wait: bool = True):
        """Stale-while-revalidate cache for slow per-symbol lookups."""
        key = (kind, symbol)
        entry = self._meta.get(key)
        if entry is None:
            path = self._meta_path(kind, symbol)
            if path.exists():
                try:
                    saved = json.loads(path.read_text(encoding="utf-8"))
                    entry = (saved["at"], saved["data"])
                    self._meta[key] = entry
                except (OSError, ValueError, KeyError):
                    entry = None

        def refresh():
            try:
                data = loader()
            except Exception as exc:
                log.info("%s lookup failed for %s: %s", kind, symbol, exc)
                data = None
            finally:
                self._meta_inflight.discard(key)
            if data is None:
                return None
            self._meta[key] = (time.time(), data)
            try:
                self._meta_path(kind, symbol).write_text(json.dumps({"at": time.time(), "data": data}), encoding="utf-8")
            except (OSError, TypeError):
                pass
            return data

        if entry is not None:
            if time.time() - entry[0] > ttl and key not in self._meta_inflight:
                self._meta_inflight.add(key)
                self._pool.submit(refresh)
            return entry[1]
        if not wait:
            if key not in self._meta_inflight:
                self._meta_inflight.add(key)
                self._pool.submit(refresh)
            return None
        return refresh()

    def info(self, symbol: str, wait: bool = True) -> dict:
        symbol = normalize(symbol)

        def load() -> dict | None:
            raw = yf.Ticker(yahoo_symbol(symbol)).info or {}
            if not raw.get("longName") and not raw.get("shortName") and not raw.get("marketCap"):
                return None
            d2e = _num(raw.get("debtToEquity"))
            return {
                "name": raw.get("longName") or raw.get("shortName"),
                "sector_raw": raw.get("sector"),
                "industry_raw": raw.get("industry"),
                "summary": raw.get("longBusinessSummary"),
                "website": raw.get("website"),
                "employees": raw.get("fullTimeEmployees"),
                "city": raw.get("city"),
                "market_cap": _num(raw.get("marketCap")),
                "pe": _num(raw.get("trailingPE")),
                "forward_pe": _num(raw.get("forwardPE")),
                "pb": _num(raw.get("priceToBook")),
                "eps": _num(raw.get("trailingEps")),
                "book_value": _num(raw.get("bookValue")),
                "roe": _num(raw.get("returnOnEquity")),
                "roa": _num(raw.get("returnOnAssets")),
                "debt_to_equity": d2e / 100 if d2e is not None else None,
                "beta": _num(raw.get("beta")),
                "profit_margin": _num(raw.get("profitMargins")),
                "operating_margin": _num(raw.get("operatingMargins")),
                "revenue_growth": _num(raw.get("revenueGrowth")),
                "earnings_growth": _num(raw.get("earningsGrowth")),
                "shares": _num(raw.get("sharesOutstanding")),
                "exchange": raw.get("exchange"),
                "quote_type": raw.get("quoteType"),
            }

        return self._cached("info", symbol, DAY, load, wait=wait) or {}

    @staticmethod
    def _statement(df: pd.DataFrame | None, lines: list[tuple[str, str, list[str]]]) -> dict:
        if df is None or df.empty:
            return {"periods": [], "rows": []}
        df = df.loc[:, sorted(df.columns)].iloc[:, -6:]
        periods = [pd.Timestamp(c).date().isoformat() for c in df.columns]
        rows = []
        for key, label, candidates in lines:
            source = next((c for c in candidates if c in df.index), None)
            if source is None:
                continue
            values = [_num(v) for v in df.loc[source]]
            if any(v is not None for v in values):
                rows.append({"key": key, "label": label, "values": values})
        return {"periods": periods, "rows": rows}

    def financials(self, symbol: str, wait: bool = True) -> dict:
        symbol = normalize(symbol)

        def load() -> dict | None:
            t = yf.Ticker(yahoo_symbol(symbol))
            out = {
                "income": {
                    "annual": self._statement(t.income_stmt, INCOME_LINES),
                    "quarterly": self._statement(t.quarterly_income_stmt, INCOME_LINES),
                },
                "balance": {
                    "annual": self._statement(t.balance_sheet, BALANCE_LINES),
                    "quarterly": self._statement(t.quarterly_balance_sheet, BALANCE_LINES),
                },
                "cashflow": {
                    "annual": self._statement(t.cashflow, CASHFLOW_LINES),
                    "quarterly": self._statement(t.quarterly_cashflow, CASHFLOW_LINES),
                },
            }
            if not out["income"]["annual"]["rows"] and not out["balance"]["annual"]["rows"]:
                return None
            out["ratios"] = _derived_ratios(out)
            return out

        empty = {"periods": [], "rows": []}
        blank = {k: {"annual": empty, "quarterly": empty} for k in ("income", "balance", "cashflow")}
        return self._cached("financials", symbol, 7 * DAY, load, wait=wait) or {**blank, "ratios": {}}

    def calendar(self, symbol: str, wait: bool = True) -> dict:
        symbol = normalize(symbol)

        def load() -> dict | None:
            cal = yf.Ticker(yahoo_symbol(symbol)).calendar or {}
            earnings = cal.get("Earnings Date") or []
            if not isinstance(earnings, (list, tuple)):
                earnings = [earnings]
            ex_div = cal.get("Ex-Dividend Date")
            return {
                "earnings_dates": [d.isoformat() for d in earnings if d is not None],
                "ex_dividend_date": ex_div.isoformat() if ex_div is not None else None,
            }

        return self._cached("calendar", symbol, DAY / 2, load, wait=wait) or {}

    def intraday(self, symbol: str, period: str, interval: str) -> list[dict]:
        symbol = normalize(symbol)
        key = ("intraday", f"{symbol}:{period}:{interval}")
        hit = self._meta.get(key)
        if hit and time.time() - hit[0] < 60:
            return hit[1]  # type: ignore[return-value]
        try:
            df = yf.Ticker(yahoo_symbol(symbol)).history(period=period, interval=interval, auto_adjust=False)
        except Exception as exc:
            log.info("Intraday lookup failed for %s: %s", symbol, exc)
            return hit[1] if hit else []  # type: ignore[return-value]
        rows = [
            {
                "t": ts.isoformat(),
                "o": round(float(r["Open"]), 2),
                "h": round(float(r["High"]), 2),
                "l": round(float(r["Low"]), 2),
                "c": round(float(r["Close"]), 2),
                "v": float(r["Volume"]),
            }
            for ts, r in df.dropna(subset=["Close"]).iterrows()
        ]
        self._meta[key] = (time.time(), rows)
        return rows

    def news(self, symbol: str, name: str) -> list[dict]:
        """Recent headlines for a company from Google News, newest first.

        Headlines are third-party text: show or summarise them, never act on them."""
        symbol = normalize(symbol)

        def load() -> list[dict] | None:
            import httpx
            from email.utils import parsedate_to_datetime
            from xml.etree import ElementTree

            plain = symbol.lstrip("^")
            query = f'"{name}" when:21d' if symbol.startswith("^") else f'("{name}" OR "{plain} share" OR "{plain} stock") when:21d'
            res = httpx.get(
                "https://news.google.com/rss/search",
                params={"q": query, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"},
                headers={"User-Agent": "Mozilla/5.0 (WealthOS)"},
                timeout=12.0,
                follow_redirects=True,
            )
            res.raise_for_status()
            items, seen = [], set()
            for node in ElementTree.fromstring(res.text).findall("./channel/item"):
                source = (node.findtext("source") or "").strip()
                title = (node.findtext("title") or "").strip()
                if source and title.endswith(f" - {source}"):
                    title = title[: -len(source) - 3].strip()
                key = re.sub(r"[^a-z0-9]+", "", title.lower())[:60]
                # Quote pages and price tickers are not news.
                if not title or key in seen or re.search(r"stock price, news|share price today live|quote and history", title, re.I):
                    continue
                seen.add(key)
                try:
                    published = parsedate_to_datetime(node.findtext("pubDate") or "").isoformat()
                except (TypeError, ValueError):
                    continue
                items.append({"title": title[:220], "source": source, "published": published, "url": node.findtext("link") or ""})
            items.sort(key=lambda i: i["published"], reverse=True)
            return items[:12]

        return self._cached("news", symbol, 1800, load) or []  # type: ignore[return-value]

    # ------------------------------------------------------------ discovery
    def instrument(self, symbol: str) -> dict:
        s = normalize(symbol)
        if s in INSTRUMENTS:
            return INSTRUMENTS[s].as_dict()
        if s in INDICES:
            return {"symbol": s, "name": INDICES[s][0], "sector": "Index", "industry": "Index", "asset_class": "Index"}
        info = self.info(s, wait=False)
        raw_sector = info.get("sector_raw")
        return {
            "symbol": s,
            "name": info.get("name") or s,
            "sector": YAHOO_SECTORS.get(raw_sector, raw_sector or "Other"),
            "industry": info.get("industry_raw") or "Other",
            "asset_class": "Funds & ETFs" if info.get("quote_type") in ("ETF", "MUTUALFUND") else "Equity",
        }

    def search(self, query: str, limit: int = 12) -> list[dict]:
        q = query.strip().upper()
        if not q:
            return []
        scored: list[tuple[int, dict]] = []
        words = q.split()
        for sym, inst in INSTRUMENTS.items():
            name = inst.name.upper()
            if sym == q:
                rank = 0
            elif sym.startswith(q):
                rank = 1
            elif name.startswith(q) or any(w.startswith(q) for w in name.split()):
                rank = 2
            elif q in sym or q in name:
                rank = 3
            elif len(words) > 1 and _loosely(words, name.split()):
                rank = 4
            else:
                continue
            scored.append((rank, inst.as_dict()))
        for sym, (name, short) in INDICES.items():
            if q in name.upper() or q in short:
                scored.append((2, {"symbol": sym, "name": name, "sector": "Index", "industry": "Index", "asset_class": "Index"}))
        scored.sort(key=lambda r: (r[0], r[1]["symbol"]))
        results = [r for _, r in scored][:limit]
        if len(results) < 5 and len(q) >= 2:
            results.extend(r for r in self._remote_search(q) if r["symbol"] not in {x["symbol"] for x in results})
        return results[:limit]

    def _remote_search(self, q: str) -> list[dict]:
        def load() -> list[dict] | None:
            found = yf.Search(q, max_results=10, news_count=0).quotes
            out = []
            for item in found:
                if item.get("exchange") not in ("NSI", "BSE") or item.get("quoteType") not in ("EQUITY", "ETF"):
                    continue
                raw_sector = item.get("sector")
                out.append(
                    {
                        "symbol": normalize(item["symbol"]),
                        "name": item.get("longname") or item.get("shortname") or item["symbol"],
                        "sector": YAHOO_SECTORS.get(raw_sector, raw_sector or "Other"),
                        "industry": item.get("industry") or "Other",
                        "asset_class": "Funds & ETFs" if item.get("quoteType") == "ETF" else "Equity",
                    }
                )
            return out

        return self._cached("search", q, DAY, load) or []  # type: ignore[return-value]

    # --------------------------------------------------------------- warmup
    def warm(self, then: Callable[[], None] | None = None) -> None:
        """Prime the cache for the tracked universe without blocking startup.
        `then` runs once prices are in, before the slower company lookups begin."""

        def run() -> None:
            try:
                loaded = self.bars(list(INDICES) + list(INSTRUMENTS))
                if self.on_bars:  # frames served from the disk cache still need mirroring
                    for symbol, frame in loaded.items():
                        self.on_bars(symbol, frame)
                if then:
                    try:
                        then()
                    except Exception:
                        log.exception("The step after warm-up failed")
                for symbol in EQUITY_UNIVERSE:
                    self.info(symbol, wait=False)
                    time.sleep(0.15)
            except Exception:
                log.exception("Warm-up failed")

        threading.Thread(target=run, name="market-warm", daemon=True).start()


def _derived_ratios(statements: dict) -> dict:
    """ROE / ROCE / leverage from the latest annual statements."""

    def latest(section: str, key: str) -> float | None:
        for row in statements[section]["annual"]["rows"]:
            if row["key"] == key:
                return next((v for v in reversed(row["values"]) if v is not None), None)
        return None

    net_income, equity = latest("income", "net_income"), latest("balance", "equity")
    ebit = latest("income", "ebit") or latest("income", "operating_income")
    assets, current_liab = latest("balance", "total_assets"), latest("balance", "current_liabilities")
    debt = latest("balance", "total_debt")
    ratios: dict[str, float | None] = {"roe": None, "roce": None, "debt_to_equity": None}
    if net_income is not None and equity:
        ratios["roe"] = net_income / equity
    if ebit is not None and assets and current_liab is not None and assets - current_liab > 0:
        ratios["roce"] = ebit / (assets - current_liab)
    if debt is not None and equity:
        ratios["debt_to_equity"] = debt / equity
    return ratios
