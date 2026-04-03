"""
Scorely API - Backend for sheet music transcription and conversion
"""
import os
import uuid
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiofiles

# Initialize FastAPI app
app = FastAPI(
    title="Scorely API",
    description="Sheet music transcription and conversion API",
    version="1.0.0"
)

# Enable CORS for React Native app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directories
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Pydantic models
class ConversionRequest(BaseModel):
    musicxml_path: str

class TranscriptionResponse(BaseModel):
    status: str
    job_id: str
    musicxml_path: str
    message: Optional[str] = None

class MidiConversionResponse(BaseModel):
    status: str
    midi_path: str
    message: Optional[str] = None


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "service": "Scorely API",
        "version": "1.0.0"
    }


@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_pdf(file: UploadFile = File(...)):
    """
    Upload a PDF file and transcribe it to MusicXML using OMR.

    Note: This endpoint currently returns a placeholder.
    Audiveris integration requires Java runtime and additional setup.
    """
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    # Generate unique job ID
    job_id = str(uuid.uuid4())

    # Save uploaded PDF
    pdf_path = UPLOAD_DIR / f"{job_id}.pdf"
    async with aiofiles.open(pdf_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)

    # TODO: Integrate Audiveris for actual OMR transcription
    # For now, this is a placeholder that would call:
    # subprocess.run(['java', '-jar', 'audiveris.jar', '-batch', '-export', str(pdf_path)])

    musicxml_path = f"outputs/{job_id}.mxl"

    return TranscriptionResponse(
        status="success",
        job_id=job_id,
        musicxml_path=musicxml_path,
        message="PDF uploaded successfully. OMR processing would happen here (Audiveris not yet integrated)."
    )


@app.post("/api/convert-to-midi", response_model=MidiConversionResponse)
async def convert_to_midi(request: ConversionRequest):
    """
    Convert MusicXML file to MIDI using music21.
    """
    try:
        from music21 import converter

        musicxml_path = Path(request.musicxml_path)

        if not musicxml_path.exists():
            raise HTTPException(status_code=404, detail="MusicXML file not found")

        # Parse MusicXML
        score = converter.parse(str(musicxml_path))

        # Generate MIDI path
        midi_path = musicxml_path.with_suffix('.mid')

        # Write MIDI file
        score.write('midi', fp=str(midi_path))

        return MidiConversionResponse(
            status="success",
            midi_path=str(midi_path),
            message="Successfully converted MusicXML to MIDI"
        )

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="music21 library not installed. Run: pip install music21"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


@app.get("/api/download/{filename}")
async def download_file(filename: str):
    """
    Download generated MusicXML or MIDI files.
    """
    file_path = OUTPUT_DIR / filename

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Determine media type
    media_type = "application/octet-stream"
    if filename.endswith('.mxl'):
        media_type = "application/vnd.recordare.musicxml"
    elif filename.endswith('.mid') or filename.endswith('.midi'):
        media_type = "audio/midi"

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=filename
    )


@app.get("/api/status/{job_id}")
async def get_job_status(job_id: str):
    """
    Check the status of a transcription job.
    """
    # Check if files exist
    pdf_path = UPLOAD_DIR / f"{job_id}.pdf"
    mxl_path = OUTPUT_DIR / f"{job_id}.mxl"
    midi_path = OUTPUT_DIR / f"{job_id}.mid"

    status = {
        "job_id": job_id,
        "pdf_uploaded": pdf_path.exists(),
        "musicxml_ready": mxl_path.exists(),
        "midi_ready": midi_path.exists(),
    }

    if mxl_path.exists():
        status["status"] = "completed"
    elif pdf_path.exists():
        status["status"] = "processing"
    else:
        status["status"] = "not_found"

    return status


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
