# Scorely Backend API

Python FastAPI backend for sheet music transcription and conversion.

## Features

- PDF → MusicXML (Optical Music Recognition)
- MusicXML → MIDI conversion
- RESTful API endpoints

## Setup

### 1. Create Virtual Environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run Server

```bash
uvicorn main:app --reload --port 8000
```

Server will be available at: http://localhost:8000

### 4. View API Docs

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## API Endpoints

### `GET /`
Health check endpoint

**Response:**
```json
{
  "status": "running",
  "service": "Scorely API"
}
```

### `POST /api/transcribe`
Upload PDF and transcribe to MusicXML

**Request:**
- Content-Type: multipart/form-data
- Body: PDF file

**Response:**
```json
{
  "status": "success",
  "job_id": "uuid-here",
  "musicxml_path": "outputs/uuid.mxl"
}
```

### `POST /api/convert-to-midi`
Convert MusicXML to MIDI

**Request:**
```json
{
  "musicxml_path": "outputs/uuid.mxl"
}
```

**Response:**
```json
{
  "status": "success",
  "midi_path": "outputs/uuid.mid"
}
```

### `GET /api/download/{filename}`
Download generated files (MusicXML or MIDI)

## Testing Locally

### Using curl

```bash
# Health check
curl http://localhost:8000/

# Upload PDF for transcription
curl -X POST http://localhost:8000/api/transcribe \
  -F "file=@/path/to/sheet_music.pdf"

# Convert to MIDI
curl -X POST http://localhost:8000/api/convert-to-midi \
  -H "Content-Type: application/json" \
  -d '{"musicxml_path": "outputs/your-file.mxl"}'

# Download result
curl http://localhost:8000/api/download/your-file.mid --output result.mid
```

### Using Python test script

```bash
python test_api.py
```

## Notes

- Audiveris integration requires Java runtime (see main README for setup)
- MusicXML to MIDI conversion uses music21 library
- Files are stored temporarily in `uploads/` and `outputs/` directories
