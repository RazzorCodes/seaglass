from __future__ import annotations

import time

import requests as http
from flask import Blueprint, current_app, jsonify, render_template, request, session

bp = Blueprint("brinecrypt", __name__)


def _url() -> str:
    return current_app.config["BRINECRYPT_URL"]


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


@bp.post("/api/brinecrypt/login")
def api_login():
    data = request.get_json(silent=True) or {}
    user = data.get("user", "")
    passwd = data.get("pass", "")
    try:
        r = http.post(
            f"{_url()}/auth/login", json={"user": user, "pass": passwd}, timeout=5
        )
        if r.ok:
            resp = r.json() if r.content else {}
            token = (
                resp.get("session_token")
                or resp.get("token")
                or resp.get("access_token")
            )
            refresh = resp.get("refresh_token")
            session["bc_session_token"] = token
            session["bc_refresh_token"] = refresh
            session["bc_user"] = user
            session["bc_token_time"] = time.time()
            return jsonify({"success": True, "user": user})
        return jsonify(
            {"success": False, "error": r.text or "Unauthorized"}
        ), r.status_code
    except http.RequestException as exc:
        return jsonify({"success": False, "error": str(exc)}), 502


@bp.post("/api/brinecrypt/refresh")
def api_refresh():
    refresh_token = session.get("bc_refresh_token")
    if not refresh_token:
        return jsonify({"success": False, "error": "No refresh token"}), 401
    try:
        r = http.post(
            f"{_url()}/auth/refresh", json={"refresh_token": refresh_token}, timeout=5
        )
        if r.ok:
            resp = r.json() if r.content else {}
            token = (
                resp.get("session_token")
                or resp.get("token")
                or resp.get("access_token")
            )
            refresh = resp.get("refresh_token", refresh_token)
            session["bc_session_token"] = token
            session["bc_refresh_token"] = refresh
            session["bc_token_time"] = time.time()
            return jsonify({"success": True})
        return jsonify(
            {"success": False, "error": f"Refresh failed ({r.status_code})"}
        ), r.status_code
    except http.RequestException as exc:
        return jsonify({"success": False, "error": str(exc)}), 502


@bp.post("/api/brinecrypt/token")
def api_store_token():
    data = request.get_json(silent=True) or {}
    session["bc_session_token"] = data.get("session_token")
    session["bc_refresh_token"] = data.get("refresh_token")
    session["bc_user"] = data.get("user")
    session["bc_token_time"] = time.time()
    return jsonify({"success": True})


@bp.post("/api/brinecrypt/logout")
def api_logout():
    for key in ("bc_session_token", "bc_refresh_token", "bc_user", "bc_token_time"):
        session.pop(key, None)
    return jsonify({"success": True})


@bp.get("/api/brinecrypt/session")
def api_session():
    user = session.get("bc_user")
    token = session.get("bc_session_token")
    if user and token:
        return jsonify({"logged_in": True, "user": user})
    return jsonify({"logged_in": False})


# ── JSON proxy ────────────────────────────────────────────────────────────────


