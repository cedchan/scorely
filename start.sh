#!/bin/bash

# Scorely startup script
# Starts Docker backend and Expo frontend
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

    until curl -fsS "${url}" > /dev/null 2>&1; do
        retry_count=$((retry_count + 1))
        if [[ "${retry_count}" -ge "${max_retries}" ]]; then
            echo "❌ ${label} failed to start: ${url}"
            return 1
        fi
        sleep 1
    done
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

echo "📦 Starting Docker services (API + Audiveris)..."
PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" "${DOCKER_BIN}" compose up --build -d

echo "⏳ Waiting for API to be ready..."
wait_for_http "http://localhost:8000/" "API" 60

echo "✅ API is ready!"
echo ""

echo "📦 Updating frontend dependencies..."
npm install

if [[ "$OSTYPE" == "darwin"* ]]; then
    LOCAL_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")"
else
    LOCAL_IP="$(hostname -I | awk '{print $1}' || echo "localhost")"
fi

echo ""
echo "🚀 Starting Expo development server..."
npx expo start --web --host lan --clear &
EXPO_PID=$!

wait_for_http "http://localhost:8081" "Expo web app" 90

echo ""
echo "   📱 Local app: http://localhost:8081"
echo "   🌐 LAN app:   http://${LOCAL_IP}:8081"
echo "   🔌 API:       http://${LOCAL_IP}:8000"
echo "   📚 Docs:      http://${LOCAL_IP}:8000/docs"

if [[ "${ENABLE_TUNNELS}" == "1" ]]; then
    echo ""
    echo "🔐 Starting HTTPS tunnels for remote/iPad access..."

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

    echo ""
    echo "   🌍 HTTPS app: ${WEB_TUNNEL_URL}/?api=${ENCODED_API_TUNNEL_URL}"
    echo "   🌍 HTTPS API: ${API_TUNNEL_URL}"
    echo ""
    echo "   Use the HTTPS app URL above on iPad Safari for camera access."
fi

echo ""
echo "Press Ctrl+C to stop Expo and any localtunnel processes."
echo "Docker containers will keep running until you stop them with:"
echo "PATH=\"/Applications/Docker.app/Contents/Resources/bin:\$PATH\" \"${DOCKER_BIN}\" compose down"
echo ""

wait "${EXPO_PID}"
