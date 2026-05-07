from __future__ import annotations

import time

import requests as http
from flask import Blueprint, current_app, jsonify, render_template, request, session

bp = Blueprint("brinecrypt", __name__)


def _url() -> str:
    return current_app.config["BRINECRYPT_URL"]


# ── Multi-session helpers ──────────────────────────────────────────────────────

def _sessions() -> dict:
    return session.setdefault("bc_sessions", {})


def _active_token() -> str | None:
    u = session.get("bc_active_user", "anon")
    return _sessions().get(u, {}).get("token")


# ── Health ────────────────────────────────────────────────────────────────────


@bp.get("/api/brinecrypt/health")
def api_health():
    try:
        r = http.get(f"{_url()}/ready", timeout=3)
        status = "online" if r.status_code == 200 else "degraded"
    except http.ConnectionError:
        status = "offline"
    except http.Timeout:
        status = "degraded"
    except http.RequestException:
        status = "offline"
    return jsonify({"service": "brinecrypt", "status": status})


# ── Auth endpoints ─────────────────────────────────────────────────────────────


@bp.post("/api/brinecrypt/anon")
def api_anon():
    """Fetch a fresh anonymous capability token and store it in the anon session slot."""
    try:
        r = http.post(f"{_url()}/auth/anon", timeout=5)
        sess = _sessions()
        if r.ok:
            resp = r.json() if r.content else {}
            token = resp.get("token") or resp.get("cap_token") or resp.get("session_token")
            sess["anon"] = {"token": token, "token_time": time.time()}
        else:
            if "anon" not in sess:
                sess["anon"] = {"token": None, "token_time": time.time()}
        session["bc_sessions"] = sess
        if "bc_active_user" not in session:
            session["bc_active_user"] = "anon"
        return jsonify({"success": r.ok, "status": r.status_code})
    except http.RequestException as exc:
        sess = _sessions()
        if "anon" not in sess:
            sess["anon"] = {"token": None, "token_time": time.time()}
            session["bc_sessions"] = sess
        if "bc_active_user" not in session:
            session["bc_active_user"] = "anon"
        return jsonify({"success": False, "error": str(exc)}), 502


@bp.get("/api/brinecrypt/sessions")
def api_get_sessions():
    """Return the list of active sessions and the currently active user."""
    sess = _sessions()
    active = session.get("bc_active_user", "anon")
    # Ensure anon always appears first
    keys = list(sess.keys())
    if "anon" in keys:
        keys = ["anon"] + [k for k in keys if k != "anon"]
    return jsonify({"sessions": keys, "active": active})


@bp.post("/api/brinecrypt/sessions/active")
def api_set_active_session():
    """Switch the active session to a different user."""
    data = request.get_json(silent=True) or {}
    user = data.get("user")
    sess = _sessions()
    if user not in sess:
        return jsonify({"error": f"No session for '{user}'"}), 404
    session["bc_active_user"] = user
    return jsonify({"success": True, "active": user})


@bp.post("/api/brinecrypt/token")
def api_store_token():
    """Add (or replace) a named session entry from a frontend-obtained token."""
    data = request.get_json(silent=True) or {}
    user = data.get("user")
    if not user:
        return jsonify({"error": "user required"}), 400
    sess = _sessions()
    sess[user] = {
        "token": data.get("session_token"),
        "refresh_token": data.get("refresh_token"),
        "token_time": time.time(),
    }
    session["bc_sessions"] = sess
    session["bc_active_user"] = user
    return jsonify({"success": True})


@bp.post("/api/brinecrypt/logout")
def api_logout():
    """Remove one session by user name. Anon session cannot be removed."""
    data = request.get_json(silent=True) or {}
    user = data.get("user")
    sess = _sessions()
    active = session.get("bc_active_user", "anon")

    if user and user != "anon":
        sess.pop(user, None)
        session["bc_sessions"] = sess
        if active == user:
            session["bc_active_user"] = "anon"

    return jsonify({"success": True})


