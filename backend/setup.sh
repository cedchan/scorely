#!/bin/bash

# Scorely Backend Setup Script
# This script sets up the Python virtual environment and installs dependencies

echo "================================"
echo "Scorely Backend Setup"
echo "================================"
echo ""

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed"
    echo "Please install Python 3.8 or higher"
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"
echo ""

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi
echo ""

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip > /dev/null 2>&1
echo "✅ Pip upgraded"
echo ""

# Install dependencies
echo "Installing dependencies from requirements.txt..."
pip install -r requirements.txt
echo "✅ Dependencies installed"
echo ""

# Create necessary directories
mkdir -p uploads outputs
echo "✅ Created uploads and outputs directories"
echo ""

echo "================================"
echo "Setup Complete!"
echo "================================"
echo ""
echo "To start the API server:"
echo "  1. source venv/bin/activate"
echo "  2. uvicorn main:app --reload --port 8000"
echo ""
echo "Or run: ./run.sh"
echo ""
echo "API Documentation will be available at:"
echo "  http://localhost:8000/docs"
echo ""
