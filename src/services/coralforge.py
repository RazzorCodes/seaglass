from __future__ import annotations

import requests as http
from flask import Blueprint, current_app, jsonify, render_template, request

bp = Blueprint("coralforge", __name__)


def _url() -> str:
    return current_app.config["CORALFORGE_URL"]


def _proxy_resp(r):
    if r.status_code == 204:
        return "", 204
    return (r.content or b"{}"), r.status_code, {"Content-Type": "application/json"}


@bp.get("/api/coralforge/health")
def api_health():
    try:
        r = http.get(f"{_url()}/healthz", timeout=3)
        status = "online" if r.status_code == 200 else "degraded"
    except http.ConnectionError:
        status = "offline"
    except http.Timeout:
        status = "degraded"
    except http.RequestException:
        status = "offline"
    return jsonify({"service": "coralforge", "status": status})


@bp.get("/api/coralforge/repos")
def api_repos():
    try:
        r = http.get(f"{_url()}/api/v1/repos", timeout=10)
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.get("/api/coralforge/runs")
def api_runs():
    target = request.args.get("target", "")
    run_type = request.args.get("run_type", "")
    limit = request.args.get("limit", "25")
    params: dict = {"limit": limit}
    if target:
        params["target"] = target
    if run_type:
        params["run_type"] = run_type
    try:
        r = http.get(f"{_url()}/api/v1/runs", params=params, timeout=10)
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.post("/api/coralforge/runs")
def api_trigger_run():
    body = request.get_json(silent=True) or {}
    try:
        r = http.post(f"{_url()}/api/v1/runs", json=body, timeout=15)
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.get("/api/coralforge/runs/<run_id>")
def api_get_run(run_id):
    refresh = request.args.get("refresh", "1")
    try:
        r = http.get(f"{_url()}/api/v1/runs/{run_id}", params={"refresh": refresh}, timeout=15)
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.get("/api/coralforge/runs/<run_id>/logs")
def api_run_logs(run_id):
    try:
        r = http.get(f"{_url()}/api/v1/runs/{run_id}/logs", timeout=30)
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.get("/api/coralforge/repos/<name>/stable")
def api_repo_stable(name):
    try:
        r = http.get(f"{_url()}/api/v1/repo", params={"op": "stable", "target": name}, timeout=10)
        return _proxy_resp(r)
    except http.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@bp.get("/partial/coralforge/runs/toolbar")
def partial_runs_toolbar():
    return render_template("partials/coralforge/runs_toolbar.html")


@bp.get("/partial/coralforge/runs/results")
def partial_runs_results():
    return render_template("partials/coralforge/runs_results.html")
