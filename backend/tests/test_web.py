"""Serving the built web app from the API's own address, checked against a
small stand-in for the frontend's dist folder."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.web import FOREVER, FRESH, serve_web

PAGE = """<!doctype html>
<html><head>
    <meta property="og:type" content="website" />
    <meta property="og:image" content="/og-image.png" />
</head><body><div id="root"></div></body></html>"""


@pytest.fixture
def site(tmp_path):
    """A dist folder beside a file that must never be served."""
    (tmp_path / "secret.env").write_text("KEY=do-not-serve")
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(PAGE)
    (root / "assets" / "app-abc123.js").write_text("console.log('app')")
    (root / "sw.js").write_text("// service worker")
    (root / "manifest.webmanifest").write_text("{}")
    (root / "logo-mark.png").write_bytes(b"\x89PNG")
    return root


def client(root, public_url="", **settings) -> TestClient:
    app = FastAPI()

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    serve_web(app, Settings(_env_file=None, **settings), root, public_url)
    return TestClient(app)


def test_pages_of_the_app_all_get_the_page(site):
    c = client(site)
    for path in ("/", "/docs", "/market", "/lab/trade-check", "/stock/RELIANCE.NS"):
        r = c.get(path)
        assert r.status_code == 200, path
        assert '<div id="root">' in r.text
        assert r.headers["cache-control"] == FRESH


def test_api_routes_are_not_shadowed(site):
    c = client(site)
    assert c.get("/api/health").json() == {"status": "ok"}
    # An unknown API address is a 404, not the page.
    assert c.get("/api/nope").status_code == 404


def test_files_and_how_long_a_browser_may_keep_them(site):
    c = client(site)
    asset = c.get("/assets/app-abc123.js")
    assert asset.headers["cache-control"] == FOREVER
    assert asset.headers["content-type"].startswith("text/javascript")
    # The service worker and manifest are re-checked every visit, or an update never arrives.
    assert c.get("/sw.js").headers["cache-control"] == FRESH
    manifest = c.get("/manifest.webmanifest")
    assert manifest.headers["cache-control"] == FRESH
    assert manifest.headers["content-type"].startswith("application/manifest+json")
    assert c.get("/logo-mark.png").headers["content-type"] == "image/png"


def test_a_missing_file_is_a_404_not_the_page(site):
    c = client(site)
    assert c.get("/assets/gone-after-a-deploy.js").status_code == 404
    assert c.get("/missing.png").status_code == 404


@pytest.mark.parametrize("path", ["/../secret.env", "/%2e%2e/secret.env", "/..%2fsecret.env", "/assets/../../secret.env"])
def test_nothing_outside_the_folder_is_served(site, path):
    r = client(site).get(path)
    assert "do-not-serve" not in r.text


def test_config_js_carries_the_supabase_settings(site):
    r = client(site, supabase_url="https://example.supabase.co", supabase_anon_key="anon-key").get("/config.js")
    assert r.headers["content-type"].startswith("text/javascript")
    assert r.headers["cache-control"] == FRESH
    assert '"supabaseUrl": "https://example.supabase.co"' in r.text
    assert '"supabaseAnonKey": "anon-key"' in r.text
    # The service-role key must never reach a browser.
    secret = client(site, supabase_service_role_key="service-secret").get("/config.js")
    assert "service-secret" not in secret.text


def test_share_picture_gets_its_full_address(site):
    plain = client(site).get("/").text
    assert 'content="/og-image.png"' in plain
    full = client(site, public_url="https://wealthos.example.com/").get("/").text
    assert 'content="https://wealthos.example.com/og-image.png"' in full
    assert '<meta property="og:url" content="https://wealthos.example.com/" />' in full
