"""Serve the built web app from the same address as the API.

In development the web app runs on Vite's own server and none of this is used.
In a deployment, `WEB_DIR` points at the frontend's `dist` folder and one
service answers for both: `/api/...` is the API, anything else is the app.
Being on one address means no CORS to configure, and it is what lets a browser
offer to install the app.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response

from .config import Settings

# Vite names these files after their contents, so a browser can keep them for good.
FOREVER = "public, max-age=31536000, immutable"
# The page, the service worker and the app manifest are re-checked on every
# visit; otherwise an installed app would never notice an update.
FRESH = "no-cache"
DAY = "public, max-age=86400"
# Named outright, because what a machine guesses for these varies, and a browser
# refuses a script or an app manifest that arrives labelled as anything else.
TYPES = {".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".woff2": "font/woff2"}
# A request for one of these that matches no file is a missing file, not a page of the app.
FILES = {".js", ".css", ".map", ".png", ".ico", ".svg", ".jpg", ".webp", ".woff2", ".json", ".webmanifest", ".txt"}


def runtime_config(settings: Settings) -> str:
    """What the page needs to know about this deployment, as a script it loads
    before the app. The Supabase anon key is public by design: it is the key
    browsers sign in with, and row-level security is what guards the data."""
    config = {"supabaseUrl": settings.supabase_url, "supabaseAnonKey": settings.supabase_anon_key}
    return f"window.__WEALTHOS__ = {json.dumps(config)};\n"


def page(root: Path, public_url: str) -> str:
    """index.html, with the share picture given its full address when one is known."""
    html = (root / "index.html").read_text(encoding="utf-8")
    base = public_url.strip().rstrip("/")
    if base:
        html = html.replace('content="/og-image.png"', f'content="{base}/og-image.png"')
        html = html.replace('<meta property="og:type"', f'<meta property="og:url" content="{base}/" />\n    <meta property="og:type"', 1)
    return html


def serve_web(app: FastAPI, settings: Settings, root: Path, public_url: str = "") -> None:
    """Register the app's pages and files. Call it after the API routes, so they are matched first."""
    root = root.resolve()
    html = page(root, public_url)
    config = runtime_config(settings)

    @app.api_route("/config.js", methods=["GET", "HEAD"], include_in_schema=False)
    def config_js() -> Response:
        return Response(config, media_type="text/javascript", headers={"Cache-Control": FRESH})

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def web(path: str) -> Response:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found")
        try:
            file = (root / path).resolve()
            found = bool(path) and file.is_file() and file.is_relative_to(root)
        except (OSError, ValueError):  # an address no file could have
            found = False
        if found:
            fresh = file.suffix in {".html", ".webmanifest"} or file.name in {"sw.js", "registerSW.js"}
            cache = FOREVER if path.startswith("assets/") else FRESH if fresh else DAY
            return FileResponse(file, media_type=TYPES.get(file.suffix.lower()), headers={"Cache-Control": cache})
        if path.startswith("assets/") or Path(path).suffix.lower() in FILES:
            raise HTTPException(404, "Not found")
        # Every other address is a page of the app, which works out what to show itself.
        return HTMLResponse(html, headers={"Cache-Control": FRESH})
