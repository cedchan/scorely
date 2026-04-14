#!/bin/bash

# Scorely startup script
# Starts Docker backend and Expo frontend with HTTPS support via mkcert
#
# Optional:
#   ENABLE_TUNNELS=1 ./start.sh
# This will expose both the web app and API over HTTPS using localtunnel
# and print an iPad-friendly URL that includes the backend override.

set -euo pipefail

DOCKER_BIN="${DOCKER_BIN:-/Applications/Docker.app/Contents/Resources/bin/docker}"
ENABLE_TUNNELS="${ENABLE_TUNNELS:-0}"
EXPO_PID=""
API_TUNNEL_PID=""
WEB_TUNNEL_PID=""
API_TUNNEL_LOG=""
WEB_TUNNEL_LOG=""

cleanup() {
    if [[ -n "${API_TUNNEL_PID}" ]] && kill -0 "${API_TUNNEL_PID}" 2>/dev/null; then
        kill "${API_TUNNEL_PID}" 2>/dev/null || true
    fi

    if [[ -n "${WEB_TUNNEL_PID}" ]] && kill -0 "${WEB_TUNNEL_PID}" 2>/dev/null; then
        kill "${WEB_TUNNEL_PID}" 2>/dev/null || true
    fi

    if [[ -n "${API_TUNNEL_LOG}" && -f "${API_TUNNEL_LOG}" ]]; then
        rm -f "${API_TUNNEL_LOG}"
    fi

    if [[ -n "${WEB_TUNNEL_LOG}" && -f "${WEB_TUNNEL_LOG}" ]]; then
        rm -f "${WEB_TUNNEL_LOG}"
    fi

    if [[ -n "${EXPO_PID}" ]] && kill -0 "${EXPO_PID}" 2>/dev/null; then
        kill "${EXPO_PID}" 2>/dev/null || true
    fi
}

trap cleanup EXIT INT TERM

wait_for_http() {
    local url="$1"
    local label="$2"
    local max_retries="${3:-60}"
    local retry_count=0

    until curl -fsS -k "${url}" > /dev/null 2>&1; do
        retry_count=$((retry_count + 1))
        if [[ "${retry_count}" -ge "${max_retries}" ]]; then
            echo "❌ ${label} failed to start: ${url}"
            return 1
        fi
        sleep 1
    done
}

setup_certificates() {
    echo "🔐 Checking SSL certificates..."

    # Check if mkcert is installed
    if ! command -v mkcert &> /dev/null; then
        echo "⚠️  mkcert not found. Installing via Homebrew..."
        if ! command -v brew &> /dev/null; then
            echo "❌ Homebrew is required but not installed. Please install from https://brew.sh"
            exit 1
        fi
        brew install mkcert
    fi

    # Install local CA if not already done
    if ! mkcert -CAROOT &> /dev/null; then
        echo "📜 Installing local Certificate Authority..."
        mkcert -install
    fi

    # Get local IP address
    if [[ "$OSTYPE" == "darwin"* ]]; then
        LOCAL_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")"
    else
        LOCAL_IP="$(hostname -I | awk '{print $1}' || echo "localhost")"
    fi

    # Generate certificates if they don't exist or if IP has changed
    CERT_DIR="./certs"
    mkdir -p "${CERT_DIR}"

    if [[ ! -f "${CERT_DIR}/localhost+3.pem" ]] || ! grep -q "${LOCAL_IP}" "${CERT_DIR}/localhost+3.pem" 2>/dev/null; then
        echo "🔑 Generating SSL certificates for localhost and ${LOCAL_IP}..."
        cd "${CERT_DIR}"
        mkcert localhost 127.0.0.1 ::1 "${LOCAL_IP}"
        cd ..
        echo "✅ Certificates generated!"
    else
        echo "✅ Valid certificates found!"
    fi

    echo "${LOCAL_IP}"
}

