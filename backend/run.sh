#!/bin/bash

# Scorely Backend Run Script
# Starts the FastAPI server

echo "Starting Scorely API server..."
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found"
    echo "Run ./setup.sh first"
    exit 1
fi

# Activate virtual environment
source venv/bin/activate

# Start the server
echo "Server starting at http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop"
echo ""

uvicorn main:app --reload --port 8000
