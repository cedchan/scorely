"""
Scorely API - Backend for sheet music transcription, rendering, and conversion.
"""
import json
import logging
import os
import shutil
import uuid
from pathlib import Path
from typing import Dict, List, Optional

import aiofiles
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from music21 import converter, metadata, stream, tempo
from pydantic import BaseModel

from audiveris_service import get_audiveris_service

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

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

jobs: Dict[str, dict] = {}


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


class ScorePageInfo(BaseModel):
    page_number: int
    image_path: str


class ScorePagesResponse(BaseModel):
    job_id: str
    title: str
    page_count: int
    pages: List[ScorePageInfo]
    musicxml_path: str


def extract_alignment(score_path: Path) -> Dict:
    """Extract seconds-to-measure mapping from a MusicXML file."""
    try:
        score = converter.parse(str(score_path))
        current_tempo = 120
        tempo_marks = score.flatten().getElementsByClass(tempo.MetronomeMark)
        if tempo_marks and tempo_marks[0].number:
            current_tempo = tempo_marks[0].number

        seconds_per_quarter = 60.0 / current_tempo
        mappings = []
        part = score.parts[0]

        for measure in part.getElementsByClass("Measure"):
            mappings.append(
                {
                    "time_seconds": float(measure.offset * seconds_per_quarter),
                    "measure": int(measure.number),
                    "beat": 1.0,
                }
            )

        return {"tempo": float(current_tempo), "mappings": mappings}
    except Exception as exc:
        logger.error("Failed to extract alignment from %s: %s", score_path, exc)
        return {"tempo": 120.0, "mappings": []}


def get_score_title(score_path: Path) -> str:
    """Best-effort title extraction for rendered score views."""
    try:
        score = converter.parse(str(score_path))
        if score.metadata and score.metadata.title:
            return score.metadata.title
        title = score.metadata.movementName if score.metadata else None
        if title:
            return title
    except Exception as exc:
        logger.warning("Could not extract title from %s: %s", score_path, exc)
    return score_path.stem


def get_musicxml_path(job_id: str) -> Path:
    score_path = OUTPUT_DIR / f"{job_id}.mxl"
    if not score_path.exists():
        raise HTTPException(status_code=404, detail="MusicXML file not found for this job")
    return score_path


