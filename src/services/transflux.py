from __future__ import annotations

import math

import requests as http
from flask import Blueprint, current_app, jsonify, render_template, request

bp = Blueprint("transflux", __name__)


# ── Config ─────────────────────────────────────────────────────────────────────

def _url() -> str:
    return current_app.config["TRANSFLUX_URL"]


# ── Formatting ─────────────────────────────────────────────────────────────────

def _fmt_bytes(b: int | None) -> str:
    if not b:
        return "0 B"
    units = ("B", "KB", "MB", "GB", "TB")
    i = min(int(math.log(b, 1024)), len(units) - 1)
    return f"{b / 1024 ** i:.1f} {units[i]}"


def _fmt_duration(secs: float | None) -> str:
    if not secs:
        return "0m"
    h, m = divmod(int(secs / 60), 60)
    return f"{h}h {m}m" if h else f"{m}m"


def _quality_label(res: list | None) -> str:
    if not isinstance(res, list) or len(res) < 2:
        return ""
    h = res[1]
    for threshold, label in ((2160, "4K"), (1440, "1440p"), (1080, "1080p"), (720, "720p"), (480, "480p")):
        if h >= threshold:
            return label
    return f"{h}p"


# ── Data pipeline ──────────────────────────────────────────────────────────────

def _enrich(items: list[dict]) -> list[dict]:
    for item in items:
        dur  = item.get("duration") or 0
        size = item.get("size") or 0
        res  = item.get("resolution")
        item["_size"]     = _fmt_bytes(size)
        item["_duration"] = _fmt_duration(dur)
        item["_quality"]  = _quality_label(res) or "Unknown"
        item["_codec"]    = item.get("codec") or "???"
        item["_res"]      = f"{res[0]}x{res[1]}" if isinstance(res, list) and len(res) == 2 else "—"
        item["_ar"]       = item.get("dar") or item.get("sar") or "—"
        item["_mbs"]      = f"{size * 8 / 1_000_000 / dur:.2f} Mb/s" if dur else "0 Mb/s"
    return items


def _filter(items: list[dict], args) -> list[dict]:
    if q := args.get("q", "").strip().lower():
        items = [i for i in items
                 if q in (i.get("name") or "").lower()
                 or q in (i.get("path") or "").lower()]

    for raw in args.getlist("filter"):
        kind, _, val = raw.partition("|")
        if not val:
            continue
        if kind == "status":
            items = [i for i in items if (i.get("status") or "").lower() == val.lower()]
        elif kind == "codec":
            items = [i for i in items if val.lower() in (i.get("codec") or "").lower()]
        elif kind == "quality":
            items = [i for i in items if val.lower() in _quality_label(i.get("resolution")).lower()]

    return items


def _sort(items: list[dict], args) -> list[dict]:
    col = args.get("sort", "")
    if not col:
        return items
    reverse = args.get("dir", "asc") == "desc"

    def key(item):
        if col == "name":     return (item.get("name") or item.get("path") or "").lower()
        if col == "status":   return (item.get("status") or "").lower()
        if col == "size":     return item.get("size") or 0
        if col == "duration": return item.get("duration") or 0
        if col == "quality":
            r = item.get("resolution")
            return r[1] if isinstance(r, list) and len(r) >= 2 else 0
        if col == "codec":    return (item.get("codec") or "").lower()
        return ""

    return sorted(items, key=key, reverse=reverse)


# ── Proxy ──────────────────────────────────────────────────────────────────────

def _proxy(method: str, path: str, *, timeout: int = 5, **kwargs) -> tuple[dict, int]:
    try:
        r = http.request(method, f"{_url()}{path}", timeout=timeout, **kwargs)
        return (r.json() if r.content else {}), r.status_code
    except http.Timeout:
        return {"error": "upstream timed out"}, 504
    except http.RequestException as exc:
        return {"error": str(exc)}, 502


# ── Partials ───────────────────────────────────────────────────────────────────

@bp.get("/partial/transflux/library")
def partial_library():
    try:
        r = http.get(f"{_url()}/list", timeout=10)
        r.raise_for_status()
        items = _enrich(_sort(_filter(r.json(), request.args), request.args))
        return render_template("partials/transflux/library.html", items=items, args=request.args, error=None)
    except http.RequestException as exc:
        return render_template("partials/transflux/library.html", items=None, args=request.args, error=str(exc))


@bp.get("/partial/transflux/queue")
def partial_queue():
    try:
        r = http.get(f"{_url()}/status", timeout=5)
        r.raise_for_status()
        tasks = [{"uuid": k, **v} for k, v in r.json().items()]
        return render_template("partials/transflux/queue.html", tasks=tasks)
    except http.RequestException:
        return render_template("partials/transflux/queue.html", tasks=[])


# ── Actions ────────────────────────────────────────────────────────────────────

@bp.put("/api/transflux/scan")
def api_scan():
    body, status = _proxy("PUT", "/scan", timeout=10)
    return jsonify(body), status


@bp.put("/api/transflux/process/<item_hash>")
def api_process(item_hash: str):
    body, status = _proxy("PUT", f"/process/{item_hash}")
    return jsonify(body), status


@bp.put("/api/transflux/process-batch")
def api_process_batch():
    hashes = request.get_json(silent=True) or request.form.getlist("hash")
    results = [_proxy("PUT", f"/process/{h}")[1] < 300 for h in hashes]
    return jsonify({"queued": sum(results), "failed": results.count(False)})


@bp.delete("/api/transflux/cancel/<task_uuid>")
def api_cancel(task_uuid: str):
    body, status = _proxy("DELETE", f"/cancel/{task_uuid}")
    return jsonify(body), status


# ── Health ─────────────────────────────────────────────────────────────────────

@bp.get("/api/transflux/health")
def api_health():
    try:
        r = http.get(f"{_url()}/version", timeout=3)
        status = "online" if r.ok else "degraded"
    except http.RequestException:
        status = "offline"
    return jsonify({"service": "transflux", "status": status})
