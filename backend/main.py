"""
Scorely API - Backend for sheet music transcription and conversion
"""
import os
import uuid
import json
import logging
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiofiles
from music21 import converter, tempo

# Import our custom Audiveris service
from audiveris_service import get_audiveris_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Scorely API",
    description="API for transcribing sheet music (PDF) to MusicXML and converting to Audio/MIDI.",
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

# --- DIRECTORIES ---
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# In-memory job tracking
# In production, use a database (e.g., PostgreSQL) and a task queue (e.g., Celery/Redis)
jobs: Dict[str, dict] = {}

# --- SCHEMAS ---

class TranscriptionResponse(BaseModel):
    job_id: str
    status: str
    message: str

class ConversionRequest(BaseModel):
    musicxml_content: str
    job_id: Optional[str] = None

class SubStatus(BaseModel):
    transcription: str
    audio_conversion: str

class PartInfo(BaseModel):
    part_id: str
    name: str
    audio_path: Optional[str] = None
    midi_path: Optional[str] = None

class FilePaths(BaseModel):
    musicxml: Optional[str] = None
    full_audio: Optional[str] = None
    full_midi: Optional[str] = None

class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: SubStatus
    files: FilePaths
    parts: List[PartInfo] = []
    error: Optional[str] = None

class AlignmentPoint(BaseModel):
    time_seconds: float
    measure: int
    beat: float

class AlignmentResponse(BaseModel):
    job_id: str
    tempo: float
    mappings: List[AlignmentPoint]

# --- HELPER FUNCTIONS ---

def extract_alignment(score_path: Path) -> Dict:
    """Extracts mapping of seconds to measure/beat from a MusicXML file."""
    try:
        s = converter.parse(str(score_path))
        
        # Get tempo (default to 120 if not found)
        current_tempo = 120
        tm = s.flatten().getElementsByClass(tempo.MetronomeMark)
        if tm:
            current_tempo = tm[0].number
        
        seconds_per_quarter = 60.0 / current_tempo
        mappings = []
        
        # Iterate through measures in the first part (measures are synced across parts)
        part = s.parts[0]
        for m in part.getElementsByClass('Measure'):
            # Offset is in quarter notes
            time_sec = float(m.offset * seconds_per_quarter)
            mappings.append({
                "time_seconds": time_sec,
                "measure": int(m.number),
                "beat": 1.0
            })
            
        return {
            "tempo": float(current_tempo),
            "mappings": mappings
        }
    except Exception as e:
        logger.error(f"Failed to extract alignment: {e}")
        return {"tempo": 120.0, "mappings": []}

def render_midi_to_mp3(midi_path: Path, mp3_path: Path):
    """Internal helper to call FluidSynth and convert to MP3 via ffmpeg."""
    soundfont = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
    if not os.path.exists(soundfont):
        soundfont = "/usr/share/sounds/sf3/default-gm.sf3"

    wav_path = mp3_path.with_suffix('.wav')
    
    import subprocess
    # 1. Render to WAV first
    subprocess_cmd = [
        "fluidsynth", "-ni", soundfont, str(midi_path), 
        "-F", str(wav_path), "-r", "44100"
    ]
    result = subprocess.run(subprocess_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FluidSynth failed: {result.stderr}")
    
    # 2. Convert WAV to MP3 using ffmpeg
    ffmpeg_cmd = [
        "ffmpeg", "-y", "-i", str(wav_path), 
        "-codec:a", "libmp3lame", "-qscale:a", "2", str(mp3_path)
    ]
    result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
    
    # 3. Clean up the large WAV file
    if os.path.exists(wav_path):
        os.remove(wav_path)
        
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr}")

