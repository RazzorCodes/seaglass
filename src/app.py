import os
import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

TRANSFLUX_URL = os.environ.get("TRANSFLUX_URL", "http://localhost:8000").rstrip("/")

def _proxy(method, path, timeout=5, **kwargs):
    try:
        r = requests.request(method, f"{TRANSFLUX_URL}{path}", timeout=timeout, **kwargs)
        body = r.json() if r.content else {}
        return jsonify(body), r.status_code
    except requests.Timeout as e:
        return jsonify({"error": str(e)}), 504
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/list")
def get_list():
    return _proxy("GET", "/list", timeout=10)

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

@app.route("/api/status")
def get_status():
    return _proxy("GET", "/status")

@app.route("/api/process/<hash>", methods=["PUT", "POST"])
def process_hash(hash):
    return _proxy("PUT", f"/process/{hash}")

@app.route("/api/cancel/<uuid>", methods=["DELETE"])
def cancel_task(uuid):
    return _proxy("DELETE", f"/cancel/{uuid}")

@app.route("/api/scan", methods=["PUT", "POST"])
def scan_library():
    return _proxy("PUT", "/scan", timeout=10)

@app.route("/api/quality", methods=["GET"])
def get_quality():
    return _proxy("GET", "/quality")

@app.route("/api/quality", methods=["POST"])
def set_quality():
    return _proxy("POST", "/quality", json=request.json)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