@bp.post("/api/brinecrypt/refresh")
def api_refresh():
    """Refresh all sessions: rotate human session tokens and renew the anon cap_ token."""
    sess = _sessions()
    results = {}

    for user, entry in list(sess.items()):
        if user == "anon":
            try:
                r = http.post(f"{_url()}/auth/anon", timeout=5)
                if r.ok:
                    resp = r.json() if r.content else {}
                    token = resp.get("token") or resp.get("cap_token") or resp.get("session_token")
                    if token:
                        sess["anon"]["token"] = token
                        sess["anon"]["token_time"] = time.time()
                    results["anon"] = "ok"
                else:
                    results["anon"] = f"failed({r.status_code})"
            except http.RequestException as exc:
                results["anon"] = f"error({exc})"
            continue

        refresh_token = entry.get("refresh_token")
        if not refresh_token:
            results[user] = "skipped"
            continue

        sess_token = entry.get("token")
        headers = {"Authorization": f"Bearer {sess_token}"} if sess_token else {}
        try:
            r = http.post(
                f"{_url()}/auth/refresh",
                json={"token": refresh_token},
                headers=headers,
                timeout=5,
            )
            if r.ok:
                resp = r.json() if r.content else {}
                new_token = (
                    resp.get("session_token")
                    or resp.get("token")
                    or resp.get("access_token")
                )
                new_refresh = resp.get("refresh_token", refresh_token)
                sess[user]["token"] = new_token
                sess[user]["refresh_token"] = new_refresh
                sess[user]["token_time"] = time.time()
                results[user] = "ok"
            else:
                results[user] = f"failed({r.status_code})"
        except http.RequestException as exc:
            results[user] = f"error({exc})"

    session["bc_sessions"] = sess
    return jsonify({"success": True, "results": results})


@bp.get("/api/brinecrypt/session")
def api_session():
    """Backward-compat: returns login status for the active session."""
    active = session.get("bc_active_user", "anon")
    tok = _sessions().get(active, {}).get("token")
    if active != "anon" and tok:
        return jsonify({"logged_in": True, "user": active})
    return jsonify({"logged_in": False})


# ── Resource proxy (new brinecrypt API shapes) ────────────────────────────────


def _proxy_headers():
    """Auth headers for the active session. Anon endpoints work without auth too."""
    tok = _active_token()
    if tok:
        return {"Authorization": f"Bearer {tok}"}
    return {}


def _proxy_err(err: str, status: int = 401):
    return jsonify({"error": err}), status


def _proxy_resp(r, empty: bytes = b"{}"):
    if r.status_code == 204:
        return "", 204
    return (r.content or empty), r.status_code, {"Content-Type": "application/json"}


@bp.get("/api/brinecrypt/v1/namespace")
def api_v1_namespace_list():
    """Proxy → GET /api/v1/namespace?op=list"""
    try:
        r = http.get(
            f"{_url()}/api/v1/namespace",
            params={"op": "list"},
            headers=_proxy_headers(),
            timeout=5,
        )
        return _proxy_resp(r, b"[]")
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.post("/api/brinecrypt/v1/namespace")
def api_v1_namespace_query():
    """Proxy → POST /api/v1/namespace?op=query"""
    body = request.get_json(silent=True) or {}
    try:
        r = http.post(
            f"{_url()}/api/v1/namespace",
            params={"op": "query"},
            headers=_proxy_headers(),
            json=body,
            timeout=5,
        )
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.post("/api/brinecrypt/v1/resource")
def api_v1_resource_query():
    """Proxy → POST /api/v1/resource?op=<query|versions>"""
    op = request.args.get("op", "query")
    body = request.get_json(silent=True) or {}
    try:
        r = http.post(
            f"{_url()}/api/v1/resource",
            params={"op": op},
            headers=_proxy_headers(),
            json=body,
            timeout=5,
        )
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.put("/api/brinecrypt/v1/resource")
def api_v1_resource_put():
    """Proxy → PUT /api/v1/resource"""
    body = request.get_json(silent=True) or {}
    try:
        r = http.put(
            f"{_url()}/api/v1/resource",
            headers=_proxy_headers(),
            json=body,
            timeout=5,
        )
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.delete("/api/brinecrypt/v1/resource")
def api_v1_resource_delete():
    """Proxy → DELETE /api/v1/resource"""
    body = request.get_json(silent=True) or {}
    try:
        r = http.delete(
            f"{_url()}/api/v1/resource",
            headers=_proxy_headers(),
            json=body,
            timeout=5,
        )
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


# ── Admin proxy ───────────────────────────────────────────────────────────────


def _admin_headers():
    tok = _active_token()
    if not tok:
        return None, (jsonify({"error": "Not logged in"}), 401)
    return {"Authorization": f"Bearer {tok}"}, None