def run_audio_pipeline(job_id: str, musicxml_path: Path):
    """Converts MusicXML to MIDI and Audio, including individual parts (stems)."""
    try:
        jobs[job_id]["progress"]["audio_conversion"] = "processing"
        s = converter.parse(str(musicxml_path))
        
        # 1. Full Mix
        full_midi_path = OUTPUT_DIR / f"{job_id}_full.mid"
        full_mp3_path = OUTPUT_DIR / f"{job_id}_full.mp3"
        s.write('midi', fp=str(full_midi_path))
        render_midi_to_mp3(full_midi_path, full_mp3_path)
        
        # 2. Extract Parts (Stems)
        jobs[job_id]["parts"] = []
        for i, p in enumerate(s.parts):
            part_name = p.partName or f"Part {i+1}"
            part_id = f"part_{i}"
            
            p_midi_path = OUTPUT_DIR / f"{job_id}_{part_id}.mid"
            p_mp3_path = OUTPUT_DIR / f"{job_id}_{part_id}.mp3"
            
            # Create a new score containing only this part
            p_score = converter.parse('tinyNotation: 4/4 c4') # Dummy to init
            p_score.remove(p_score.parts[0])
            p_score.insert(0, p)
            
            p_score.write('midi', fp=str(p_midi_path))
            render_midi_to_mp3(p_midi_path, p_mp3_path)
            
            jobs[job_id]["parts"].append({
                "part_id": part_id,
                "name": part_name,
                "audio_path": f"/api/download/{job_id}_{part_id}.mp3",
                "midi_path": f"/api/download/{job_id}_{part_id}.mid"
            })

        # 3. Extract Alignment Data
        alignment = extract_alignment(musicxml_path)
        jobs[job_id]["alignment"] = alignment
        
        jobs[job_id]["progress"]["audio_conversion"] = "completed"
        jobs[job_id]["status"] = "completed"
            
    except Exception as e:
        logger.error(f"Audio pipeline failed for {job_id}: {e}")
        jobs[job_id]["progress"]["audio_conversion"] = "failed"
        jobs[job_id]["error"] = str(e)

# --- ENDPOINTS ---

@app.get("/")
async def root():
    return {"status": "running", "service": "Scorely API"}

@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    job_id = str(uuid.uuid4())
    pdf_path = UPLOAD_DIR / f"{job_id}.pdf"
    
    async with aiofiles.open(pdf_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)

    jobs[job_id] = {
        "status": "processing",
        "progress": {
            "transcription": "queued",
            "audio_conversion": "not_started"
        },
        "files": {
            "musicxml": f"/api/download/{job_id}.mxl",
            "full_audio": f"/api/download/{job_id}_full.mp3",
            "full_midi": f"/api/download/{job_id}_full.mid"
        },
        "parts": []
    }

    background_tasks.add_task(run_full_pipeline, job_id, pdf_path)

    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Transcription started."
    }

@app.get("/api/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "files": job["files"],
        "parts": job.get("parts", []),
        "error": job.get("error")
    }

@app.post("/api/convert-to-audio", response_model=TranscriptionResponse)
async def convert_to_audio(background_tasks: BackgroundTasks, request: ConversionRequest):
    job_id = request.job_id or str(uuid.uuid4())
    mxl_path = OUTPUT_DIR / f"{job_id}.mxl"
    
    # Save the updated MusicXML content
    async with aiofiles.open(mxl_path, 'w') as f:
        await f.write(request.musicxml_content)

    if job_id not in jobs:
        jobs[job_id] = {
            "status": "processing",
            "progress": {"transcription": "completed", "audio_conversion": "queued"},
            "files": {
                "musicxml": f"/api/download/{job_id}.mxl",
                "audio": f"/api/download/{job_id}.wav",
                "midi": f"/api/download/{job_id}.mid"
            }
        }
    else:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["progress"]["audio_conversion"] = "queued"

    background_tasks.add_task(run_audio_pipeline, job_id, mxl_path)

    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Audio regeneration started."
    }

@app.get("/api/alignment/{job_id}", response_model=AlignmentResponse)
async def get_alignment_data(job_id: str):
    if job_id not in jobs or "alignment" not in jobs[job_id]:
        # If not in memory, try to re-extract from disk
        mxl_path = OUTPUT_DIR / f"{job_id}.mxl"
        if mxl_path.exists():
            alignment = extract_alignment(mxl_path)
            return {"job_id": job_id, **alignment}
        raise HTTPException(status_code=404, detail="Alignment data not found")
    
    return {"job_id": job_id, **jobs[job_id]["alignment"]}

@app.get("/api/download/{filename}")
async def download_file(filename: str):
    # Security: check if file is in uploads or outputs
    file_path = OUTPUT_DIR / filename
    if not file_path.exists():
        file_path = UPLOAD_DIR / filename
        
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    media_type = "application/octet-stream"
    if filename.endswith(".mxl"): media_type = "application/vnd.recordare.musicxml"
    elif filename.endswith(".mid"): media_type = "audio/midi"
    elif filename.endswith(".mp3"): media_type = "audio/mpeg"
    elif filename.endswith(".wav"): media_type = "audio/wav"
    elif filename.endswith(".pdf"): media_type = "application/pdf"

    return FileResponse(path=str(file_path), media_type=media_type, filename=filename)
