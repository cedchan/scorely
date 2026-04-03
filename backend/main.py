"""
Scorely API - Backend for sheet music transcription and conversion
"""
import os
import uuid
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Initialize FastAPI app
app = FastAPI(
    title="Scorely API",
    description="""
    API for transcribing sheet music (PDF) to MusicXML and converting to Audio/MIDI.
    
    ### UI Workflow:
    1. **Initial Upload**: Use `/api/transcribe` with a PDF. It returns a `job_id`.
    2. **Polling**: Poll `/api/status/{job_id}`. 
       - When `transcription` is 'completed', you can download the MusicXML and render the score.
       - When `audio_conversion` is 'completed', you can enable playback.
    3. **Editing**: If the user edits the MusicXML, use `/api/convert-to-audio` with the updated XML.
    4. **Playback Sync**: Use `/api/alignment/{job_id}` to get the mapping for the scrolling cursor.
    """,
    version="1.1.0"
)

# Enable CORS for React Native app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SCHEMAS ---

class TranscriptionResponse(BaseModel):
    job_id: str
    status: str  # 'queued'
    message: str

class ConversionRequest(BaseModel):
    """Used when a user edits MusicXML and needs new audio/alignment."""
    musicxml_content: str  # The updated MusicXML string
    job_id: Optional[str] = None # Optional: associate with an existing job

class SubStatus(BaseModel):
    transcription: str  # 'queued', 'processing', 'completed', 'failed', 'not_started'
    audio_conversion: str

class FilePaths(BaseModel):
    musicxml: Optional[str] = None
    audio: Optional[str] = None
    midi: Optional[str] = None

class JobStatusResponse(BaseModel):
    job_id: str
    status: str # 'processing', 'completed', 'failed'
    progress: SubStatus
    files: FilePaths
    error: Optional[str] = None

class AlignmentPoint(BaseModel):
    time_seconds: float
    measure: int
    beat: float

class AlignmentResponse(BaseModel):
    job_id: str
    tempo: float
    mappings: List[AlignmentPoint]

# --- ENDPOINTS ---

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"status": "running", "service": "Scorely API"}

@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """
    **Initial Entry Point.**
    Takes a PDF, returns a Job ID. Starts the OMR -> Audio pipeline.
    UI should immediately start polling /api/status/{job_id}.
    """
    job_id = str(uuid.uuid4())
    # TODO: Save PDF and trigger background_tasks.add_task(...)
    return {
        "job_id": job_id,
        "status": "queued",
        "message": "PDF received. OMR and Audio pipeline started."
    }

@app.get("/api/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """
    **Polling Endpoint.**
    Returns the granular status of the transcription and audio conversion.
    UI can render the MusicXML as soon as 'transcription' is 'completed'.
    """
    # TODO: Fetch status from DB/Cache
    return {
        "job_id": job_id,
        "status": "processing",
        "progress": {
            "transcription": "processing",
            "audio_conversion": "not_started"
        },
        "files": {
            "musicxml": None,
            "audio": None,
            "midi": None
        }
    }

@app.post("/api/convert-to-audio", response_model=TranscriptionResponse)
async def convert_to_audio(background_tasks: BackgroundTasks, request: ConversionRequest):
    """
    **Edit Entry Point.**
    Takes edited MusicXML, returns a Job ID. 
    Triggers regeneration of MIDI, Audio, and Alignment map.
    """
    job_id = request.job_id or str(uuid.uuid4())
    # TODO: Save updated XML and trigger conversion task
    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Regenerating audio for edited score."
    }

@app.get("/api/alignment/{job_id}", response_model=AlignmentResponse)
async def get_alignment_data(job_id: str):
    """
    **Sync Data.**
    Returns the seconds-to-measure/beat mapping for the scrolling cursor.
    """
    # TODO: Extract timestamps using music21
    return {
        "job_id": job_id,
        "tempo": 120.0,
        "mappings": [
            {"time_seconds": 0.0, "measure": 1, "beat": 1.0},
            {"time_seconds": 2.5, "measure": 2, "beat": 1.0}
        ]
    }

@app.get("/api/download/{filename}")
async def download_file(filename: str):
    """
    **Asset Fetching.**
    Serves the actual .mxl, .mid, or .wav files to the UI.
    """
    # TODO: Serve file from outputs directory
    return {"message": "File streaming placeholder"}