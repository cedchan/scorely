"""
Scorely API - Backend for sheet music transcription, rendering, and conversion.
"""
import json
import logging
import os
import shutil
import struct
import uuid
import copy
from pathlib import Path
from typing import Dict, List, Optional, Set

import aiofiles
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from music21 import converter, metadata, stream, tempo, note
from pydantic import BaseModel
import y_py as Y

from audiveris_service import get_audiveris_service
from annotation_service import annotation_store, Annotation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Scorely API",
    description="API for transcribing sheet music (PDF) to MusicXML, rendering score pages, and converting to audio.",
    version="1.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
CLOUD_DIR = BASE_DIR / "cloud"
CLOUD_DIR.mkdir(exist_ok=True)

# In-memory job tracking
jobs: Dict[str, dict] = {}

# Share code mapping: {code: job_id}
share_codes: Dict[str, str] = {}


def get_job_dir(job_id: str) -> Path:
    """Get the directory for a specific job, creating it if needed."""
    job_dir = CLOUD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir


# --- WEBSOCKET CONNECTION MANAGER ---


class ConnectionManager:
    """Manages WebSocket connections for real-time annotation sync"""

    def __init__(self):
        # {job_id: Set[WebSocket]}
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, job_id: str):
        """Connect a client to a job's annotation room"""
        await websocket.accept()

        if job_id not in self.active_connections:
            self.active_connections[job_id] = set()

        self.active_connections[job_id].add(websocket)
        logger.info(f"Client connected to job {job_id}. Total connections: {len(self.active_connections[job_id])}")

    def disconnect(self, websocket: WebSocket, job_id: str):
        """Disconnect a client from a job's annotation room"""
        if job_id in self.active_connections:
            self.active_connections[job_id].discard(websocket)
            logger.info(f"Client disconnected from job {job_id}. Remaining: {len(self.active_connections[job_id])}")

            # Clean up empty rooms
            if not self.active_connections[job_id]:
                del self.active_connections[job_id]

    async def broadcast(self, job_id: str, message: dict, exclude: Optional[WebSocket] = None):
        """Broadcast message to all clients in a job room"""
        if job_id not in self.active_connections:
            return

        disconnected = []

        for connection in self.active_connections[job_id]:
            if connection == exclude:
                continue

            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Failed to send message to client: {e}")
                disconnected.append(connection)

        # Clean up disconnected clients
        for connection in disconnected:
            self.disconnect(connection, job_id)


connection_manager = ConnectionManager()


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
    score_pages: Optional[str] = None
    parts: List[PartInfo] = []


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
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


class ScorePageInfo(BaseModel):
    page_number: int
    image_path: str
    width: Optional[int] = None
    height: Optional[int] = None


class ScoreMetadata(BaseModel):
    title: Optional[str] = None
    composer: Optional[str] = None
    total_pages: int
    pages: List[ScorePageInfo]


class ScorePagesResponse(BaseModel):
    job_id: str
    title: Optional[str] = None
    page_count: int
    pages: List[ScorePageInfo]
    musicxml_path: Optional[str] = None


class UpdateTitleRequest(BaseModel):
    title: str


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
        parts = list(s.parts) if hasattr(s, "parts") else [s]
        if not parts:
            return {"tempo": 120.0, "mappings": []}

        part = parts[0]
        for m in part.getElementsByClass("Measure"):
            # Offset is in quarter notes
            time_sec = float(m.offset * seconds_per_quarter)
            mappings.append({"time_seconds": time_sec, "measure": int(m.number), "beat": 1.0})

        return {"tempo": float(current_tempo), "mappings": mappings}
    except Exception as exc:
        logger.error("Failed to extract alignment from %s: %s", score_path, exc)
        return {"tempo": 120.0, "mappings": []}


