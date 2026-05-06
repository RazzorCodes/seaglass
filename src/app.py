import os
import secrets

from flask import Flask, jsonify, send_from_directory

from services.transflux import bp as transflux_bp
from services.brinecrypt import bp as brinecrypt_bp

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", secrets.token_hex(32))
app.config["TRANSFLUX_URL"] = os.environ.get("TRANSFLUX_URL", "http://localhost:8000").rstrip("/")
app.config["BRINECRYPT_URL"] = os.environ.get("BRINECRYPT_URL", "http://brinecrypt.lan").rstrip("/")
app.config["BRINECRYPT_PUBLIC_URL"] = os.environ.get("BRINECRYPT_PUBLIC_URL", app.config["BRINECRYPT_URL"]).rstrip("/")

app.register_blueprint(transflux_bp)
app.register_blueprint(brinecrypt_bp)

_SRC = os.path.dirname(__file__)


@app.route("/")
def index():
    return send_from_directory(_SRC, "v5.html")


@app.route("/v5/<path:filename>")
def v5_assets(filename):
    return send_from_directory(os.path.join(_SRC, "v5"), filename)


@app.route("/api/<service>/health")
def service_health(service):
    # catch-all for services without a dedicated blueprint health route
    return jsonify({"service": service, "status": "mock"})


@app.route("/api/seaglass-version")
def get_seaglass_version():
    version_path = os.path.join(_SRC, "version.txt")
    try:
        with open(version_path) as f:
            return jsonify({"version": f.read().strip()})
    except FileNotFoundError:
        return jsonify({"version": "unknown"})


@app.route("/api/config")
def api_config():
    return jsonify({
        "brinecrypt_url": app.config["BRINECRYPT_PUBLIC_URL"]
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