def _admin_response(r, empty: bytes = b"{}"):
    if r.status_code == 204:
        return "", 204
    return (r.content or empty), r.status_code, {"Content-Type": "application/json"}


@bp.get("/api/brinecrypt/admin/user")
def admin_get_own_user():
    """GET /admin/user — calling user's own info (no username required)."""
    headers, err = _admin_headers()
    if err:
        return err
    try:
        r = http.get(f"{_url()}/admin/user", headers=headers, timeout=5)
        return _admin_response(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.get("/api/brinecrypt/admin/users")
def admin_list_users():
    headers, err = _admin_headers()
    if err:
        return err
    try:
        r = http.get(f"{_url()}/admin/user", params={"op": "list"}, headers=headers, timeout=5)
        return (r.content or b"[]"), r.status_code, {"Content-Type": "application/json"}
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.get("/api/brinecrypt/admin/users/<name>")
def admin_get_user(name):
    headers, err = _admin_headers()
    if err:
        return err
    try:
        r = http.get(
            f"{_url()}/admin/user",
            params={"op": "query"},
            headers=headers,
            json={"query": [{"username": name}]},
            timeout=5,
        )
        if not r.ok:
            return (r.content or b"{}"), r.status_code, {"Content-Type": "application/json"}
        resp = r.json() if r.content else {}
        results = resp.get("results", {})
        entry = results.get(f"user/{name}") or results.get(name) or {}
        return jsonify({"name": name, "permissions": entry.get("permissions", [])}), 200
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.post("/api/brinecrypt/admin/users")
def admin_create_user():
    headers, err = _admin_headers()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        r = http.post(f"{_url()}/admin/user", headers=headers, json=body, timeout=5)
        return _admin_response(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.delete("/api/brinecrypt/admin/users/<name>")
def admin_delete_user(name):
    headers, err = _admin_headers()
    if err:
        return err
    try:
        r = http.delete(f"{_url()}/admin/user/{name}", headers=headers, timeout=5)
        return _admin_response(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.post("/api/brinecrypt/admin/permissions")
def admin_grant_permissions():
    headers, err = _admin_headers()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        r = http.post(f"{_url()}/admin/permissions", headers=headers, json=body, timeout=5)
        return _admin_response(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.delete("/api/brinecrypt/admin/permissions")
def admin_revoke_permissions():
    headers, err = _admin_headers()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        r = http.delete(f"{_url()}/admin/permissions", headers=headers, json=body, timeout=5)
        return _admin_response(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


# ── Service-account principals proxy ──────────────────────────────────────────


@bp.get("/api/brinecrypt/admin/principals")
def admin_list_principals():
    headers, err = _admin_headers()
    if err:
        return err
    try:
        r = http.get(f"{_url()}/admin/principals", headers=headers, timeout=5)
        return (r.content or b"{}"), r.status_code, {"Content-Type": "application/json"}
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.post("/api/brinecrypt/admin/principals")
def admin_read_principals():
    """Proxy a targeted-read request: POST body forwarded as GET+JSON body to upstream."""
    headers, err = _admin_headers()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        r = http.get(
            f"{_url()}/admin/principals", headers=headers, json=body, timeout=5
        )
        return (r.content or b"{}"), r.status_code, {"Content-Type": "application/json"}
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


# ── Partials ───────────────────────────────────────────────────────────────────


@bp.get("/partial/brinecrypt/resources/toolbar")
def partial_resources_toolbar():
    return render_template("partials/brinecrypt/resources_toolbar.html")


@bp.get("/partial/brinecrypt/users/toolbar")
def partial_users_toolbar():
    return render_template("partials/brinecrypt/users_toolbar.html")


@bp.get("/partial/brinecrypt/users/results")
def partial_users_results():
    return render_template("partials/brinecrypt/users_results.html")


@bp.get("/partial/brinecrypt/sa/toolbar")
def partial_sa_toolbar():
    return render_template("partials/brinecrypt/sa_toolbar.html")


@bp.get("/partial/brinecrypt/sa/results")
def partial_sa_results():
    return render_template("partials/brinecrypt/sa_results.html")


@bp.get("/partial/brinecrypt/resources/results")
def partial_resources_results():
    return render_template("partials/brinecrypt/resources_results.html")