def _read_png_dimensions(image_path: Path) -> tuple[int, int]:
    """Read width/height directly from the PNG IHDR chunk."""
    try:
        with image_path.open("rb") as file_handle:
            header = file_handle.read(24)
        if header[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError("Not a PNG file")
        width, height = struct.unpack(">II", header[16:24])
        return width, height
    except Exception:
        return 1240, 1754


def _build_manifest_from_existing_pages(job_id: str, musicxml_path: Path) -> Optional[Dict]:
    """Reuse previously rendered page PNGs if they already exist on disk."""
    job_dir = get_job_dir(job_id)
    existing_pages = sorted(
        job_dir.glob(f"*_page_*.png"),
        key=lambda path: int(path.stem.rsplit("_", 1)[-1]),
    )
    if not existing_pages:
        return None

    score = converter.parse(str(musicxml_path))
    title = score.metadata.title if score.metadata and score.metadata.title else None

    # Fall back to original filename if no title in metadata
    if not title and job_id in jobs and "original_filename" in jobs[job_id]:
        title = jobs[job_id]["original_filename"]
    if not title:
        title = "Untitled score"

    pages = []
    for index, page_path in enumerate(existing_pages, start=1):
        width, height = _read_png_dimensions(page_path)
        pages.append(
            {
                "page_number": index,
                "image_path": f"/api/download/{job_id}/{page_path.name}",
                "width": width,
                "height": height,
            }
        )

    return {
        "job_id": job_id,
        "title": title,
        "page_count": len(pages),
        "pages": pages,
        "musicxml_path": f"/api/download/{job_id}/{musicxml_path.name}",
    }


def _normalize_manifest(manifest: Dict, job_id: str) -> Dict:
    """Fill in missing fields for older cached page manifests."""
    job_dir = get_job_dir(job_id)
    normalized_pages = []
    for page in manifest.get("pages", []):
        normalized_page = dict(page)
        # Extract filename from path (handles both old flat and new nested paths)
        image_path_str = normalized_page["image_path"]
        if "/" in image_path_str:
            image_name = image_path_str.split("/")[-1]
        else:
            image_name = image_path_str
        image_path = job_dir / image_name
        width = normalized_page.get("width")
        height = normalized_page.get("height")
        if width is None or height is None:
            width, height = _read_png_dimensions(image_path)
        normalized_page["width"] = width
        normalized_page["height"] = height
        # Ensure path uses new nested format
        normalized_page["image_path"] = f"/api/download/{job_id}/{image_name}"
        normalized_pages.append(normalized_page)

    manifest["pages"] = normalized_pages
    manifest["page_count"] = manifest.get("page_count", len(normalized_pages))
    return manifest


def _render_pages_with_verovio(job_id: str, musicxml_path: Path) -> Dict:
    """Render MusicXML to paginated PNG score pages using Verovio."""
    import cairosvg
    import verovio

    job_dir = get_job_dir(job_id)

    toolkit = verovio.toolkit()
    toolkit.setOptions(
        {
            "pageWidth": 2100,
            "pageHeight": 2970,
            "scale": 42,
            "footer": "none",
            "header": "none",
            "adjustPageHeight": False,
        }
    )
    toolkit.loadFile(str(musicxml_path))

    page_count = toolkit.getPageCount()
    if page_count <= 0:
        raise RuntimeError("Verovio could not paginate this score")

    score = converter.parse(str(musicxml_path))
    title = score.metadata.title if score.metadata and score.metadata.title else None

    # Fall back to original filename if no title in metadata
    if not title and job_id in jobs and "original_filename" in jobs[job_id]:
        title = jobs[job_id]["original_filename"]
    if not title:
        title = "Untitled score"

    pages = []

    for page_number in range(1, page_count + 1):
        svg = toolkit.renderToSVG(page_number)
        png_path = job_dir / f"{job_id}_page_{page_number}.png"
        cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=str(png_path))
        width, height = _read_png_dimensions(png_path)
        pages.append(
            {
                "page_number": page_number,
                "image_path": f"/api/download/{job_id}/{png_path.name}",
                "width": width,
                "height": height,
            }
        )

    return {
        "job_id": job_id,
        "title": title,
        "page_count": len(pages),
        "pages": pages,
        "musicxml_path": f"/api/download/{job_id}/{musicxml_path.name}",
    }


