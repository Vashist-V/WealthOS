"""The two Store implementations: the PostgREST client is checked against a
recorded transport, the demo store against a temp directory."""
import json

import httpx
import pytest
from fastapi import HTTPException

from app.store import supabase as sb
from app.store.memory import DemoRegistry, MemoryStore


class Recorder:
    """Stands in for PostgREST: records requests and replays canned responses."""

    def __init__(self, responses):
        self.requests: list[httpx.Request] = []
        self._responses = list(responses)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body = self._responses.pop(0) if self._responses else (200, [])
        return httpx.Response(status, json=body)


@pytest.fixture
def store(monkeypatch):
    def make(*responses):
        recorder = Recorder(responses)
        monkeypatch.setattr(sb, "_client", httpx.Client(transport=httpx.MockTransport(recorder)))
        return sb.SupabaseStore("https://ref.supabase.co/", "publishable-key", "user-jwt", "user-1"), recorder

    return make


def test_requests_act_as_the_signed_in_user(store):
    s, rec = store((200, []))
    s.list("portfolios")
    request = rec.requests[0]
    assert request.url.path == "/rest/v1/portfolios"
    assert request.headers["apikey"] == "publishable-key"
    assert request.headers["authorization"] == "Bearer user-jwt"


def test_list_builds_filters_and_order(store):
    s, rec = store((200, [{"id": "t1"}]))
    rows = s.list("transactions", {"portfolio_id": ["a", "b"], "symbol": "M&M", "closed_at": None}, order="created_at.asc")
    params = rec.requests[0].url.params
    assert rows == [{"id": "t1"}]
    assert params["portfolio_id"] == "in.(a,b)"
    assert params["symbol"] == "eq.M&M"
    assert params["closed_at"] == "is.null"
    assert params["order"] == "created_at.asc"
    assert rec.requests[0].headers["range"] == "0-999"


def test_list_pages_until_a_short_page(store):
    full = [{"id": i} for i in range(1000)]
    s, rec = store((200, full), (200, full), (200, [{"id": "last"}]))
    rows = s.list("transactions")
    assert len(rows) == 2001
    assert [r.headers["range"] for r in rec.requests] == ["0-999", "1000-1999", "2000-2999"]


def test_insert_update_delete_upsert(store):
    s, rec = store((201, [{"id": "n1"}]), (200, [{"id": "n1", "name": "x"}]), (200, [{"id": "n1"}]), (200, [{"symbol": "HAL"}]))
    assert s.insert("portfolios", {"name": "A"}) == [{"id": "n1"}]
    assert s.update("portfolios", "n1", {"name": "x"}) == {"id": "n1", "name": "x"}
    assert s.delete("portfolios", {"id": "n1"}) == 1
    assert s.upsert("holdings", [{"portfolio_id": "p", "symbol": "HAL"}], on_conflict="portfolio_id,symbol") == [{"symbol": "HAL"}]

    insert, update, delete, upsert = rec.requests
    assert insert.method == "POST" and json.loads(insert.content) == [{"name": "A"}]
    assert insert.headers["prefer"] == "return=representation"
    assert update.method == "PATCH" and update.url.params["id"] == "eq.n1"
    assert delete.method == "DELETE" and delete.url.params["id"] == "eq.n1"
    assert upsert.url.params["on_conflict"] == "portfolio_id,symbol"
    assert "resolution=merge-duplicates" in upsert.headers["prefer"]


def test_empty_writes_make_no_request(store):
    s, rec = store()
    assert s.insert("transactions", []) == []
    assert s.upsert("holdings", [], on_conflict="portfolio_id,symbol") == []
    assert rec.requests == []


def test_delete_refuses_to_run_unfiltered(store):
    s, _ = store()
    with pytest.raises(ValueError):
        s.delete("transactions", {})


def test_get_returns_none_when_row_is_hidden_or_missing(store):
    s, _ = store((200, []))
    assert s.get("portfolios", "someone-elses") is None