@bp.get("/api/brinecrypt/v1")
def api_v1_proxy():
    path = request.args.get("path", "").strip().lstrip("/")
    token = session.get("bc_session_token")
    if not token:
        return jsonify({"error": "Not logged in"}), 401
    if not path:
        return jsonify({"error": "path required"}), 400
    params = {}
    if request.args.get("version"):
        params["version"] = request.args["version"]
    try:
        r = http.get(
            f"{_url()}/api/v1/{path}",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
            timeout=5,
        )
        if r.ok:
            return (
                (r.content or b"{}"),
                r.status_code,
                {"Content-Type": "application/json"},
            )
        return jsonify(
            {"error": f"HTTP {r.status_code}: {r.text[:300]}"}
        ), r.status_code
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.delete("/api/brinecrypt/v1")
def api_v1_delete_proxy():
    path = request.args.get("path", "").strip().lstrip("/")
    token = session.get("bc_session_token")
    if not token:
        return jsonify({"error": "Not logged in"}), 401
    if not path:
        return jsonify({"error": "path required"}), 400
    try:
        r = http.delete(
            f"{_url()}/api/v1/{path}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        if r.ok:
            return b"{}", 200, {"Content-Type": "application/json"}
        return jsonify(
            {"error": f"HTTP {r.status_code}: {r.text[:300]}"}
        ), r.status_code
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.put("/api/brinecrypt/v1")
def api_v1_put_proxy():
    path = request.args.get("path", "").strip().lstrip("/")
    token = session.get("bc_session_token")
    if not token:
        return jsonify({"error": "Not logged in"}), 401
    if not path:
        return jsonify({"error": "path required"}), 400
    body = request.get_json(silent=True) or {}
    try:
        r = http.put(
            f"{_url()}/api/v1/{path}",
            headers={"Authorization": f"Bearer {token}"},
            json=body,
            timeout=5,
        )
        if r.ok:
            return b"{}", 200, {"Content-Type": "application/json"}
        return jsonify(
            {"error": f"HTTP {r.status_code}: {r.text[:300]}"}
        ), r.status_code
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


# ── Admin proxy ───────────────────────────────────────────────────────────────


def _admin_headers():
    token = session.get("bc_session_token")
    if not token:
        return None, (jsonify({"error": "Not logged in"}), 401)
    return {"Authorization": f"Bearer {token}"}, None


@bp.get("/api/brinecrypt/admin/users")
def admin_list_users():
    headers, err = _admin_headers()
    if err:
        return err
    try:
        r = http.get(f"{_url()}/admin/users", headers=headers, timeout=5)
        return (r.content or b"[]"), r.status_code, {"Content-Type": "application/json"}
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.get("/api/brinecrypt/admin/users/<name>")
def admin_get_user(name):
    headers, err = _admin_headers()
    if err:
        return err
    try:
        r = http.get(f"{_url()}/admin/users/{name}", headers=headers, timeout=5)
        return (r.content or b"{}"), r.status_code, {"Content-Type": "application/json"}
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.post("/api/brinecrypt/admin/users")
def admin_create_user():
    headers, err = _admin_headers()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        r = http.post(f"{_url()}/admin/users", headers=headers, json=body, timeout=5)
        return (
            ("", r.status_code)
            if r.status_code == 204
            else (
                r.content or b"{}",
                r.status_code,
                {"Content-Type": "application/json"},
            )
        )
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.delete("/api/brinecrypt/admin/users/<name>")
def admin_delete_user(name):
    headers, err = _admin_headers()
    if err:
        return err
    try:
        r = http.delete(f"{_url()}/admin/users/{name}", headers=headers, timeout=5)
        return (
            ("", r.status_code)
            if r.status_code == 204
            else (
                r.content or b"{}",
                r.status_code,
                {"Content-Type": "application/json"},
            )
        )
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.post("/api/brinecrypt/admin/permissions")
def admin_grant_permissions():
    headers, err = _admin_headers()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        r = http.post(
            f"{_url()}/admin/permissions", headers=headers, json=body, timeout=5
        )
        return (
            ("", r.status_code)
            if r.status_code == 204
            else (
                r.content or b"{}",
                r.status_code,
                {"Content-Type": "application/json"},
            )
        )
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.delete("/api/brinecrypt/admin/permissions")
def admin_revoke_permissions():
    headers, err = _admin_headers()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        r = http.delete(
            f"{_url()}/admin/permissions", headers=headers, json=body, timeout=5
        )
        return (
            ("", r.status_code)
            if r.status_code == 204
            else (
                r.content or b"{}",
                r.status_code,
                {"Content-Type": "application/json"},
            )
        )
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
    path = request.args.get("path", "").strip()
    if not path:
        return render_template(
            "partials/brinecrypt/resources_results.html",
            data=None,
            error=None,
            path=None,
        )
    token = session.get("bc_session_token")
    if not token:
        return render_template(
            "partials/brinecrypt/resources_results.html",
            data=None,
            error="Not logged in. Please authenticate above.",
            path=path,
        )
    try:
        r = http.get(
            f"{_url()}/api/v1/{path.lstrip('/')}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        if r.ok:
            result = r.json() if r.content else {}
            return render_template(
                "partials/brinecrypt/resources_results.html",
                data=result,
                error=None,
                path=path,
            )
        return render_template(
            "partials/brinecrypt/resources_results.html",
            data=None,
            error=f"HTTP {r.status_code}: {r.text[:300]}",
            path=path,
        )
    except http.RequestException as exc:
        return render_template(
            "partials/brinecrypt/resources_results.html",
            data=None,
            error=str(exc),
            path=path,
        )