def render_score_pages(job_id: str, musicxml_path: Path) -> Dict:
    """Render and cache score pages for a MusicXML file."""
    job_dir = get_job_dir(job_id)
    manifest_path = job_dir / "manifest.json"

    if manifest_path.exists():
        manifest = _normalize_manifest(json.loads(manifest_path.read_text()), job_id)
        manifest_path.write_text(json.dumps(manifest, indent=2))
    else:
        manifest = _build_manifest_from_existing_pages(job_id, musicxml_path)
        if manifest is None:
            manifest = _render_pages_with_verovio(job_id, musicxml_path)
        manifest_path.write_text(json.dumps(manifest, indent=2))

    if job_id in jobs:
        jobs[job_id]["score_metadata"] = {
            "title": manifest.get("title"),
            "composer": None,
            "total_pages": manifest["page_count"],
            "pages": manifest["pages"],
        }
        jobs[job_id]["files"]["score_pages"] = f"/api/score-pages/{job_id}"

    return manifest


def render_midi_to_mp3(midi_path: Path, mp3_path: Path):
    """Internal helper to call FluidSynth and convert to MP3 via ffmpeg."""
    soundfont = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
    if not os.path.exists(soundfont):
        soundfont = "/usr/share/sounds/sf3/default-gm.sf3"

    wav_path = mp3_path.with_suffix(".wav")

    import subprocess

    # 1. Render to WAV first
    subprocess_cmd = [
        "fluidsynth",
        "-ni",
        soundfont,
        str(midi_path),
        "-F",
        str(wav_path),
        "-r",
        "44100",
    ]
    result = subprocess.run(subprocess_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FluidSynth failed: {result.stderr}")

    # 2. Convert WAV to MP3 using ffmpeg
    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(wav_path),
        "-codec:a",
        "libmp3lame",
        "-qscale:a",
        "2",
        str(mp3_path),
    ]
    result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)

    if wav_path.exists():
        os.remove(wav_path)

    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr}")


def run_audio_pipeline(job_id: str, musicxml_path: Path):
    """Convert MusicXML to MIDI and audio, including individual stems with padding."""
    try:
        job_dir = get_job_dir(job_id)
        jobs[job_id]["progress"]["audio_conversion"] = "processing"
        score = converter.parse(str(musicxml_path))
        score_duration = score.highestTime

        # 1. Generate full mix
        full_midi_path = job_dir / f"{job_id}_full.mid"
        full_mp3_path = job_dir / f"{job_id}_full.mp3"
        score.write("midi", fp=str(full_midi_path))
        render_midi_to_mp3(full_midi_path, full_mp3_path)

        jobs[job_id]["files"]["full_audio"] = f"/api/download/{job_id}/{job_id}_full.mp3"
        jobs[job_id]["files"]["full_midi"] = f"/api/download/{job_id}/{job_id}_full.mid"

        # 2. Generate individual parts
        parts = list(score.parts) if hasattr(score, "parts") else [score]
        jobs[job_id]["files"]["parts"] = []

        for index, part in enumerate(parts):
            part_name = part.partName or f"Part {index + 1}"
            part_id = f"part_{index}"
            part_midi_path = job_dir / f"{job_id}_{part_id}.mid"
            part_mp3_path = job_dir / f"{job_id}_{part_id}.mp3"

            # Create a copy of the part for processing to avoid side effects
            p_clone = copy.deepcopy(part)

            # Pad part to full score duration with trailing rests
            part_end = p_clone.highestTime
            if part_end < score_duration:
                trailing_rest = note.Rest(quarterLength=score_duration - part_end)
                p_clone.append(trailing_rest)

            # Create score with this single padded part
            part_score = stream.Score()
            part_score.insert(0, p_clone)

            # Copy score metadata and tempo to part_score for consistent rendering
            part_score.insert(0, copy.deepcopy(score.metadata))
            for mm in score.flatten().getElementsByClass(tempo.MetronomeMark):
                part_score.insert(0, copy.deepcopy(mm))

            part_score.write("midi", fp=str(part_midi_path))
            render_midi_to_mp3(part_midi_path, part_mp3_path)

            jobs[job_id]["files"]["parts"].append(
                {
                    "part_id": part_id,
                    "name": part_name,
                    "audio_path": f"/api/download/{job_id}/{job_id}_{part_id}.mp3",
                    "midi_path": f"/api/download/{job_id}/{job_id}_{part_id}.mid",
                }
            )

        jobs[job_id]["alignment"] = extract_alignment(musicxml_path)
        jobs[job_id]["progress"]["audio_conversion"] = "completed"
        jobs[job_id]["status"] = "completed"
    except Exception as exc:
        logger.error("Audio pipeline failed for %s: %s", job_id, exc)
        jobs[job_id]["progress"]["audio_conversion"] = "failed"
        jobs[job_id]["error"] = str(exc)


