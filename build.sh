#!/usr/bin/env bash
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
VERSION_FILE="src/version.txt"
REGISTRY="192.168.0.127:5000"
NEW_VERSION=""
# Set INSECURE_REGISTRY=true to disable TLS verification
INSECURE_REGISTRY="${INSECURE_REGISTRY:-false}"
TLS_VERIFY="true"
if [ "$INSECURE_REGISTRY" = "true" ]; then
    TLS_VERIFY="false"
fi

# ── Parse Arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    -ver|--version)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 1; }
      NEW_VERSION="$2"
      shift 2
      ;;
    -r|--registry)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 1; }
      REGISTRY="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# ── Determine version ─────────────────────────────────────────────────────────
if [ -z "$NEW_VERSION" ]; then
    # Read current version and auto-increment
    if [ ! -f "$VERSION_FILE" ]; then
        echo "v0.0.0" > "$VERSION_FILE"
    fi
    CURRENT=$(cat "$VERSION_FILE" | tr -d '[:space:]')

    # Parse vMAJOR.MINOR.PATCH[-SUFFIX]
    # e.g. v0.0.0-alpha  →  MAJOR=0 MINOR=0 PATCH=0 SUFFIX=alpha
    SEMVER=$(echo "$CURRENT" | grep -oP '\d+\.\d+\.\d+')
    SUFFIX=$(echo "$CURRENT" | grep -oP '(?<=-)\w+' || true)
    MAJOR=$(echo "$SEMVER" | cut -d. -f1)
    MINOR=$(echo "$SEMVER" | cut -d. -f2)
    PATCH=$(echo "$SEMVER" | cut -d. -f3)

    # Increment patch
    PATCH=$((PATCH + 1))

    if [ -n "$SUFFIX" ]; then
        NEW_VERSION="v${MAJOR}.${MINOR}.${PATCH}-${SUFFIX}"
    else
        NEW_VERSION="v${MAJOR}.${MINOR}.${PATCH}"
    fi

    echo "$NEW_VERSION" > "$VERSION_FILE"
else
    echo "Using manual version: $NEW_VERSION"
    echo "$NEW_VERSION" > "$VERSION_FILE"
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo "==================================="
echo " Building - HomeReef (Seaglass)"
echo " Version:  $NEW_VERSION"
echo " Registry: $REGISTRY"
echo "==================================="

MANIFEST_VERSIONED="seaglass-manifest:${NEW_VERSION}"

# Remove any stale local manifest before building
podman manifest rm "${MANIFEST_VERSIONED}" 2>/dev/null || true

podman buildx build \
    --build-arg CACHE_BUST="$(date +%s)" \
    --platform linux/amd64,linux/arm64 \
    --manifest "${MANIFEST_VERSIONED}" \
    -f containerfiles/Containerfile \
    .

echo "Done: manifest ${MANIFEST_VERSIONED} (amd64 + arm64)"

# ── Upload ────────────────────────────────────────────────────────────────────
echo "==> Pushing versioned manifest list..."
podman manifest push \
    --tls-verify=${TLS_VERIFY} \
    --all \
    "${MANIFEST_VERSIONED}" \
    "docker://${REGISTRY}/seaglass:${NEW_VERSION}"

echo "==> Pushing latest manifest list..."
podman manifest push \
    --tls-verify=${TLS_VERIFY} \
    --all \
    "${MANIFEST_VERSIONED}" \
    "docker://${REGISTRY}/seaglass:latest"

echo "==================================="
echo " Build & Upload Complete"
echo " Version: $NEW_VERSION / latest"
echo "==================================="