def render_score_pages(job_id: str, musicxml_path: Path) -> Dict:
    """
    Render a MusicXML/MXL score into paginated PNG pages for the frontend.
    The output is cached in outputs/ and described by a JSON manifest.
    """
    try:
        import cairosvg
        import verovio
    except ImportError as exc:
        raise RuntimeError(
            "Score rendering dependencies are missing. Install verovio and CairoSVG."
        ) from exc

    manifest_path = OUTPUT_DIR / f"{job_id}_pages.json"
    if manifest_path.exists():
        with manifest_path.open() as manifest_file:
            manifest = json.load(manifest_file)
        if all((OUTPUT_DIR / Path(page["image_path"]).name).exists() for page in manifest["pages"]):
            return manifest

    toolkit = verovio.toolkit()
    resource_dir = Path(verovio.__file__).resolve().parent / "data"
    options = {
        "adjustPageHeight": True,
        "breaks": "auto",
        "footer": "none",
        "header": "none",
        "pageHeight": 2970,
        "pageWidth": 2100,
        "scale": 42,
    }
    try:
        toolkit.setOptions(options)
    except TypeError:
        toolkit.setOptions(json.dumps(options))
    toolkit.setResourcePath(str(resource_dir))
    toolkit.loadFile(str(musicxml_path))

    page_count = toolkit.getPageCount()
    if page_count < 1:
        raise RuntimeError("No score pages were generated from the MusicXML file.")

    pages = []
    for page_number in range(1, page_count + 1):
        svg = toolkit.renderToSVG(page_number)
        image_name = f"{job_id}_page_{page_number}.png"
        image_path = OUTPUT_DIR / image_name
        cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=str(image_path))
        pages.append(
            {
                "page_number": page_number,
                "image_path": f"/api/download/{image_name}",
            }
        )

    manifest = {
        "job_id": job_id,
        "title": get_score_title(musicxml_path),
        "page_count": page_count,
        "pages": pages,
        "musicxml_path": f"/api/download/{musicxml_path.name}",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return manifest


def render_midi_to_mp3(midi_path: Path, mp3_path: Path):
    """Render a MIDI file into MP3 via FluidSynth and ffmpeg."""
    soundfont = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
    if not os.path.exists(soundfont):
        soundfont = "/usr/share/sounds/sf3/default-gm.sf3"

    wav_path = mp3_path.with_suffix(".wav")

    import subprocess

    fluidsynth_cmd = [
        "fluidsynth",
        "-ni",
        soundfont,
        str(midi_path),
        "-F",
        str(wav_path),
        "-r",
        "44100",
    ]
    result = subprocess.run(fluidsynth_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FluidSynth failed: {result.stderr}")

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
    """Convert MusicXML to MIDI and audio, including individual stems."""
    try:
        jobs[job_id]["progress"]["audio_conversion"] = "processing"
        score = converter.parse(str(musicxml_path))
        parts = list(score.parts) if hasattr(score, "parts") else [score]

        full_midi_path = OUTPUT_DIR / f"{job_id}_full.mid"
        full_mp3_path = OUTPUT_DIR / f"{job_id}_full.mp3"
        score.write("midi", fp=str(full_midi_path))
        render_midi_to_mp3(full_midi_path, full_mp3_path)

        jobs[job_id]["parts"] = []
        for index, part in enumerate(parts):
            part_name = part.partName or f"Part {index + 1}"
            part_id = f"part_{index}"
            part_midi_path = OUTPUT_DIR / f"{job_id}_{part_id}.mid"
            part_mp3_path = OUTPUT_DIR / f"{job_id}_{part_id}.mp3"

            part_score = stream.Score()
            part_score.insert(0, part)

            part_score.write("midi", fp=str(part_midi_path))
            render_midi_to_mp3(part_midi_path, part_mp3_path)

            jobs[job_id]["parts"].append(
                {
                    "part_id": part_id,
                    "name": part_name,
                    "audio_path": f"/api/download/{job_id}_{part_id}.mp3",
                    "midi_path": f"/api/download/{job_id}_{part_id}.mid",
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
        jobs[job_id]["progress"]["transcription"] = "processing"
        audiveris_service = get_audiveris_service()
        if audiveris_service is None:
            raise RuntimeError("Audiveris is not available. Start the Docker stack first.")

        transcribed_path = Path(audiveris_service.transcribe_pdf(str(pdf_path), str(OUTPUT_DIR)))
        canonical_path = OUTPUT_DIR / f"{job_id}.mxl"
        if transcribed_path != canonical_path:
            shutil.copyfile(transcribed_path, canonical_path)
        else:
            canonical_path = transcribed_path

        jobs[job_id]["progress"]["transcription"] = "completed"
        jobs[job_id]["files"]["musicxml"] = f"/api/download/{canonical_path.name}"

        try:
            render_score_pages(job_id, canonical_path)
        except Exception as exc:
            logger.warning("Score page rendering failed for %s: %s", job_id, exc)

        run_audio_pipeline(job_id, canonical_path)
    except Exception as exc:
        logger.error("Full pipeline failed for %s: %s", job_id, exc)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["progress"]["transcription"] = "failed"
        jobs[job_id]["error"] = str(exc)


@app.get("/")
async def root():
    return {"status": "running", "service": "Scorely API"}


@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    job_id = str(uuid.uuid4())
    pdf_path = UPLOAD_DIR / f"{job_id}.pdf"

    async with aiofiles.open(pdf_path, "wb") as out_file:
        content = await file.read()
        await out_file.write(content)

    jobs[job_id] = {
        "status": "processing",
        "progress": {
            "transcription": "queued",
            "audio_conversion": "not_started",
        },
        "files": {
            "musicxml": f"/api/download/{job_id}.mxl",
            "full_audio": f"/api/download/{job_id}_full.mp3",
            "full_midi": f"/api/download/{job_id}_full.mid",
            "score_pages": f"/api/score-pages/{job_id}",
        },
        "parts": [],
    }

    background_tasks.add_task(run_full_pipeline, job_id, pdf_path)
    return {"job_id": job_id, "status": "queued", "message": "Transcription started."}


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
        "error": job.get("error"),
    }


@app.get("/api/score-pages/{job_id}", response_model=ScorePagesResponse)
async def get_score_pages(job_id: str):
    musicxml_path = get_musicxml_path(job_id)

    try:
        manifest = render_score_pages(job_id, musicxml_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Score rendering failed: {exc}") from exc

    return manifest


@app.post("/api/convert-to-audio", response_model=TranscriptionResponse)
async def convert_to_audio(background_tasks: BackgroundTasks, request: ConversionRequest):
    job_id = request.job_id or str(uuid.uuid4())
    mxl_path = OUTPUT_DIR / f"{job_id}.mxl"

    async with aiofiles.open(mxl_path, "w") as score_file:
        await score_file.write(request.musicxml_content)

    if job_id not in jobs:
        jobs[job_id] = {
            "status": "processing",
            "progress": {"transcription": "completed", "audio_conversion": "queued"},
            "files": {
                "musicxml": f"/api/download/{job_id}.mxl",
                "full_audio": f"/api/download/{job_id}_full.mp3",
                "full_midi": f"/api/download/{job_id}_full.mid",
                "score_pages": f"/api/score-pages/{job_id}",
            },
            "parts": [],
        }
    else:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["progress"]["audio_conversion"] = "queued"

    background_tasks.add_task(run_audio_pipeline, job_id, mxl_path)
    return {"job_id": job_id, "status": "queued", "message": "Audio regeneration started."}


@app.get("/api/alignment/{job_id}", response_model=AlignmentResponse)
async def get_alignment_data(job_id: str):
    if job_id in jobs and "alignment" in jobs[job_id]:
        return {"job_id": job_id, **jobs[job_id]["alignment"]}

    mxl_path = OUTPUT_DIR / f"{job_id}.mxl"
    if mxl_path.exists():
        return {"job_id": job_id, **extract_alignment(mxl_path)}

    raise HTTPException(status_code=404, detail="Alignment data not found")


@app.get("/api/download/{filename}")
async def download_file(filename: str):
    file_path = OUTPUT_DIR / filename
    if not file_path.exists():
        file_path = UPLOAD_DIR / filename

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    media_type = "application/octet-stream"
    if filename.endswith(".mxl"):
        media_type = "application/vnd.recordare.musicxml"
    elif filename.endswith(".mid"):
        media_type = "audio/midi"
    elif filename.endswith(".mp3"):
        media_type = "audio/mpeg"
    elif filename.endswith(".png"):
        media_type = "image/png"
    elif filename.endswith(".wav"):
        media_type = "audio/wav"
    elif filename.endswith(".pdf"):
        media_type = "application/pdf"

    return FileResponse(path=str(file_path), media_type=media_type, filename=filename)
