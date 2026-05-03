import os
import json
import math
import requests
from flask import Flask, render_template, request, jsonify, make_response

app = Flask(__name__)

TRANSFLUX_URL = os.environ.get("TRANSFLUX_URL", "http://localhost:8000").rstrip("/")
BRINECRYPT_URL = os.environ.get("BRINECRYPT_URL", "http://brinecrypt.lan").rstrip("/")


def _proxy(method, path, timeout=5, **kwargs):
    try:
        r = requests.request(method, f"{TRANSFLUX_URL}{path}", timeout=timeout, **kwargs)
        body = r.json() if r.content else {}
        return jsonify(body), r.status_code
    except requests.Timeout as e:
        return jsonify({"error": str(e)}), 504
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502


# --- Formatting helpers (moved from JS) ---

def format_bytes(b):
    if not b or b == 0:
        return "0 B"
    k = 1024
    sizes = ["B", "KB", "MB", "GB", "TB"]
    i = min(int(math.log(b) / math.log(k)), len(sizes) - 1)
    return f"{b / k**i:.1f} {sizes[i]}"


def format_duration(s):
    if not s:
        return "0m"
    m = int(s / 60)
    h, rem = divmod(m, 60)
    return f"{h}h {rem}m" if h > 0 else f"{m}m"


def get_quality_label(res):
    if not res or not isinstance(res, list) or len(res) < 2:
        return ""
    h = res[1]
    if h >= 2160: return "4K"
    if h >= 1440: return "1440p"
    if h >= 1080: return "1080p"
    if h >= 720:  return "720p"
    if h >= 480:  return "480p"
    return f"{h}p"


def apply_filters(items, args):
    name_search = args.get("name_search", "").strip().lower()
    if name_search:
        items = [i for i in items
                 if name_search in (i.get("name") or "").lower()
                 or name_search in (i.get("path") or "").lower()]

    for raw in args.getlist("filter"):
        parts = raw.split("|", 2)
        if len(parts) < 2:
            continue
        ftype, fval = parts[0], parts[1]

        if ftype == "name":
            v = fval.lower()
            items = [i for i in items
                     if v in (i.get("name") or "").lower()
                     or v in (i.get("path") or "").lower()]
        elif ftype == "status":
            items = [i for i in items
                     if (i.get("status") or "").lower() == fval.lower()]
        elif ftype == "info":
            sub = fval.split("|")
            field = sub[0]
            if field in ("duration", "mb_s") and len(sub) >= 3:
                op, num = sub[1], float(sub[2])
                def metric(i, f=field):
                    d = i.get("duration") or 0
                    if f == "mb_s":
                        return (i.get("size", 0) * 8 / 1_000_000) / d if d else 0
                    return d / 60
                if op == ">=": items = [i for i in items if metric(i) >= num]
                if op == "<=": items = [i for i in items if metric(i) <= num]
            elif field == "codec" and len(sub) >= 2:
                v = sub[1].lower()
                items = [i for i in items if v in (i.get("codec") or "").lower()]
            elif field == "quality" and len(sub) >= 2:
                v = sub[1].lower()
                items = [i for i in items
                         if v in get_quality_label(i.get("resolution")).lower()]
            elif field == "ar" and len(sub) >= 2:
                v = sub[1].lower()
                items = [i for i in items
                         if v in (i.get("dar") or i.get("sar") or "").lower()]
    return items


def apply_sort(items, args):
    col = args.get("sort_col", "")
    if not col:
        return items
    reverse = args.get("sort_dir", "asc") == "desc"
    meta = args.get("sort_meta", "")

    def key(i):
        if col == "file":   return (i.get("name") or i.get("path") or "").lower()
        if col == "status": return (i.get("status") or "").lower()
        if col == "info":
            if meta == "size":     return i.get("size") or 0
            if meta == "duration": return i.get("duration") or 0
            if meta == "bitrate":
                d = i.get("duration") or 0
                return (i.get("size", 0) * 8 / 1_000_000) / d if d else 0
            if meta == "quality":
                r = i.get("resolution")
                return r[1] if isinstance(r, list) and len(r) >= 2 else 0
            if meta == "codec": return (i.get("codec") or "").lower()
        return ""

    return sorted(items, key=key, reverse=reverse)


def enrich(items):
    for i in items:
        dur  = i.get("duration") or 0
        size = i.get("size") or 0
        res  = i.get("resolution")
        i["_size_str"]     = format_bytes(size)
        i["_duration_str"] = format_duration(dur)
        i["_quality_str"]  = get_quality_label(res) or "Unknown"
        i["_codec_str"]    = i.get("codec") or "???"
        i["_res_str"]      = f"{res[0]}x{res[1]}" if isinstance(res, list) and len(res) == 2 else "-"
        i["_ar_str"]       = i.get("dar") or i.get("sar") or "-"
        i["_mbs_str"]      = f"{(size * 8 / 1_000_000) / dur:.2f} Mb/s" if dur > 0 else "0 Mb/s"
    return items


# --- Page route ---

