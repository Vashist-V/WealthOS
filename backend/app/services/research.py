"""Research tools for Claude: search the news, search the web, read a page, and
pull the app's own data on any stock.

Claude on Amazon Bedrock has no built-in web search, so the server does the
searching and reading itself and hands Claude the results. The searches use
public feeds that need no key: Bing News and Bing web results as RSS, with
DuckDuckGo and Google News standing in when Bing returns nothing.

Two rules keep this safe, because a page can say anything:
- A page can only be read if its address came back from a search in this
  conversation, or the user typed it. A page that tells the model to "fetch
  https://somewhere/?data=..." cannot send the user's data anywhere.
- Only public internet addresses are fetched, at every redirect, so nothing on
  the server's own network can be reached.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, unquote, urljoin, urlparse
from xml.etree import ElementTree

import httpx

log = logging.getLogger("wealthos.research")

_BROWSER = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "en-IN,en;q=0.9",
}
PAGE_CHARS = 9000
PAGE_BYTES = 2_000_000
RESULTS = 8
_cache: dict[tuple, tuple[float, object]] = {}


def _remember(key: tuple, seconds: float, value: object) -> object:
    if len(_cache) > 96:
        for old in sorted(_cache, key=lambda k: _cache[k][0])[:32]:
            _cache.pop(old, None)
    _cache[key] = (time.time() + seconds, value)
    return value


def _recall(key: tuple) -> object | None:
    hit = _cache.get(key)
    return hit[1] if hit and hit[0] > time.time() else None


def _clean(text: str | None) -> str:
    text = re.sub(r"<[^>]+>", " ", unescape(text or ""))
    return re.sub(r"\s+", " ", text).strip()


def _date(raw: str | None) -> str:
    try:
        when = parsedate_to_datetime(raw or "")
    except (TypeError, ValueError):
        return ""
    return f"{when.day} {when:%b %Y}"


def host(url: str) -> str:
    return (urlparse(url).hostname or "").removeprefix("www.")


# ---------------------------------------------------------------- searching
async def _get(client: httpx.AsyncClient, url: str, **params) -> httpx.Response:
    res = await client.get(url, params=params, headers=_BROWSER, timeout=12.0, follow_redirects=True)
    res.raise_for_status()
    return res


def _rss(text: str) -> list[ElementTree.Element]:
    return ElementTree.fromstring(text).findall("./channel/item")


async def search_news(query: str) -> list[dict]:
    """Recent news articles, newest first."""
    key = ("news", query.lower())
    if (hit := _recall(key)) is not None:
        return hit  # type: ignore[return-value]
    items: list[dict] = []
    async with httpx.AsyncClient() as client:
        try:
            res = await _get(client, "https://www.bing.com/news/search", q=query, format="rss", cc="IN", setlang="en-IN")
            for node in _rss(res.text):
                link = node.findtext("link") or ""
                # Bing wraps each link in its own click-through address; the article is in its "url" parameter.
                url = parse_qs(urlparse(link).query).get("url", [link])[0]
                source = next((child.text or "" for child in node if child.tag.endswith("}Source")), "") or host(url)
                items.append({"title": _clean(node.findtext("title")), "url": url, "source": source,
                              "date": _date(node.findtext("pubDate")), "snippet": _clean(node.findtext("description"))[:320]})
        except (httpx.HTTPError, ElementTree.ParseError) as exc:
            log.info("Bing News search failed: %s", exc)
        if not items:
            # Google News has the widest Indian coverage, but its links are redirect pages that only a browser follows:
            # fine to cite, not to read.
            try:
                res = await _get(client, "https://news.google.com/rss/search", q=f"{query} when:30d", hl="en-IN", gl="IN", ceid="IN:en")
                for node in _rss(res.text):
                    source = (node.findtext("source") or "").strip()
                    title = _clean(node.findtext("title"))
                    if source and title.endswith(f" - {source}"):
                        title = title[: -len(source) - 3]
                    items.append({"title": title, "url": node.findtext("link") or "", "source": source,
                                  "date": _date(node.findtext("pubDate")), "snippet": ""})
            except (httpx.HTTPError, ElementTree.ParseError) as exc:
                log.info("Google News search failed: %s", exc)
    items = [i for i in items if i["title"] and i["url"].startswith("http")][:RESULTS]
    return _remember(key, 900 if items else 60, items)  # type: ignore[return-value]


_DDG_RESULT = re.compile(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</a>', re.S)


async def search_web(query: str) -> list[dict]:
    """Web pages for a query: Bing, or DuckDuckGo when Bing returns nothing."""
    key = ("web", query.lower())
    if (hit := _recall(key)) is not None:
        return hit  # type: ignore[return-value]
    items: list[dict] = []
    async with httpx.AsyncClient() as client:
        try:
            res = await _get(client, "https://www.bing.com/search", q=query, format="rss", cc="IN", setlang="en-IN")
            for node in _rss(res.text):
                url = node.findtext("link") or ""
                items.append({"title": _clean(node.findtext("title")), "url": url, "source": host(url),
                              "date": "", "snippet": _clean(node.findtext("description"))[:320]})
        except (httpx.HTTPError, ElementTree.ParseError) as exc:
            log.info("Bing web search failed: %s", exc)
        if len(items) < 3:
            try:
                res = await client.post("https://html.duckduckgo.com/html/", data={"q": query, "kl": "in-en"}, headers=_BROWSER,
                                        timeout=12.0, follow_redirects=True)
                res.raise_for_status()
                for href, title, snippet in _DDG_RESULT.findall(res.text):
                    href = unescape(href)
                    url = unquote(parse_qs(urlparse(href).query).get("uddg", [href])[0])
                    if url.startswith("//"):
                        url = "https:" + url
                    items.append({"title": _clean(title), "url": url, "source": host(url), "date": "", "snippet": _clean(snippet)[:320]})
            except httpx.HTTPError as exc:
                log.info("DuckDuckGo search failed: %s", exc)
    seen: set[str] = set()
    unique = []
    for item in items:
        if item["title"] and item["url"].startswith("http") and item["url"] not in seen:
            seen.add(item["url"])
            unique.append(item)
    unique = unique[:RESULTS]
    return _remember(key, 900 if unique else 60, unique)  # type: ignore[return-value]


# ------------------------------------------------------------------ reading
def _public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%")[0])
    except ValueError:
        return False
    return ip.is_global and not ip.is_multicast


async def public_address(url: str) -> bool:
    """Whether a URL is http(s) and every address its host resolves to is on the public internet."""
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80),
                                                             type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        return False
    return bool(infos) and all(_public(info[4][0]) for info in infos)


class _Text(HTMLParser):
    """The readable text of an article: headings, paragraphs and list items, without menus, scripts or footers."""

    SKIP = {"script", "style", "noscript", "nav", "footer", "aside", "form", "svg", "button", "iframe", "header", "figure"}
    KEEP = {"p", "h1", "h2", "h3", "h4", "li", "td", "th", "blockquote", "pre"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skipping = 0
        self.keeping = 0
        self.parts: list[str] = []
        self.current: list[str] = []
        self.title = ""
        self.in_title = False
        self.meta: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            name = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
            if name in ("description", "og:description", "article:published_time", "og:site_name", "datepublished", "publish-date"):
                self.meta.setdefault(name, a.get("content") or "")
        elif tag == "title":
            self.in_title = True
        elif tag in self.SKIP:
            self.skipping += 1
        elif tag in self.KEEP and not self.skipping:
            self.keeping += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        elif tag in self.SKIP and self.skipping:
            self.skipping -= 1
        elif tag in self.KEEP and self.keeping:
            self.keeping -= 1
            if not self.keeping:
                line = re.sub(r"\s+", " ", "".join(self.current)).strip()
                if len(line) > 25 or (tag in ("h1", "h2", "h3") and line):
                    self.parts.append(line)
                self.current = []

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif self.keeping and not self.skipping:
            self.current.append(data)


async def read_page(url: str) -> dict:
    """The title, publication, date and main text of one page."""
    key = ("page", url)
    if (hit := _recall(key)) is not None:
        return hit  # type: ignore[return-value]
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=8.0)) as client:
        current = url
        for _ in range(5):
            if not await public_address(current):
                raise ValueError("That address is not a public web page.")
            async with client.stream("GET", current, headers={**_BROWSER, "Accept": "text/html,application/xhtml+xml,text/plain"}) as res:
                if res.is_redirect and res.headers.get("location"):
                    current = urljoin(current, res.headers["location"])
                    continue
                if res.status_code in (401, 402, 403, 451):
                    raise ValueError(f"{host(current)} would not let the server read this page (it may be paywalled or block automated readers).")
                res.raise_for_status()
                kind = res.headers.get("content-type", "")
                if "pdf" in kind:
                    raise ValueError("This is a PDF, which the server cannot read. Use the search result's snippet instead.")
                body = bytearray()
                async for chunk in res.aiter_bytes():
                    body += chunk
                    if len(body) > PAGE_BYTES:
                        break
                text = body.decode(res.encoding or "utf-8", "replace")
            break
        else:
            raise ValueError("The page redirected too many times.")
    if "html" not in kind and "<html" not in text[:500].lower():
        page = {"url": current, "title": host(current), "site": host(current), "date": "", "text": text[:PAGE_CHARS]}
        return _remember(key, 1800, page)  # type: ignore[return-value]
    parser = _Text()
    try:
        parser.feed(text)
    except Exception:  # a malformed page still yields what was read before the fault
        pass
    body_text = "\n".join(dict.fromkeys(parser.parts))
    meta = parser.meta
    if len(body_text) < 200:
        body_text = (meta.get("description") or meta.get("og:description") or "") + "\n" + body_text
    published = meta.get("article:published_time") or meta.get("datepublished") or meta.get("publish-date") or ""
    page = {
        "url": current,
        "title": re.sub(r"\s+", " ", parser.title).strip() or host(current),
        "site": meta.get("og:site_name") or host(current),
        "date": published[:10],
        "text": body_text.strip()[:PAGE_CHARS],
    }
    return _remember(key, 1800, page)  # type: ignore[return-value]


# ------------------------------------------------------------------ toolbox
SEARCH_NEWS = {
    "name": "search_news",
    "description": (
        "Search recent news articles from the Indian and global business press (via Bing News). Returns up to 8 articles, "
        "newest first, each with its title, publication, date, link and a snippet. Use it for anything recent: why a stock, "
        "sector or the market moved, quarterly results and how they were received, management commentary and guidance, "
        "deals, orders, regulatory or legal news, rating changes. Write a specific query: the company or topic plus what you "
        "want, e.g. 'Infosys Q2 FY27 results guidance' or 'Nifty fell today reason'."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "What to search the news for."}},
        "required": ["query"],
    },
}
SEARCH_WEB = {
    "name": "search_web",
    "description": (
        "Search the web (Bing, falling back to DuckDuckGo). Returns up to 8 pages with title, link and snippet. Use it for "
        "facts that are not news: a company's investor presentation or annual report, NSE/BSE filings, RBI and SEBI rules, "
        "tax rules on capital gains and dividends, how an index or ratio is defined. For recent events prefer search_news."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "What to search the web for."}},
        "required": ["query"],
    },
}
READ_PAGE = {
    "name": "read_page",
    "description": (
        "Read the main text of a web page (up to about 9,000 characters): an article or page that search_news or search_web "
        "returned in this conversation, or a link the user gave. Use it when a snippet is not enough, to get the actual "
        "figures, quotes and details before relying on them. Some sites block automated readers; if one does, try another "
        "result. Only addresses that came back from a search here can be read."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"url": {"type": "string", "description": "The page's full address, exactly as a search returned it."}},
        "required": ["url"],
    },
}
GET_STOCK = {
    "name": "get_stock_data",
    "description": (
        "The app's full briefing on any NSE stock, ETF or index it can find: latest price, returns over 1 week to 5 years "
        "against the Nifty 50, trend and risk (moving averages, RSI, volatility, beta, largest fall), fundamentals (market "
        "cap, P/E, P/B, ROE, ROCE, debt to equity, margins, growth), revenue and net profit by year, dividends, splits, "
        "upcoming results, the user's own position, trades and journal notes for it, and recent headlines. Use it whenever "
        "the user asks about a company other than the one already briefed, or wants companies compared side by side. "
        "Accepts an NSE symbol (TCS, HDFCBANK, ^NSEI) or a company name."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"stock": {"type": "string", "description": "NSE symbol or company name, e.g. 'TCS' or 'Tata Motors'."}},
        "required": ["stock"],
    },
}


@dataclass
class ExtraTool:
    """A tool one chat adds for itself, answered from data the chat already holds."""
    definition: dict
    run: Callable[[dict], str]
    status: Callable[[dict], str]


def _listing(items: list[dict], what: str) -> str:
    if not items:
        return f"No {what} found for that query. Try different words."
    lines = []
    for n, item in enumerate(items, 1):
        meta = " · ".join(part for part in (item["source"], item["date"], item["url"]) if part)
        lines.append(f"{n}. {item['title']}\n   {meta}" + (f"\n   {item['snippet']}" if item["snippet"] else ""))
    return "\n".join(lines)


_URL = re.compile(r"https?://[^\s<>\"')\]]+")


class Toolbox:
    """The tools one answer may use, and what they found, so the answer's sources can be listed."""

    def __init__(self, ctx=None, extra: list[ExtraTool] | None = None) -> None:
        self.ctx = ctx
        self.extra = {tool.definition["name"]: tool for tool in (extra or [])}
        # Every page a search returned or a page was read at: its title and publication, for listing sources.
        self.found: dict[str, dict] = {}
        self.read: list[str] = []
        self.allowed: set[str] = set()

    def definitions(self) -> list[dict]:
        tools = [SEARCH_NEWS, SEARCH_WEB, READ_PAGE]
        if self.ctx is not None:
            tools.append(GET_STOCK)
        return tools + [tool.definition for tool in self.extra.values()]

    def allow_from_text(self, text: str) -> None:
        """Links the user typed may be read too."""
        self.allowed.update(_URL.findall(text or ""))

    def status(self, name: str, args: dict) -> str:
        if name == "search_news":
            return f"Searching the news for “{str(args.get('query', ''))[:60]}”"
        if name == "search_web":
            return f"Searching the web for “{str(args.get('query', ''))[:60]}”"
        if name == "read_page":
            return f"Reading {host(str(args.get('url', ''))) or 'a page'}"
        if name == "get_stock_data":
            return f"Looking up {str(args.get('stock', ''))[:40]}"
        if name in self.extra:
            return self.extra[name].status(args)
        return "Working"

    def _found(self, items: list[dict]) -> None:
        for item in items:
            self.found.setdefault(item["url"], {"title": item["title"], "source": item["source"]})
            self.allowed.add(item["url"])

    async def run(self, name: str, args: dict) -> tuple[str, bool]:
        """The tool's result as text for the model, and whether it failed."""
        try:
            if name == "search_news":
                items = await search_news(str(args["query"])[:200])
                self._found(items)
                return _listing(items, "news articles"), False
            if name == "search_web":
                items = await search_web(str(args["query"])[:200])
                self._found(items)
                return _listing(items, "web pages"), False
            if name == "read_page":
                url = str(args["url"]).strip()
                if url not in self.allowed:
                    return "Only pages that a search in this conversation returned, or that the user linked, can be read.", True
                page = await read_page(url)
                self.read.append(url)
                self.found.setdefault(url, {"title": page["title"], "source": page["site"]})
                if page["url"] != url:
                    self.found.setdefault(page["url"], self.found[url])
                head = f"{page['title']}\n{page['site']}" + (f", published {page['date']}" if page["date"] else "") + f"\n{page['url']}\n\n"
                return head + (page["text"] or "The page had no readable text."), False
            if name == "get_stock_data":
                return await asyncio.to_thread(self._stock, str(args["stock"])), False
            if name in self.extra:
                return await asyncio.to_thread(self.extra[name].run, args), False
            return f"There is no tool called {name}.", True
        except KeyError as exc:
            return f"The {name} tool needs a {exc.args[0]!r} value.", True
        except ValueError as exc:
            return str(exc), True
        except httpx.HTTPStatusError as exc:
            return f"{host(str(exc.request.url))} answered with an error ({exc.response.status_code}). Try another result.", True
        except httpx.HTTPError:
            return "The page could not be reached in time. Try another result.", True
        except Exception as exc:  # a tool failing must not end the answer; the model can work around it
            log.warning("Tool %s failed: %s", name, exc)
            detail = getattr(exc, "detail", None)
            return str(detail) if detail else "That lookup failed. Answer with what you have, and say what could not be checked.", True

    def _stock(self, query: str) -> str:
        from ..market.universe import INDICES, INSTRUMENTS, normalize
        from .assistant import build_briefing, render_briefing

        wanted = normalize(query.strip())
        symbol = wanted if wanted in INSTRUMENTS or wanted in INDICES else None
        if symbol is None:
            matches = self.ctx.market.search(query, limit=5)
            if not matches:
                return f"The app could not find a stock called {query!r}. Try its NSE symbol."
            symbol = matches[0]["symbol"]
        return render_briefing(build_briefing(self.ctx, symbol))

    def sources(self, answer: str) -> list[dict]:
        """The pages behind an answer: those it links to, in the order it links them, then any other page read for it."""
        cited = [url.rstrip(".,;:") for url in _URL.findall(answer)]
        out: dict[str, dict] = {}
        for url in [*cited, *self.read]:
            info = self.found.get(url)
            if info and url not in out:
                out[url] = {"title": info["title"], "url": url, "label": info["source"] or host(url)}
        return list(out.values())[:8]
