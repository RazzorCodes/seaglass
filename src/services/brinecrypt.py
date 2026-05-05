from __future__ import annotations

import time

import requests as http
from flask import Blueprint, current_app, jsonify, render_template, request, session

bp = Blueprint("brinecrypt", __name__)


def _url() -> str:
    return current_app.config["BRINECRYPT_URL"]


# ── Auth endpoints ─────────────────────────────────────────────────────────────


@bp.post("/api/brinecrypt/login")
def api_login():
    data = request.get_json(silent=True) or {}
    user = data.get("user", "")
    passwd = data.get("pass", "")
    try:
        r = http.post(f"{_url()}/auth/login", json={"user": user, "pass": passwd}, timeout=5)
        if r.ok:
            resp = r.json() if r.content else {}
            token = resp.get("session_token") or resp.get("token") or resp.get("access_token")
            refresh = resp.get("refresh_token")
            session["bc_session_token"] = token
            session["bc_refresh_token"] = refresh
            session["bc_user"] = user
            session["bc_token_time"] = time.time()
            return jsonify({"success": True, "user": user})
        return jsonify({"success": False, "error": r.text or "Unauthorized"}), r.status_code
    except http.RequestException as exc:
        return jsonify({"success": False, "error": str(exc)}), 502


@bp.post("/api/brinecrypt/refresh")
def api_refresh():
    refresh_token = session.get("bc_refresh_token")
    if not refresh_token:
        return jsonify({"success": False, "error": "No refresh token"}), 401
    try:
        r = http.post(f"{_url()}/auth/refresh", json={"refresh_token": refresh_token}, timeout=5)
        if r.ok:
            resp = r.json() if r.content else {}
            token = resp.get("session_token") or resp.get("token") or resp.get("access_token")
            refresh = resp.get("refresh_token", refresh_token)
            session["bc_session_token"] = token
            session["bc_refresh_token"] = refresh
            session["bc_token_time"] = time.time()
            return jsonify({"success": True})
        return jsonify({"success": False, "error": f"Refresh failed ({r.status_code})"}), r.status_code
    except http.RequestException as exc:
        return jsonify({"success": False, "error": str(exc)}), 502


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
            return (r.content or b"{}"), r.status_code, {"Content-Type": "application/json"}
        return jsonify({"error": f"HTTP {r.status_code}: {r.text[:300]}"}), r.status_code
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


# ── Partials ───────────────────────────────────────────────────────────────────


@bp.get("/partial/brinecrypt/resources/toolbar")
def partial_resources_toolbar():
    return render_template("partials/brinecrypt/resources_toolbar.html")


@bp.get("/partial/brinecrypt/resources/results")
def partial_resources_results():
    path = request.args.get("path", "").strip()
    if not path:
        return render_template("partials/brinecrypt/resources_results.html",
                               data=None, error=None, path=None)
    token = session.get("bc_session_token")
    if not token:
        return render_template("partials/brinecrypt/resources_results.html",
                               data=None, error="Not logged in. Please authenticate above.", path=path)
    try:
        r = http.get(
            f"{_url()}/api/v1/{path.lstrip('/')}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        if r.ok:
            result = r.json() if r.content else {}
            return render_template("partials/brinecrypt/resources_results.html",
                                   data=result, error=None, path=path)
        return render_template("partials/brinecrypt/resources_results.html",
                               data=None, error=f"HTTP {r.status_code}: {r.text[:300]}", path=path)
    except http.RequestException as exc:
        return render_template("partials/brinecrypt/resources_results.html",
                               data=None, error=str(exc), path=path)