@app.route("/")
def index():
    version_path = os.path.join(os.path.dirname(__file__), "version.txt")
    try:
        seaglass_version = open(version_path).read().strip()
    except OSError:
        seaglass_version = "unknown"
    return render_template("index.html", seaglass_version=seaglass_version)


# --- Partial routes (return HTML fragments for HTMX) ---

@app.route("/partial/list")
def partial_list():
    try:
        r = requests.get(f"{TRANSFLUX_URL}/list", timeout=10)
        if r.ok:
            items = enrich(apply_sort(apply_filters(r.json(), request.args), request.args))
            error = None
        else:
            items, error = None, f"Backend error ({r.status_code})"
    except requests.RequestException:
        items, error = None, "Could not reach the backend service."
    return render_template("partials/library_content.html", items=items, error=error)


@app.route("/partial/status")
def partial_status():
    try:
        r = requests.get(f"{TRANSFLUX_URL}/status", timeout=5)
        tasks = [{"uuid": k, **v} for k, v in r.json().items()] if r.ok else []
    except requests.RequestException:
        tasks = []
    return render_template("partials/queue_items.html", tasks=tasks)


# --- API routes (kept for backwards compat, also used by HTMX where JSON is fine) ---

@app.route("/api/version-text")
def version_text():
    try:
        r = requests.get(f"{TRANSFLUX_URL}/version", timeout=5)
        if r.ok:
            return f"v{r.json().get('version', '?')}"
    except requests.RequestException:
        pass
    return "v?"

@app.route("/api/version")
def get_version():
    return _proxy("GET", "/version")

@app.route("/api/seaglass-version")
def get_seaglass_version():
    version_path = os.path.join(os.path.dirname(__file__), "version.txt")
    try:
        with open(version_path) as f:
            return jsonify({"version": f.read().strip()})
    except OSError:
        return jsonify({"version": "unknown"})

@app.route("/api/list")
def get_list():
    return _proxy("GET", "/list", timeout=10)

@app.route("/api/status")
def get_status():
    return _proxy("GET", "/status")

@app.route("/api/process/<hash>", methods=["PUT", "POST"])
def process_hash(hash):
    return _proxy("PUT", f"/process/{hash}")

@app.route("/api/process-batch", methods=["PUT", "POST"])
def process_batch():
    hashes = request.form.getlist("hash")
    success = 0
    for h in hashes:
        try:
            r = requests.put(f"{TRANSFLUX_URL}/process/{h}", timeout=5)
            if r.ok:
                success += 1
        except requests.RequestException:
            pass
    resp = make_response("", 204)
    resp.headers["HX-Trigger"] = json.dumps({
        "queueRefresh": True,
        "showToast": {
            "message": f"Queued {success} item(s)" if success else "Nothing queued",
            "type": "success" if success else "error",
        },
    })
    return resp

@app.route("/api/cancel/<uuid>", methods=["DELETE"])
def cancel_task(uuid):
    try:
        requests.request("DELETE", f"{TRANSFLUX_URL}/cancel/{uuid}", timeout=5)
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502
    resp = make_response("", 204)
    resp.headers["HX-Trigger"] = json.dumps({"queueRefresh": True})
    return resp

@app.route("/api/scan", methods=["PUT", "POST"])
def scan_library():
    try:
        r = requests.request("PUT", f"{TRANSFLUX_URL}/scan", timeout=10)
        if not r.ok:
            return jsonify(r.json() if r.content else {}), r.status_code
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502
    resp = make_response("", 204)
    resp.headers["HX-Trigger"] = json.dumps({
        "queueRefresh": True,
        "showToast": {"message": "Scan queued successfully!", "type": "success"},
    })
    return resp

@app.route("/api/quality", methods=["GET"])
def get_quality():
    return _proxy("GET", "/quality")

@app.route("/api/quality", methods=["POST"])
def set_quality():
    data = request.json or {}
    if not data and request.form:
        preset = request.form.get("preset")
        if preset and preset != "custom":
            data = {"preset": preset}
        else:
            data = {"custom": {
                "crf": int(request.form.get("crf", 18)),
                "preset": request.form.get("ffmpeg_preset", "slow"),
                "audio_bitrate": request.form.get("audio_bitrate", "256k"),
                "resolution_cap": int(request.form.get("resolution_cap"))
                                  if request.form.get("resolution_cap") else None,
            }}
    try:
        r = requests.post(f"{TRANSFLUX_URL}/quality", json=data, timeout=5)
        if not r.ok:
            return jsonify(r.json() if r.content else {}), r.status_code
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502
    resp = make_response("", 204)
    resp.headers["HX-Trigger"] = json.dumps(
        {"showToast": {"message": "Quality updated", "type": "success"}}
    )
    return resp

@app.route("/api/login", methods=["POST"])
def login():
    user   = request.form.get("user", "")
    passwd = request.form.get("pass", "")
    try:
        r = requests.post(f"{BRINECRYPT_URL}/auth/login",
                          json={"user": user, "pass": passwd}, timeout=5)
        if r.ok:
            return render_template("partials/login_success.html", user=user)
        error = r.text or "Unauthorized"
    except requests.RequestException:
        error = "Connection failed"
    return render_template("partials/login_form.html", error=error)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
