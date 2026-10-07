from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .deps import get_market
from .market.persist import MarketPersistence
from .routers import assistant, lab, market, meta, portfolios, tradecheck, workspace
from .web import serve_web

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("wealthos")
logging.getLogger("httpx").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    data = get_market()
    if settings.supabase_configured and settings.supabase_service_role_key:
        persistence = MarketPersistence(settings.supabase_url, settings.supabase_service_role_key, settings.cache_dir)
        data.on_bars = persistence.submit
    data.warm()
    log.info("WealthOS API ready (accounts=%s, demo=%s)", settings.supabase_configured, settings.demo_enabled)
    yield


# The API's own reference lives under /api, leaving /docs to the app's public docs page.
app = FastAPI(title="WealthOS API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Demo-Session"],
)

for module in (meta, portfolios, market, workspace, lab, assistant, tradecheck):
    app.include_router(module.router)

_web = get_settings().web_dir
if _web and (Path(_web) / "index.html").is_file():
    # Render tells a service its own address; anywhere else, set PUBLIC_URL.
    serve_web(app, get_settings(), Path(_web), get_settings().public_url or os.environ.get("RENDER_EXTERNAL_URL", ""))
elif _web:
    log.warning("WEB_DIR is set to %s but there is no index.html in it; serving the API only", _web)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Something went wrong on the server."}, status_code=500)
