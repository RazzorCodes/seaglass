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


def _calc_mbs(size: int, dur: float) -> float:
    return size * 8 / 1_000_000 / dur if dur else 0


# ── Data pipeline ──────────────────────────────────────────────────────────────

def _enrich(items: list[dict]) -> list[dict]:
    for item in items:
        dur  = item.get("duration") or 0
        size = item.get("size") or 0
        res  = item.get("resolution")
        item["_size"]     = _fmt_bytes(size)
        item["_duration"] = _fmt_duration(dur)
        item["_quality"]  = _quality_label(res) or "Unknown"
        raw_codec = (item.get("codec") or "").lower()
        item["_codec"] = {"hevc": "H.265", "h264": "H.264", "av1": "AV1"}.get(raw_codec, raw_codec.upper() or "???")
        item["_res"]      = f"{res[0]}x{res[1]}" if isinstance(res, list) and len(res) == 2 else "—"
        item["_ar"]       = item.get("dar") or item.get("sar") or "—"
        item["_mbs"]      = f"{_calc_mbs(size, dur):.2f} Mb/s"
    return items


def _filter(items: list[dict], args) -> list[dict]:
    if q := args.get("q", "").strip().lower():
        items = [i for i in items
                 if q in (i.get("name") or "").lower()
                 or q in (i.get("path") or "").lower()]
    _alias = {"h265": "hevc", "hevc": "h265"}
    if statuses := [s.lower() for s in args.getlist("status") if s]:
        items = [i for i in items if (i.get("status") or "").lower() in statuses]
    if status_ne := [s.lower() for s in args.getlist("status_ne") if s]:
        items = [i for i in items if (i.get("status") or "").lower() not in status_ne]
    if codecs := [c.lower() for c in args.getlist("codec") if c]:
        items = [i for i in items if any(
            c in (i.get("codec") or "").lower()
            or _alias.get(c, "") in (i.get("codec") or "").lower()
            for c in codecs
        )]
    if codec_ne := [c.lower() for c in args.getlist("codec_ne") if c]:
        items = [i for i in items if not any(
            c in (i.get("codec") or "").lower()
            or _alias.get(c, "") in (i.get("codec") or "").lower()
            for c in codec_ne
        )]
    if qualities := [q.lower() for q in args.getlist("quality") if q]:
        items = [i for i in items if any(
            q in _quality_label(i.get("resolution")).lower() for q in qualities
        )]
    if quality_ne := [q.lower() for q in args.getlist("quality_ne") if q]:
        items = [i for i in items if not any(
            q in _quality_label(i.get("resolution")).lower() for q in quality_ne
        )]
    if ars := [a.strip() for a in args.getlist("ar") if a.strip()]:
        items = [i for i in items if (i.get("dar") or i.get("sar") or "").strip() in ars]
    if ar_ne := [a.strip() for a in args.getlist("ar_ne") if a.strip()]:
        items = [i for i in items if (i.get("dar") or i.get("sar") or "").strip() not in ar_ne]
    if raw := args.get("mbs_gte"):
        try:
            items = [i for i in items if _calc_mbs(i.get("size") or 0, i.get("duration") or 0) >= float(raw)]
        except ValueError:
            pass
    if raw := args.get("mbs_lte"):
        try:
            items = [i for i in items if _calc_mbs(i.get("size") or 0, i.get("duration") or 0) <= float(raw)]
        except ValueError:
            pass
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
        if col == "mbs":
            return _calc_mbs(item.get("size") or 0, item.get("duration") or 0)
        if col == "ar":       return (item.get("dar") or item.get("sar") or "").lower()
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

@bp.get("/partial/transflux/library/toolbar")
def partial_library_toolbar():
    ar_values: list[str] = []
    try:
        r = http.get(f"{_url()}/list", timeout=10)
        if r.ok:
            seen: set[str] = set()
            for item in r.json():
                ar = (item.get("dar") or item.get("sar") or "").strip()
                if ar and ar not in seen:
                    seen.add(ar)
                    ar_values.append(ar)
            ar_values.sort()
    except http.RequestException:
        pass
    return render_template("partials/transflux/library_toolbar.html", ar_values=ar_values)


@bp.get("/partial/transflux/library/results")
def partial_library_results():
    try:
        r = http.get(f"{_url()}/list", timeout=10)
        r.raise_for_status()
        items = _enrich(_sort(_filter(r.json(), request.args), request.args))
        return render_template("partials/transflux/library_results.html", items=items, args=request.args, error=None)
    except http.RequestException as exc:
        return render_template("partials/transflux/library_results.html", items=None, args=request.args, error=str(exc))


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
        if r.ok:
            ver = r.json().get("version")
            return jsonify({"service": "transflux", "status": "online",
                            "version": f"v{ver}" if ver else None})
        return jsonify({"service": "transflux", "status": "degraded"})
    except http.RequestException:
        return jsonify({"service": "transflux", "status": "offline"})
