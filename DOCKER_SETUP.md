# Docker Setup for Scorely

Complete guide for setting up Scorely with Docker, including Audiveris OMR integration.

## ✨ Fully Self-Contained Setup

This Docker setup is **100% cross-platform** and requires **zero manual installations**:
- ✅ Works on Mac, Windows, Linux
- ✅ Automatically builds Audiveris with Java 25
- ✅ No manual Audiveris installation needed
- ✅ Identical environment for all team members

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- Git (for cloning the repository)

**That's it!** No Java, no Audiveris, no Python needed on your machine.

## Quick Start

### 1. Clone Repository

```bash
git clone [your-repo-url]
cd scorely
```

### 2. Start All Services

```bash
docker-compose up --build
```

**First time setup:**
- Downloads Java 25 (~200MB)
- Builds Audiveris from source (~5 minutes)
- Builds FastAPI backend (~2 minutes)
- **Subsequent starts**: ~10 seconds (cached)

### 3. Verify Setup

Open your browser and visit:
- **API Docs**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/

You should see the Swagger UI with all API endpoints.

## Architecture

```
┌─────────────────────┐
│   React Native App  │
│   (Port: 8081)      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐      ┌──────────────────────┐
│   FastAPI Backend   │─────▶│  Audiveris Service   │
│   (Port: 8000)      │      │  (OMR Processing)    │
└─────────────────────┘      └──────────────────────┘
           │
           ▼
┌─────────────────────┐
│  Shared Volumes     │
│  - uploads/         │
│  - outputs/         │
└─────────────────────┘
```

## Development Workflow

### Starting Services

```bash
# Start all services in foreground (see logs)
docker-compose up

# Start in background
docker-compose up -d

# Rebuild and start (after code changes)
docker-compose up --build
```

### Stopping Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

### Viewing Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f audiveris
```

### Running Commands in Containers

```bash
# Execute Python commands in API container
docker-compose exec api python test_api.py

# Access shell in API container
docker-compose exec api bash

# Install new Python package
docker-compose exec api pip install new-package
# Then update requirements.txt
```

## Testing the API

### Using Swagger UI (Easiest)

1. Go to http://localhost:8000/docs
2. Click on `/api/transcribe` endpoint
3. Click "Try it out"
4. Upload a PDF file
5. Click "Execute"

### Using curl

```bash
# Upload PDF for transcription (Full pipeline: PDF → MusicXML → MIDI → MP3)
curl -X POST http://localhost:8000/api/transcribe \
  -F "file=@path/to/sheet_music.pdf"

# Returns job_id for status tracking

# Check job status
curl http://localhost:8000/api/status/{job_id}

# Download generated files
curl http://localhost:8000/api/download/{job_id}.mxl  # MusicXML
curl http://localhost:8000/api/download/{job_id}_full.mp3  # Full audio
curl http://localhost:8000/api/download/{job_id}_full.mid  # Full MIDI
curl http://localhost:8000/api/download/{job_id}_part_0.mp3  # Individual stems

# Get alignment data (time → measure/beat mappings)
curl http://localhost:8000/api/alignment/{job_id}
```

### Using Python

```bash
cd backend
python test_api.py
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Audiveris Configuration
AUDIVERIS_PATH=/Applications/Audiveris.app/Contents/MacOS/Audiveris

# API Configuration
API_PORT=8000
AUDIVERIS_PORT=8081
```

### Volume Mounts

The `docker-compose.yml` mounts these directories:
- `./backend` → Container's `/app` (for live code reloading)
- `./backend/uploads` → Shared upload directory
- `./backend/outputs` → Shared output directory
- `./audiveris-5.10.2` → Audiveris source (read-only)

## What Gets Built

When you run `docker-compose up --build`:

1. **Audiveris Container**:
   - Downloads Java 25 JDK
   - Installs Tesseract OCR for text recognition
   - Copies Audiveris source from `audiveris-5.10.2/`
   - Builds Audiveris using Gradle
   - Creates wrapper script for easy execution
   - **Size**: ~2GB (but cached after first build)

2. **API Container**:
   - Python 3.11
   - FastAPI + all dependencies (music21, aiofiles, etc.)
   - Docker CLI for inter-container communication
   - FluidSynth + soundfonts for MIDI synthesis
   - FFmpeg for audio format conversion
   - Connects to Audiveris container via docker exec
   - **Size**: ~800MB

## Features

The API provides a complete music transcription and audio pipeline:

1. **PDF → MusicXML**: Optical Music Recognition using Audiveris
2. **MusicXML → MIDI**: Note conversion using music21
3. **MIDI → MP3**: Audio synthesis using FluidSynth + FFmpeg
4. **Stem Extraction**: Individual part/instrument tracks
5. **Alignment Data**: Time → measure/beat mappings for synchronization

## Troubleshooting

### Build Takes Too Long

**Issue**: First build taking >10 minutes

**This is normal!** The first build:
- Downloads ~200MB Java 25 image
- Compiles Audiveris from source (~5 min)
- Downloads Python dependencies

**Solutions**:
- Let it finish (only happens once)
- Subsequent builds use cache (~10 seconds)
- Go get coffee ☕

### Build Fails

**Error**: Gradle build fails

**Solution**:
```bash
# Clean rebuild
docker-compose down -v
docker-compose build --no-cache
docker-compose up
```

### Port Already in Use

**Error**: `Port 8000 is already allocated`

**Solution**:
```bash
# Stop conflicting services
lsof -ti:8000 | xargs kill -9

# Or change ports in docker-compose.yml
```

### Container Won't Start

**Solution**:
```bash
# Clean rebuild
docker-compose down -v
docker-compose build --no-cache
docker-compose up
```

### Permission Issues

**Error**: `Permission denied` in containers

**Solution**:
```bash
# Fix permissions on host
chmod -R 755 backend/uploads backend/outputs
```

## Production Deployment

For production deployment (e.g., to cloud):

1. **Update docker-compose.yml**:
   - Remove volume mounts for code (use COPY instead)
   - Add health checks
   - Configure proper logging

2. **Build production images**:
   ```bash
   docker-compose -f docker-compose.prod.yml build
   ```

3. **Deploy to cloud** (AWS, GCP, Azure, etc.)

## Team Collaboration

### For New Team Members

**Setup (2 commands):**

```bash
git clone [repo-url]
cd scorely
docker-compose up --build
```

**That's literally it!** No:
- ❌ Java installation
- ❌ Python installation
- ❌ Audiveris installation
- ❌ Dependency management
- ❌ Environment configuration

Just Docker and you're done.

### Sharing Changes

- Code changes in `backend/` are live-reloaded in the container
- To add new dependencies:
  1. Update `backend/requirements.txt`
  2. Rebuild: `docker-compose up --build`

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Audiveris Documentation](https://audiveris.github.io/audiveris/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