def run_full_pipeline(job_id: str, pdf_path: Path):
    """Run Audiveris transcription, warm the score-page cache, then build audio outputs."""
    try:
        job_dir = get_job_dir(job_id)
        jobs[job_id]["progress"]["transcription"] = "processing"
        audiveris_service = get_audiveris_service()
        if audiveris_service is None:
            raise RuntimeError("Audiveris is not available. Start the Docker stack first.")

        # 1. Transcribe PDF to MusicXML (Audiveris now outputs directly to job_dir)
        mxl_output_str = audiveris_service.transcribe_pdf(str(pdf_path), str(job_dir))
        mxl_output_path = Path(mxl_output_str)

        # Ensure filename is canonical (job_id.mxl)
        canonical_path = job_dir / f"{job_id}.mxl"
        if mxl_output_path != canonical_path and mxl_output_path.exists():
            shutil.move(str(mxl_output_path), str(canonical_path))

        jobs[job_id]["progress"]["transcription"] = "completed"
        jobs[job_id]["files"]["musicxml"] = f"/api/download/{job_id}/{job_id}.mxl"

        # 2. Render Score Metadata
        try:
            render_score_pages(job_id, canonical_path)
        except Exception as exc:
            logger.warning("Score page rendering failed for %s: %s", job_id, exc)

        # 3. Audio Pipeline
        run_audio_pipeline(job_id, canonical_path)
    except Exception as exc:
        logger.error("Full pipeline failed for %s: %s", job_id, exc)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["progress"]["transcription"] = "failed"
        jobs[job_id]["error"] = str(exc)


# --- ENDPOINTS ---


@app.get("/")
async def root():
    return {"status": "running", "service": "Scorely API"}


@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    filename_lower = file.filename.lower()
    is_pdf = filename_lower.endswith(".pdf")
    is_mxl = filename_lower.endswith(".mxl") or filename_lower.endswith(".musicxml")

    if not (is_pdf or is_mxl):
        raise HTTPException(status_code=400, detail="Only PDF and MusicXML (.mxl) files are supported")

    job_id = str(uuid.uuid4())

    # Create job directory first
    job_dir = get_job_dir(job_id)

    # Extract filename without extension as default title
    original_filename = Path(file.filename).stem

    logger.info("Received file for job %s: %s", job_id, file.filename)

    # Save file directly to job folder
    content = await file.read()

    if is_mxl:
        # MusicXML file - skip transcription, go straight to rendering and audio
        mxl_path = job_dir / f"{job_id}.mxl"
        async with aiofiles.open(mxl_path, "wb") as out_file:
            await out_file.write(content)

        jobs[job_id] = {
            "status": "processing",
            "progress": {"transcription": "completed", "audio_conversion": "queued"},
            "files": {"musicxml": f"/api/download/{job_id}/{job_id}.mxl", "score_pages": None, "parts": []},
            "original_filename": original_filename,
        }

        # Skip PDF transcription, go straight to rendering and audio
        background_tasks.add_task(render_score_pages, job_id, mxl_path)
        background_tasks.add_task(run_audio_pipeline, job_id, mxl_path)

        return {"job_id": job_id, "status": "queued", "message": "Processing MusicXML file."}
    else:
        # PDF file - run full pipeline with Audiveris transcription
        pdf_path = job_dir / f"{job_id}.pdf"
        async with aiofiles.open(pdf_path, "wb") as out_file:
            await out_file.write(content)

        jobs[job_id] = {
            "status": "processing",
            "progress": {"transcription": "queued", "audio_conversion": "not_started"},
            "files": {"musicxml": None, "score_pages": None, "parts": []},
            "original_filename": original_filename,
        }

        background_tasks.add_task(run_full_pipeline, job_id, pdf_path)

        return {"job_id": job_id, "status": "queued", "message": "Transcription started."}