start_localtunnel() {
    local port="$1"
    local label="$2"
    local log_file
    local pid
    local tunnel_url=""
    local attempts=0

    log_file="$(mktemp)"
    npx --yes localtunnel --port "${port}" > "${log_file}" 2>&1 &
    pid=$!

    while [[ "${attempts}" -lt 30 ]]; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            echo "❌ ${label} tunnel exited unexpectedly."
            cat "${log_file}"
            return 1
        fi

        tunnel_url="$(grep -m1 'your url is:' "${log_file}" | sed 's/.*your url is: //')"
        if [[ -n "${tunnel_url}" ]]; then
            echo "${pid}"
            echo "${log_file}"
            echo "${tunnel_url}"
            return 0
        fi

        attempts=$((attempts + 1))
        sleep 1
    done

    echo "❌ Timed out waiting for ${label} tunnel URL."
    cat "${log_file}"
    return 1
}

echo "🎵 Starting Scorely..."
echo ""

if ! PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" "${DOCKER_BIN}" info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    exit 1
fi

# Setup SSL certificates and get local IP
LOCAL_IP="$(setup_certificates)"

echo "📦 Starting Docker services (API + Audiveris)..."
PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" "${DOCKER_BIN}" compose up --build -d

echo "⏳ Waiting for API to be ready..."
wait_for_http "https://localhost:8443/" "API (HTTPS)" 60

echo "✅ API is ready!"
echo ""

echo "📦 Updating frontend dependencies..."
npm install

echo ""
echo "🚀 Starting Expo development server..."
npx expo start --web --host lan --clear &
EXPO_PID=$!

wait_for_http "http://localhost:8081" "Expo web app" 90

echo ""
echo "✅ Scorely is ready!"
echo ""
echo "   📱 Local (laptop):        http://localhost:8081"
echo "   🔐 iPad (HTTPS):          https://${LOCAL_IP}"
echo "   📚 API Docs:              https://${LOCAL_IP}/docs"
echo ""
echo "   💡 For iPad camera access:"
echo "      • Open https://${LOCAL_IP} in Safari"
echo "      • Accept certificate warning once"
echo "      • Camera features will work!"

if [[ "${ENABLE_TUNNELS}" == "1" ]]; then
    echo ""
    echo "🔐 Starting public HTTPS tunnels (for remote access only)..."
    echo "   Note: For local network iPad testing, use https://${LOCAL_IP} instead!"
    echo ""

    # Read API tunnel data
    api_tunnel_output="$(start_localtunnel "8000" "API")"
    API_TUNNEL_PID="$(echo "$api_tunnel_output" | sed -n '1p')"
    API_TUNNEL_LOG="$(echo "$api_tunnel_output" | sed -n '2p')"
    API_TUNNEL_URL="$(echo "$api_tunnel_output" | sed -n '3p')"

    # Read web tunnel data
    web_tunnel_output="$(start_localtunnel "8081" "web app")"
    WEB_TUNNEL_PID="$(echo "$web_tunnel_output" | sed -n '1p')"
    WEB_TUNNEL_LOG="$(echo "$web_tunnel_output" | sed -n '2p')"
    WEB_TUNNEL_URL="$(echo "$web_tunnel_output" | sed -n '3p')"

    ENCODED_API_TUNNEL_URL="${API_TUNNEL_URL//:/%3A}"
    ENCODED_API_TUNNEL_URL="${ENCODED_API_TUNNEL_URL//\//%2F}"

    echo "   🌍 Remote HTTPS app: ${WEB_TUNNEL_URL}/?api=${ENCODED_API_TUNNEL_URL}"
    echo "   🌍 Remote HTTPS API: ${API_TUNNEL_URL}"
fi

echo ""
echo "Press Ctrl+C to stop Expo and any localtunnel processes."
echo "Docker containers will keep running until you stop them with:"
echo "PATH=\"/Applications/Docker.app/Contents/Resources/bin:\$PATH\" \"${DOCKER_BIN}\" compose down"
echo ""

wait "${EXPO_PID}"