def test_missing_schema_is_reported_plainly(store):
    s, _ = store((404, {"code": "PGRST205", "message": "Could not find the table 'public.portfolios' in the schema cache"}))
    with pytest.raises(HTTPException) as err:
        s.list("portfolios")
    assert err.value.status_code == 503
    assert "0001_wealthos_schema.sql" in err.value.detail


def test_policy_and_conflict_errors_keep_their_status(store):
    s, _ = store((403, {"code": "42501", "message": "new row violates row-level security policy"}), (409, {"code": "23505", "message": "duplicate key"}))
    with pytest.raises(HTTPException) as denied:
        s.insert("transactions", {"portfolio_id": "not-mine"})
    assert denied.value.status_code == 403
    with pytest.raises(HTTPException) as conflict:
        s.insert("watchlist_stocks", {"watchlist_id": "w", "symbol": "HAL"})
    assert conflict.value.status_code == 409


def test_verify_token_rejects_a_bad_session(monkeypatch):
    monkeypatch.setattr(sb, "_client", httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(401, json={"msg": "invalid JWT"}))))
    with pytest.raises(HTTPException) as err:
        sb.verify_token("https://ref.supabase.co", "key", "expired")
    assert err.value.status_code == 401


# ------------------------------------------------------------- demo store
def test_memory_store_round_trip(tmp_path):
    path = tmp_path / "demo.json"
    s = MemoryStore("session-0001", path)
    a = s.insert("portfolios", {"name": "A"})[0]
    s.insert("transactions", [{"portfolio_id": a["id"], "symbol": "HAL"}, {"portfolio_id": a["id"], "symbol": "ITC"}])
    assert a["user_id"] == "demo-session-0001" and "created_at" in a
    assert [t["symbol"] for t in s.list("transactions", {"symbol": ["ITC", "TCS"]})] == ["ITC"]
    assert s.update("portfolios", a["id"], {"name": "B"})["name"] == "B"
    assert s.delete("transactions", {"portfolio_id": a["id"]}) == 2

    reloaded = MemoryStore("session-0001", path)
    assert reloaded.get("portfolios", a["id"])["name"] == "B"
    assert reloaded.list("transactions") == []


def test_memory_store_upsert_merges_on_the_conflict_key(tmp_path):
    s = MemoryStore("session-0002", tmp_path / "demo.json")
    s.upsert("holdings", [{"portfolio_id": "p", "symbol": "HAL", "quantity": 1}], on_conflict="portfolio_id,symbol")
    s.upsert("holdings", [{"portfolio_id": "p", "symbol": "HAL", "quantity": 5}], on_conflict="portfolio_id,symbol")
    rows = s.list("holdings")
    assert len(rows) == 1 and rows[0]["quantity"] == 5


def test_memory_store_batch_writes_once(tmp_path):
    path = tmp_path / "demo.json"
    s = MemoryStore("session-0003", path)
    with s.batch():
        s.insert("portfolios", {"name": "A"})
        assert not path.exists()
    assert json.loads(path.read_text())["tables"]["portfolios"][0]["name"] == "A"


def test_returned_rows_are_copies(tmp_path):
    s = MemoryStore("session-0004", tmp_path / "demo.json")
    row = s.insert("portfolios", {"name": "A"})[0]
    row["name"] = "mutated"
    assert s.get("portfolios", row["id"])["name"] == "A"


def test_registry_keeps_workspaces_apart_and_maps_share_links(tmp_path):
    registry = DemoRegistry(str(tmp_path))
    one, two = registry.get("session-aaaa"), registry.get("session-bbbb")
    one.insert("portfolios", {"name": "Mine"})
    assert two.list("portfolios") == []
    assert registry.get("session-aaaa") is one

    registry.remember_share("token-1", "session-aaaa")
    assert DemoRegistry(str(tmp_path)).session_for_share("token-1") == "session-aaaa"
    registry.forget_share("token-1")
    assert registry.session_for_share("token-1") is None