@app.get("/api/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    job_dir = get_job_dir(job_id)
    manifest_path = job_dir / "manifest.json"
    if job["files"].get("score_pages") is None and manifest_path.exists():
        job["files"]["score_pages"] = f"/api/score-pages/{job_id}"

    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "files": job["files"],
        "error": job.get("error"),
    }


@app.post("/api/convert-to-audio", response_model=TranscriptionResponse)
async def convert_to_audio(background_tasks: BackgroundTasks, request: ConversionRequest):
    job_id = request.job_id or str(uuid.uuid4())
    job_dir = get_job_dir(job_id)
    mxl_path = job_dir / f"{job_id}.mxl"

    # Save the updated MusicXML content
    async with aiofiles.open(mxl_path, "w") as f:
        await f.write(request.musicxml_content)

    if job_id not in jobs:
        jobs[job_id] = {
            "status": "processing",
            "progress": {"transcription": "completed", "audio_conversion": "queued"},
            "files": {
                "musicxml": f"/api/download/{job_id}/{job_id}.mxl",
                "score_pages": f"/api/score-pages/{job_id}",
                "parts": [],
            },
        }
    else:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["progress"]["audio_conversion"] = "queued"
        jobs[job_id]["files"]["score_pages"] = f"/api/score-pages/{job_id}"

    background_tasks.add_task(run_audio_pipeline, job_id, mxl_path)

    return {"job_id": job_id, "status": "queued", "message": "Audio regeneration started."}


@app.get("/api/alignment/{job_id}", response_model=AlignmentResponse)
async def get_alignment_data(job_id: str):
    if job_id not in jobs or "alignment" not in jobs[job_id]:
        job_dir = get_job_dir(job_id)
        mxl_path = job_dir / f"{job_id}.mxl"
        if mxl_path.exists():
            alignment = extract_alignment(mxl_path)
            return {"job_id": job_id, **alignment}
        raise HTTPException(status_code=404, detail="Alignment data not found")

    return {"job_id": job_id, **jobs[job_id]["alignment"]}


@app.get("/api/score-metadata/{job_id}", response_model=ScoreMetadata)
async def get_score_metadata(job_id: str):
    if job_id not in jobs or "score_metadata" not in jobs[job_id]:
        job_dir = get_job_dir(job_id)
        mxl_path = job_dir / f"{job_id}.mxl"
        if mxl_path.exists():
            manifest = render_score_pages(job_id, mxl_path)
            return {
                "title": manifest.get("title"),
                "composer": None,
                "total_pages": manifest["page_count"],
                "pages": manifest["pages"],
            }
        raise HTTPException(status_code=404, detail="Score metadata not found")

    return jobs[job_id]["score_metadata"]


