from __future__ import annotations

import httpx
from fastapi import HTTPException

from .base import Filters, Row

PAGE = 1000

_client = httpx.Client(timeout=20.0, limits=httpx.Limits(max_keepalive_connections=20))


def _quote(value) -> str:
    text = str(value)
    if any(ch in text for ch in ',()"\\ '):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def _params(filters: Filters | None) -> dict[str, str]:
    params: dict[str, str] = {}
    for col, want in (filters or {}).items():
        if isinstance(want, (list, tuple, set)):
            params[col] = "in.(" + ",".join(_quote(v) for v in want) + ")"
        elif want is None:
            params[col] = "is.null"
        elif isinstance(want, bool):
            params[col] = f"is.{str(want).lower()}"
        else:
            params[col] = f"eq.{want}"
    return params


class SupabaseStore:
    """PostgREST client acting as the signed-in user (RLS enforces ownership)."""

    def __init__(self, url: str, api_key: str, access_token: str, user_id: str):
        self.user_id = user_id
        self._base = f"{url.rstrip('/')}/rest/v1"
        self._headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, table: str, *, params=None, json=None, headers=None) -> httpx.Response:
        try:
            res = _client.request(
                method,
                f"{self._base}/{table}",
                params=params,
                json=json,
                headers={**self._headers, **(headers or {})},
            )
        except httpx.HTTPError as exc:
            raise HTTPException(503, f"Database unreachable: {exc.__class__.__name__}") from exc
        if res.status_code >= 400:
            try:
                payload = res.json()
            except ValueError:
                payload = {}
            if payload.get("code") in ("PGRST205", "42P01"):  # table missing: schema not applied yet
                raise HTTPException(
                    503,
                    "The database isn't set up yet. Run supabase/migrations/0001_wealthos_schema.sql "
                    "in the Supabase SQL editor, then reload.",
                )
            if payload.get("code") == "23505":
                raise HTTPException(409, "That already exists.")
            status = res.status_code if res.status_code in (400, 401, 403, 404, 409) else 502
            raise HTTPException(status, payload.get("message") or res.text)
        return res

    def list(self, table: str, filters: Filters | None = None, order: str | None = None) -> list[Row]:
        params = _params(filters)
        params["select"] = "*"
        if order:
            params["order"] = order
        rows: list[Row] = []
        start = 0
        while True:
            res = self._request(
                "GET", table, params=params, headers={"Range-Unit": "items", "Range": f"{start}-{start + PAGE - 1}"}
            )
            page = res.json()
            rows.extend(page)
            if len(page) < PAGE:
                return rows
            start += PAGE

    def get(self, table: str, id: str) -> Row | None:
        rows = self._request("GET", table, params={"id": f"eq.{id}", "select": "*"}).json()
        return rows[0] if rows else None

    def insert(self, table: str, rows: Row | list[Row]) -> list[Row]:
        batch = [rows] if isinstance(rows, dict) else rows
        if not batch:
            return []
        return self._request("POST", table, json=batch, headers={"Prefer": "return=representation"}).json()

    def update(self, table: str, id: str, patch: Row) -> Row | None:
        rows = self._request(
            "PATCH", table, params={"id": f"eq.{id}"}, json=patch, headers={"Prefer": "return=representation"}
        ).json()
        return rows[0] if rows else None

    def delete(self, table: str, filters: Filters) -> int:
        if not filters:
            raise ValueError("Refusing to delete without filters")
        res = self._request("DELETE", table, params=_params(filters), headers={"Prefer": "return=representation"})
        return len(res.json())

    def upsert(self, table: str, rows: list[Row], on_conflict: str) -> list[Row]:
        if not rows:
            return []
        return self._request(
            "POST",
            table,
            params={"on_conflict": on_conflict},
            json=rows,
            headers={"Prefer": "resolution=merge-duplicates,return=representation"},
        ).json()


def verify_token(url: str, api_key: str, access_token: str) -> dict:
    """Ask Supabase Auth who this token belongs to. Raises 401 when invalid."""
    try:
        res = _client.get(
            f"{url.rstrip('/')}/auth/v1/user",
            headers={"apikey": api_key, "Authorization": f"Bearer {access_token}"},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Auth service unreachable") from exc
    if res.status_code != 200:
        raise HTTPException(401, "Invalid or expired session")
    return res.json()
