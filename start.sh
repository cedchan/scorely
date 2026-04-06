#!/bin/bash

# Scorely Startup Script
# Starts Docker backend and Expo frontend

set -e  # Exit on error

echo "🎵 Starting Scorely..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    exit 1
fi

# Start Docker services (rebuild to ensure up-to-date)
echo "📦 Starting Docker services (API + Audiveris)..."
docker compose up --build -d

# Wait for API to be ready
echo "⏳ Waiting for API to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0
while ! curl -s http://localhost:8000/ > /dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "❌ API failed to start after 30 seconds"
        docker logs scorely-api --tail 20
        exit 1
    fi
    sleep 1
done

echo "✅ API is ready!"
echo ""

# Install/update frontend dependencies
echo "📦 Updating frontend dependencies..."
npm install

# Get local IP address
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
else
    # Linux
    LOCAL_IP=$(hostname -I | awk '{print $1}' || echo "localhost")
fi

# Start Expo web server
echo ""
echo "🚀 Starting Expo development server..."
echo ""
echo "   📱 Local:   http://localhost:8081"
echo "   🌐 Network: http://$LOCAL_IP:8081"
echo ""
echo "   🔌 API:     http://$LOCAL_IP:8000"
echo "   📚 Docs:    http://$LOCAL_IP:8000/docs"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Start Expo (will run in foreground)
npx expo start --web --host lan --clear