@app.get("/api/score-pages/{job_id}", response_model=ScorePagesResponse)
async def get_score_pages(job_id: str):
    job_dir = get_job_dir(job_id)
    manifest_path = job_dir / "manifest.json"
    if manifest_path.exists():
        manifest = _normalize_manifest(json.loads(manifest_path.read_text()), job_id)
        manifest_path.write_text(json.dumps(manifest, indent=2))
        return manifest

    mxl_path = job_dir / f"{job_id}.mxl"
    if not mxl_path.exists():
        raise HTTPException(status_code=404, detail="Rendered score pages not found")

    try:
        return render_score_pages(job_id, mxl_path)
    except Exception as exc:
        logger.error("Failed to build score pages for %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="Failed to render paginated score pages") from exc


@app.patch("/api/score/{job_id}/title")
async def update_score_title(job_id: str, request: UpdateTitleRequest):
    """Update the title of a score."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    # Update in-memory job
    if "score_metadata" not in jobs[job_id]:
        jobs[job_id]["score_metadata"] = {}
    jobs[job_id]["score_metadata"]["title"] = request.title

    # Update manifest file if it exists
    job_dir = get_job_dir(job_id)
    manifest_path = job_dir / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        manifest["title"] = request.title
        manifest_path.write_text(json.dumps(manifest, indent=2))

    # Broadcast title change to all connected clients
    await connection_manager.broadcast(
        job_id,
        {
            "type": "title_updated",
            "title": request.title
        }
    )

    return {"job_id": job_id, "title": request.title}


@app.get("/api/download/{job_id}/{filename}")
async def download_file(job_id: str, filename: str):
    """Download a file from a specific job's directory."""
    job_dir = get_job_dir(job_id)
    file_path = job_dir / filename

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    media_type = "application/octet-stream"
    if filename.endswith(".mxl"):
        media_type = "application/vnd.recordare.musicxml"
    elif filename.endswith(".mid"):
        media_type = "audio/midi"
    elif filename.endswith(".mp3"):
        media_type = "audio/mpeg"
    elif filename.endswith(".wav"):
        media_type = "audio/wav"
    elif filename.endswith(".pdf"):
        media_type = "application/pdf"
    elif filename.endswith(".png"):
        media_type = "image/png"
    elif filename.endswith(".json"):
        media_type = "application/json"

    return FileResponse(path=str(file_path), media_type=media_type, filename=filename)


# --- ANNOTATION REST ENDPOINTS ---


@app.get("/api/annotations/{job_id}")
async def get_annotations(job_id: str):
    """Get all annotations for a job"""
    annotations = annotation_store.get_all(job_id)
    return {
        "job_id": job_id,
        "annotations": [ann.model_dump() for ann in annotations]
    }


@app.post("/api/annotations/{job_id}")
async def create_annotation(job_id: str, annotation: Annotation):
    """Create a new annotation (REST fallback)"""
    annotation.job_id = job_id
    created_ann = annotation_store.create(annotation)

    # Broadcast to WebSocket clients
    await connection_manager.broadcast(
        job_id,
        {
            "type": "annotation_added",
            "annotation": created_ann.model_dump()
        }
    )

    return created_ann.model_dump()


@app.delete("/api/annotations/{job_id}/{annotation_id}")
async def delete_annotation(job_id: str, annotation_id: str):
    """Delete an annotation"""
    success = annotation_store.delete(job_id, annotation_id)

    if not success:
        raise HTTPException(status_code=404, detail="Annotation not found")

    # Broadcast to WebSocket clients
    await connection_manager.broadcast(
        job_id,
        {
            "type": "annotation_deleted",
            "annotation_id": annotation_id
        }
    )

    return {"success": True, "annotation_id": annotation_id}


# --- ANNOTATION WEBSOCKET ENDPOINT ---


@app.websocket("/ws/annotations/{job_id}")
async def websocket_annotations(websocket: WebSocket, job_id: str):
    """WebSocket endpoint for real-time annotation synchronization"""
    await connection_manager.connect(websocket, job_id)

    try:
        # Send initial state (all existing annotations)
        annotations = annotation_store.get_all(job_id)
        await websocket.send_json({
            "type": "sync_response",
            "annotations": [ann.model_dump() for ann in annotations]
        })

        # Send Yjs state vector
        state_vector = annotation_store.get_yjs_state_vector(job_id)
        await websocket.send_json({
            "type": "yjs_state_vector",
            "state_vector": state_vector.hex()
        })

        # Listen for client messages
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")

            if message_type == "annotation_added":
                # Client created a new annotation
                ann_data = data.get("annotation")
                if ann_data:
                    try:
                        annotation = Annotation(**ann_data)
                        created_ann = annotation_store.create(annotation)

                        # Broadcast to other clients
                        await connection_manager.broadcast(
                            job_id,
                            {
                                "type": "annotation_added",
                                "annotation": created_ann.model_dump()
                            },
                            exclude=websocket
                        )
                    except Exception as e:
                        logger.error(f"Failed to create annotation: {e}")
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Failed to create annotation: {str(e)}"
                        })

            elif message_type == "annotation_updated":
                # Client updated an annotation
                ann_data = data.get("annotation")
                if ann_data:
                    try:
                        # Check if this is a temporary live update
                        is_temp = ann_data.pop("_isTemp", False)
                        ann_data.pop("_isFinal", False)  # Remove flag if present

                        if is_temp:
                            # Don't persist temporary updates, just broadcast them
                            await connection_manager.broadcast(
                                job_id,
                                {
                                    "type": "annotation_updated",
                                    "annotation": ann_data
                                },
                                exclude=websocket
                            )
                        else:
                            # Regular or final update - persist to store
                            annotation = Annotation(**ann_data)
                            updated_ann = annotation_store.update(annotation)

                            if updated_ann:
                                # Broadcast to other clients
                                await connection_manager.broadcast(
                                    job_id,
                                    {
                                        "type": "annotation_updated",
                                        "annotation": updated_ann.model_dump()
                                    },
                                    exclude=websocket
                                )
                    except Exception as e:
                        logger.error(f"Failed to update annotation: {e}")

            elif message_type == "annotation_deleted":
                # Client deleted an annotation
                annotation_id = data.get("annotation_id")
                if annotation_id:
                    success = annotation_store.delete(job_id, annotation_id)

                    if success:
                        # Broadcast to other clients
                        await connection_manager.broadcast(
                            job_id,
                            {
                                "type": "annotation_deleted",
                                "annotation_id": annotation_id
                            },
                            exclude=websocket
                        )

            elif message_type == "yjs_update":
                # Client sent Yjs update
                update_hex = data.get("update")
                if update_hex:
                    try:
                        update_bytes = bytes.fromhex(update_hex)
                        annotation_store.apply_yjs_update(job_id, update_bytes)

                        # Broadcast to other clients
                        await connection_manager.broadcast(
                            job_id,
                            {
                                "type": "yjs_update",
                                "update": update_hex
                            },
                            exclude=websocket
                        )
                    except Exception as e:
                        logger.error(f"Failed to apply Yjs update: {e}")

            elif message_type == "sync_request":
                # Client requested full sync
                annotations = annotation_store.get_all(job_id)
                await websocket.send_json({
                    "type": "sync_response",
                    "annotations": [ann.model_dump() for ann in annotations]
                })

    except WebSocketDisconnect:
        connection_manager.disconnect(websocket, job_id)
        logger.info(f"WebSocket disconnected for job {job_id}")
    except Exception as e:
        logger.error(f"WebSocket error for job {job_id}: {e}")
        connection_manager.disconnect(websocket, job_id)


