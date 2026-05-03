import os

import requests
from flask import Flask, jsonify, send_from_directory

app = Flask(__name__)

TRANSFLUX_URL = os.environ.get("TRANSFLUX_URL", "http://localhost:8000").rstrip("/")
BRINECRYPT_URL = os.environ.get("BRINECRYPT_URL", "http://brinecrypt.lan").rstrip("/")

SRC_DIR = os.path.dirname(__file__)


@app.route("/")
def index():
    return send_from_directory(SRC_DIR, "v5.html")


@app.route("/v5/<path:filename>")
def v5_assets(filename):
    return send_from_directory(os.path.join(SRC_DIR, "v5"), filename)


@app.route("/api/<service>/health")
def service_health(service):
    service = (service or "").strip().lower()

    if service == "transflux":
        try:
            r = requests.get(f"{TRANSFLUX_URL}/version", timeout=3)
            if r.ok:
                return jsonify({"service": service, "status": "online"}), 200
            return jsonify({"service": service, "status": "degraded"}), 200
        except requests.RequestException:
            return jsonify({"service": service, "status": "offline"}), 200

    if service == "brinecrypt":
        try:
            r = requests.get(f"{BRINECRYPT_URL}/ready", timeout=3)
            if r.status_code in (200, 400, 401, 405):
                return jsonify({"service": service, "status": "online"}), 200
            return jsonify({"service": service, "status": "degraded"}), 200
        except requests.RequestException:
            return jsonify({"service": service, "status": "offline"}), 200

    return jsonify({"service": service, "status": "mock"}), 200


if __name__ == "__main__":
    print("START")
    app.run(host="0.0.0.0", port=5000, debug=True)