# --- SHARE CODE ENDPOINTS ---


def generate_share_code() -> str:
    """Generate a random 6-character alphanumeric share code."""
    import random
    import string
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if code not in share_codes:
            return code


class ShareCodeResponse(BaseModel):
    job_id: str
    share_code: str
    message: str


class ResolveCodeResponse(BaseModel):
    job_id: str
    title: Optional[str] = None
    status: str
    files: FilePaths


@app.post("/api/share/{job_id}", response_model=ShareCodeResponse)
async def create_share_code(job_id: str):
    """Generate a shareable code for a job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    # Check if a code already exists for this job
    existing_code = None
    for code, jid in share_codes.items():
        if jid == job_id:
            existing_code = code
            break

    if existing_code:
        return {
            "job_id": job_id,
            "share_code": existing_code,
            "message": "Share code retrieved"
        }

    # Generate new code
    share_code = generate_share_code()
    share_codes[share_code] = job_id
    logger.info(f"Generated share code {share_code} for job {job_id}")

    return {
        "job_id": job_id,
        "share_code": share_code,
        "message": "Share code created"
    }


@app.get("/api/resolve-code/{code}", response_model=ResolveCodeResponse)
async def resolve_share_code(code: str):
    """Resolve a share code to job details."""
    code_upper = code.upper()

    if code_upper not in share_codes:
        raise HTTPException(status_code=404, detail="Invalid share code")

    job_id = share_codes[code_upper]

    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job no longer available")

    job = jobs[job_id]

    # Get title from score metadata if available
    title = None
    if "score_metadata" in job:
        title = job["score_metadata"].get("title")

    return {
        "job_id": job_id,
        "title": title,
        "status": job["status"],
        "files": job["files"]
    }
