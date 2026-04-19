"""
Scorely API - Backend for sheet music transcription, rendering, and conversion.
"""
import json
import logging
import os
import re
import shutil
import struct
import uuid
import copy
from pathlib import Path
from typing import Dict, List, Optional, Set
import xml.etree.ElementTree as ET

import aiofiles
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from music21 import converter, metadata, stream, tempo, note
from pydantic import BaseModel, Field
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
HARDCODED_PDF_MXL_MAP = {
    "sample1.pdf": BASE_DIR / "uploads" / "sample1.mxl",
    "sample2.pdf": BASE_DIR / "uploads" / "sample2.mxl",
}
HARDCODED_SCORE_ASSET_MAP = {
    "sample1": BASE_DIR / "demo_scores" / "sample1",
    "sample2": BASE_DIR / "demo_scores" / "sample2",
}
ALIGNMENT_VERSION = 2
MEASURE_REGION_VERSION = 2
VEROVIO_OPTIONS = {
    "pageWidth": 2100,
    "pageHeight": 2970,
    "scale": 42,
    "footer": "none",
    "header": "none",
    "adjustPageHeight": False,
}
SVG_NS = {"svg": "http://www.w3.org/2000/svg"}
SVG_NUMBER_PATTERN = re.compile(r"-?\d+(?:\.\d+)?")
SVG_TRANSLATE_PATTERN = re.compile(
    r"translate\(\s*(-?\d+(?:\.\d+)?)\s*(?:[, ]\s*(-?\d+(?:\.\d+)?))?"
)
SVG_PATH_WITHOUT_STROKE_PATTERN = re.compile(r"<path(?![^>]*\bstroke=)([^>]*)>")

# In-memory job tracking
jobs: Dict[str, dict] = {}

# Share code mapping: {code: job_id}
share_codes: Dict[str, str] = {}


def get_job_dir(job_id: str) -> Path:
    """Get the directory for a specific job, creating it if needed."""
    job_dir = CLOUD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir


def get_hardcoded_mxl_for_pdf(filename: str) -> Optional[Path]:
    """Return a hardcoded MusicXML path for specific demo PDFs."""
    pdf_name = Path(filename).name.lower()
    mapped_path = HARDCODED_PDF_MXL_MAP.get(pdf_name)
    if mapped_path is None:
        return None
    return mapped_path.expanduser()


def get_hardcoded_score_asset_dir(filename: str) -> Optional[Path]:
    """Return bundled score-page assets for known demo filenames."""
    asset_key = Path(filename).stem.lower()
    asset_dir = HARDCODED_SCORE_ASSET_MAP.get(asset_key)
    if asset_dir is None:
        return None
    return asset_dir.expanduser()


# --- WEBSOCKET CONNECTION MANAGER ---


class ConnectionManager:
    """Manages WebSocket connections for real-time annotation sync"""

    def __init__(self):
        # {job_id: Set[WebSocket]}
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # {job_id: {websocket: {'user_id': str, 'username': str}}}
        self.user_info: Dict[str, Dict[WebSocket, dict]] = {}

    async def connect(self, websocket: WebSocket, job_id: str):
        """Connect a client to a job's annotation room"""
        await websocket.accept()

        if job_id not in self.active_connections:
            self.active_connections[job_id] = set()
            self.user_info[job_id] = {}

        self.active_connections[job_id].add(websocket)
        logger.info(f"Client connected to job {job_id}. Total connections: {len(self.active_connections[job_id])}")

    def disconnect(self, websocket: WebSocket, job_id: str):
        """Disconnect a client from a job's annotation room"""
        if job_id in self.active_connections:
            self.active_connections[job_id].discard(websocket)

            # Remove user info and get it for broadcasting
            user_info = None
            if job_id in self.user_info and websocket in self.user_info[job_id]:
                user_info = self.user_info[job_id].pop(websocket)

            logger.info(f"Client disconnected from job {job_id}. Remaining: {len(self.active_connections[job_id])}")

            # Clean up empty rooms
            if not self.active_connections[job_id]:
                del self.active_connections[job_id]
                if job_id in self.user_info:
                    del self.user_info[job_id]

            return user_info

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

    def add_user_info(self, websocket: WebSocket, job_id: str, user_id: str, username: str):
        """Store user information for a websocket connection"""
        if job_id not in self.user_info:
            self.user_info[job_id] = {}
        self.user_info[job_id][websocket] = {
            'user_id': user_id,
            'username': username
        }

    def get_present_users(self, job_id: str) -> list:
        """Get list of all present users in a job room"""
        if job_id not in self.user_info:
            return []
        return [
            {'user_id': info['user_id'], 'username': info['username']}
            for info in self.user_info[job_id].values()
        ]


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
    parts: List[PartInfo] = Field(default_factory=list)


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: SubStatus
    files: FilePaths
    error: Optional[str] = None


class AlignmentPoint(BaseModel):
    time_seconds: float
    measure: int
    measure_index: int
    beat: float


class AlignmentResponse(BaseModel):
    job_id: str
    tempo: float
    mappings: List[AlignmentPoint]


class MeasureRegion(BaseModel):
    measure: int
    measure_index: int
    x: float
    y: float
    width: float
    height: float


class ScorePageInfo(BaseModel):
    page_number: int
    image_path: str
    width: Optional[int] = None
    height: Optional[int] = None
    measure_regions: List[MeasureRegion] = Field(default_factory=list)


class ScoreMetadata(BaseModel):
    title: Optional[str] = None
    composer: Optional[str] = None
    total_pages: int
    pages: List[ScorePageInfo] = Field(default_factory=list)


class ScorePagesResponse(BaseModel):
    job_id: str
    title: Optional[str] = None
    page_count: int
    pages: List[ScorePageInfo] = Field(default_factory=list)
    musicxml_path: Optional[str] = None


class UpdateTitleRequest(BaseModel):
    title: str


# --- HELPER FUNCTIONS ---


def extract_alignment(score_path: Path) -> Dict:
    """Extract measure timing from absolute score seconds instead of a single global tempo."""
    try:
        s = converter.parse(str(score_path))
        mappings = []

        # Iterate through measures in the first part (measures are synced across parts)
        parts = list(s.parts) if hasattr(s, "parts") else [s]
        if not parts:
            return {"tempo": 120.0, "mappings": []}

        part = parts[0]
        flattened_part = part.flatten()
        absolute_measure_times: Dict[int, float] = {}

        for entry in flattened_part.secondsMap:
            element = entry.get("element")
            if element is None or not hasattr(element, "getContextByClass"):
                continue

            measure_context = element.getContextByClass("Measure")
            if measure_context is None:
                continue

            offset_seconds = entry.get("offsetSeconds")
            if offset_seconds is None:
                continue

            measure_key = id(measure_context)
            current_offset = absolute_measure_times.get(measure_key)
            if current_offset is None or float(offset_seconds) < current_offset:
                absolute_measure_times[measure_key] = float(offset_seconds)

        current_tempo = 120.0
        tempo_marks = s.flatten().getElementsByClass(tempo.MetronomeMark)
        if tempo_marks and tempo_marks[0].number:
            current_tempo = float(tempo_marks[0].number)

        previous_time_sec = 0.0
        previous_duration_sec = 0.0
        for measure_index, m in enumerate(part.getElementsByClass("Measure")):
            try:
                measure_number = int(m.number)
            except (TypeError, ValueError):
                measure_number = measure_index + 1

            time_sec = absolute_measure_times.get(id(m))
            if time_sec is None:
                # Fallback if a measure has no captured entries in the seconds map.
                time_sec = previous_time_sec + previous_duration_sec

            mappings.append(
                {
                    "time_seconds": float(time_sec),
                    "measure": measure_number,
                    "measure_index": measure_index,
                    "beat": 1.0,
                }
            )
            previous_time_sec = float(time_sec)
            previous_duration_sec = float(m.seconds or 0.0) if m.seconds == m.seconds else 0.0

        mappings.sort(key=lambda mapping: mapping["measure_index"])
        return {"tempo": current_tempo, "mappings": mappings, "version": ALIGNMENT_VERSION}
    except Exception as exc:
        logger.error("Failed to extract alignment from %s: %s", score_path, exc)
        return {"tempo": 120.0, "mappings": [], "version": ALIGNMENT_VERSION}


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


def _parse_svg_dimension(value: Optional[str], fallback: int) -> int:
    """Parse an SVG dimension attribute like '882px' into an integer."""
    if not value:
        return fallback

    match = SVG_NUMBER_PATTERN.search(value)
    if not match:
        return fallback

    try:
        return int(round(float(match.group(0))))
    except ValueError:
        return fallback


def _read_svg_dimensions(svg_path: Path) -> tuple[int, int]:
    """Read width/height from an SVG root element."""
    try:
        root = ET.fromstring(svg_path.read_text())
        width = _parse_svg_dimension(root.get("width"), 882)
        height = _parse_svg_dimension(root.get("height"), 1248)
        return width, height
    except Exception:
        return 882, 1248


def _inline_svg_path_strokes(svg: str) -> str:
    """Inline stroke attributes on SVG paths for renderers that ignore embedded CSS."""
    return SVG_PATH_WITHOUT_STROKE_PATTERN.sub(r'<path stroke="currentColor"\1>', svg)


def _ensure_svg_is_renderer_friendly(svg_path: Path) -> None:
    """Backfill explicit stroke attributes into cached SVGs when needed."""
    try:
        original_svg = svg_path.read_text()
        normalized_svg = _inline_svg_path_strokes(original_svg)
        if normalized_svg != original_svg:
            svg_path.write_text(normalized_svg)
    except Exception as exc:
        logger.warning("Failed to normalize cached SVG %s: %s", svg_path, exc)


def _create_verovio_toolkit(musicxml_path: Path):
    """Load a MusicXML file into a Verovio toolkit with the app's page settings."""
    import verovio

    toolkit = verovio.toolkit()
    toolkit.setOptions(VEROVIO_OPTIONS)
    toolkit.loadFile(str(musicxml_path))
    return toolkit


def _parse_svg_translate(transform: Optional[str]) -> tuple[float, float]:
    """Extract translate(x, y) from an SVG transform string."""
    if not transform:
        return 0.0, 0.0

    match = SVG_TRANSLATE_PATTERN.search(transform)
    if not match:
        return 0.0, 0.0

    return float(match.group(1)), float(match.group(2) or 0.0)


def _update_bounds(bounds: Dict[str, float], x: float, y: float) -> None:
    """Expand a bounding box in-place to include the given point."""
    bounds["min_x"] = min(bounds["min_x"], x)
    bounds["max_x"] = max(bounds["max_x"], x)
    bounds["min_y"] = min(bounds["min_y"], y)
    bounds["max_y"] = max(bounds["max_y"], y)


def _collect_relevant_svg_bounds(element, bounds: Dict[str, float], offset_x: float = 0.0, offset_y: float = 0.0):
    """Collect bounds from staff and barline SVG geometry within a measure."""
    translate_x, translate_y = _parse_svg_translate(element.get("transform"))
    current_x = offset_x + translate_x
    current_y = offset_y + translate_y

    tag = element.tag.split("}")[-1]
    if tag == "path":
        coordinates = [float(value) for value in SVG_NUMBER_PATTERN.findall(element.get("d", ""))]
        for index in range(0, len(coordinates) - 1, 2):
            _update_bounds(bounds, current_x + coordinates[index], current_y + coordinates[index + 1])
    elif tag in {"text", "use"}:
        x_value = element.get("x")
        y_value = element.get("y")
        if x_value is not None and y_value is not None:
            _update_bounds(bounds, current_x + float(x_value), current_y + float(y_value))

    for child in list(element):
        _collect_relevant_svg_bounds(child, bounds, current_x, current_y)


def _collect_measure_content_bounds(
    element,
    bounds: Dict[str, float],
    offset_x: float = 0.0,
    offset_y: float = 0.0,
    ancestor_classes: Optional[Set[str]] = None,
):
    """Collect bounds for actual musical content, excluding staff lines and pure barlines."""
    inherited_classes = set(ancestor_classes or set())
    current_classes = set((element.get("class") or "").split())
    next_classes = inherited_classes | current_classes

    translate_x, translate_y = _parse_svg_translate(element.get("transform"))
    current_x = offset_x + translate_x
    current_y = offset_y + translate_y

    tag = element.tag.split("}")[-1]
    if tag == "use":
        x_value = float(element.get("x", "0"))
        y_value = float(element.get("y", "0"))
        _update_bounds(bounds, current_x + x_value, current_y + y_value)
    elif tag == "text":
        x_value = element.get("x")
        y_value = element.get("y")
        if x_value is not None and y_value is not None:
            _update_bounds(bounds, current_x + float(x_value), current_y + float(y_value))
    elif tag == "path":
        ignorable_ancestor_classes = {"staff", "layer", "barLine"}
        interesting_ancestor_classes = {
            "beam",
            "slur",
            "tie",
            "tupletBracket",
            "stem",
            "ledgerLine",
            "rest",
            "note",
            "chord",
            "artic",
        }
        should_ignore_path = (
            inherited_classes
            and inherited_classes.issubset(ignorable_ancestor_classes)
            and inherited_classes.isdisjoint(interesting_ancestor_classes)
        )
        if not should_ignore_path:
            coordinates = [float(value) for value in SVG_NUMBER_PATTERN.findall(element.get("d", ""))]
            for index in range(0, len(coordinates) - 1, 2):
                _update_bounds(bounds, current_x + coordinates[index], current_y + coordinates[index + 1])

    for child in list(element):
        _collect_measure_content_bounds(child, bounds, current_x, current_y, next_classes)


def _measure_region_from_svg_element(
    measure_element,
    toolkit,
    page_width: float,
    page_height: float,
    offset_x: float = 0.0,
    offset_y: float = 0.0,
) -> Optional[Dict]:
    """Build a normalized measure rectangle from a Verovio SVG measure group."""
    measure_attributes = toolkit.getElementAttr(measure_element.get("id"))
    measure_number = measure_attributes.get("n")
    if measure_number is None:
        return None

    try:
        measure_value = int(measure_number)
    except (TypeError, ValueError):
        return None

    bounds = {
        "min_x": float("inf"),
        "max_x": float("-inf"),
        "min_y": float("inf"),
        "max_y": float("-inf"),
    }

    for child in list(measure_element):
        classes = set((child.get("class") or "").split())
        if "staff" not in classes and "barLine" not in classes:
            continue
        _collect_relevant_svg_bounds(child, bounds, offset_x, offset_y)

    if bounds["min_x"] == float("inf") or bounds["min_y"] == float("inf"):
        return None

    horizontal_trim = page_width * 0.002
    vertical_trim = page_height * 0.002
    final_bounds = {
        "min_x": min(bounds["max_x"], bounds["min_x"] + horizontal_trim),
        "max_x": max(bounds["min_x"], bounds["max_x"] - horizontal_trim),
        "min_y": min(bounds["max_y"], bounds["min_y"] + vertical_trim),
        "max_y": max(bounds["min_y"], bounds["max_y"] - vertical_trim),
    }

    min_x = max(0.0, final_bounds["min_x"] / page_width)
    max_x = min(1.0, final_bounds["max_x"] / page_width)
    min_y = max(0.0, final_bounds["min_y"] / page_height)
    max_y = min(1.0, final_bounds["max_y"] / page_height)
    width = max(0.0, max_x - min_x)
    height = max(0.0, max_y - min_y)

    if width <= 0.0 or height <= 0.0:
        return None

    return {
        "measure": measure_value,
        "measure_index": -1,
        "x": round(min_x, 6),
        "y": round(min_y, 6),
        "width": round(width, 6),
        "height": round(height, 6),
    }


def _get_svg_viewbox_size(root) -> tuple[float, float]:
    """Read the coordinate space used by Verovio's rendered SVG."""
    for svg_element in root.findall(".//svg:svg", SVG_NS):
        view_box = svg_element.get("viewBox")
        if not view_box:
            continue
        values = [float(value) for value in view_box.split()]
        if len(values) == 4 and values[2] > 0 and values[3] > 0:
            return values[2], values[3]

    return float(VEROVIO_OPTIONS["pageWidth"]), float(VEROVIO_OPTIONS["pageHeight"])


def _extract_measure_regions_from_svg(svg: str, toolkit) -> List[Dict]:
    """Extract normalized measure rectangles from a rendered Verovio SVG page."""
    root = ET.fromstring(svg)
    page_width, page_height = _get_svg_viewbox_size(root)
    measure_regions = []

    def walk(element, offset_x: float = 0.0, offset_y: float = 0.0):
        translate_x, translate_y = _parse_svg_translate(element.get("transform"))
        current_x = offset_x + translate_x
        current_y = offset_y + translate_y

        tag = element.tag.split("}")[-1]
        classes = set((element.get("class") or "").split())
        if tag == "g" and "measure" in classes:
            measure_region = _measure_region_from_svg_element(
                element,
                toolkit,
                page_width,
                page_height,
                current_x,
                current_y,
            )
            if measure_region is not None:
                measure_regions.append(measure_region)

        for child in list(element):
            walk(child, current_x, current_y)

    walk(root)

    measure_regions.sort(key=lambda region: region["measure"])
    return measure_regions


def _build_measure_regions_by_page(musicxml_path: Path) -> Dict[int, List[Dict]]:
    """Render SVG pages with Verovio and return extracted measure rectangles for each page."""
    toolkit = _create_verovio_toolkit(musicxml_path)
    page_count = toolkit.getPageCount()
    if page_count <= 0:
        return {}

    measure_regions_by_page = {
        page_number: _extract_measure_regions_from_svg(toolkit.renderToSVG(page_number), toolkit)
        for page_number in range(1, page_count + 1)
    }
    measure_index = 0
    for page_number in sorted(measure_regions_by_page):
        for region in measure_regions_by_page[page_number]:
            region["measure_index"] = measure_index
            measure_index += 1

    return measure_regions_by_page


def _build_manifest_from_existing_pages(job_id: str, musicxml_path: Path) -> Optional[Dict]:
    """Reuse previously rendered page SVGs if they already exist on disk."""
    job_dir = get_job_dir(job_id)
    existing_pages = sorted(
        job_dir.glob(f"*_page_*.svg"),
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

    measure_regions_by_page = _build_measure_regions_by_page(musicxml_path)
    pages = []
    for index, page_path in enumerate(existing_pages, start=1):
        _ensure_svg_is_renderer_friendly(page_path)
        width, height = _read_svg_dimensions(page_path)
        pages.append(
            {
                "page_number": index,
                "image_path": f"/api/download/{job_id}/{page_path.name}",
                "width": width,
                "height": height,
                "measure_regions": measure_regions_by_page.get(index, []),
            }
        )

    return {
        "job_id": job_id,
        "title": title,
        "page_count": len(pages),
        "pages": pages,
        "musicxml_path": f"/api/download/{job_id}/{musicxml_path.name}",
        "measure_region_version": MEASURE_REGION_VERSION,
    }


def _cache_manifest_for_job(job_id: str, manifest: Dict) -> Dict:
    """Persist a manifest and mirror its key fields into in-memory job state."""
    job_dir = get_job_dir(job_id)
    manifest_path = job_dir / "manifest.json"
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


def hydrate_bundled_score_pages(job_id: str, musicxml_path: Path, asset_dir: Path) -> Dict:
    """Copy pre-rendered demo SVG pages into the job cache and write a job-specific manifest."""
    manifest_template_path = asset_dir / "manifest.json"
    if not manifest_template_path.exists():
        raise FileNotFoundError(f"Bundled score manifest not found: {manifest_template_path}")

    manifest_template = json.loads(manifest_template_path.read_text())
    job_dir = get_job_dir(job_id)
    hydrated_pages = []

    for page in manifest_template.get("pages", []):
        template_image_name = Path(page["image_path"]).name
        source_image_path = asset_dir / template_image_name
        if not source_image_path.exists():
            raise FileNotFoundError(f"Bundled score page not found: {source_image_path}")

        page_number = int(page["page_number"])
        image_suffix = source_image_path.suffix or ".svg"
        target_image_name = f"{job_id}_page_{page_number}{image_suffix}"
        shutil.copyfile(source_image_path, job_dir / target_image_name)

        hydrated_page = dict(page)
        hydrated_page["image_path"] = f"/api/download/{job_id}/{target_image_name}"
        hydrated_pages.append(hydrated_page)

    title = manifest_template.get("title")
    if not title and job_id in jobs and "original_filename" in jobs[job_id]:
        title = jobs[job_id]["original_filename"]

    hydrated_manifest = {
        "job_id": job_id,
        "title": title or "Untitled score",
        "page_count": manifest_template.get("page_count", len(hydrated_pages)),
        "pages": hydrated_pages,
        "musicxml_path": f"/api/download/{job_id}/{musicxml_path.name}",
        "measure_region_version": MEASURE_REGION_VERSION,
    }
    return _cache_manifest_for_job(job_id, hydrated_manifest)


def _normalize_manifest(manifest: Dict, job_id: str, musicxml_path: Optional[Path] = None) -> Dict:
    """Fill in missing fields for older cached page manifests."""
    job_dir = get_job_dir(job_id)
    normalized_pages = []
    needs_measure_regions = manifest.get("measure_region_version") != MEASURE_REGION_VERSION
    for page in manifest.get("pages", []):
        normalized_page = dict(page)
        # Extract filename from path (handles both old flat and new nested paths)
        image_path_str = normalized_page["image_path"]
        if "/" in image_path_str:
            image_name = image_path_str.split("/")[-1]
        else:
            image_name = image_path_str
        image_path = job_dir / image_name
        image_extension = image_path.suffix.lower()
        width = normalized_page.get("width")
        height = normalized_page.get("height")
        if image_extension == ".svg" and image_path.exists():
            _ensure_svg_is_renderer_friendly(image_path)
        if width is None or height is None:
            if image_extension == ".svg":
                width, height = _read_svg_dimensions(image_path)
            else:
                width, height = _read_png_dimensions(image_path)
        normalized_page["width"] = width
        normalized_page["height"] = height
        normalized_page["measure_regions"] = normalized_page.get("measure_regions", [])
        has_measure_indices = all(
            "measure_index" in region for region in normalized_page["measure_regions"]
        )
        needs_measure_regions = (
            needs_measure_regions
            or not normalized_page["measure_regions"]
            or not has_measure_indices
            or image_extension != ".svg"
        )
        # Ensure path uses new nested format
        normalized_page["image_path"] = f"/api/download/{job_id}/{image_name}"
        normalized_pages.append(normalized_page)

    if needs_measure_regions and musicxml_path and musicxml_path.exists():
        try:
            measure_regions_by_page = _build_measure_regions_by_page(musicxml_path)
            for page in normalized_pages:
                page["measure_regions"] = measure_regions_by_page.get(page["page_number"], page["measure_regions"])
        except Exception as exc:
            logger.warning("Failed to backfill measure regions for %s: %s", job_id, exc)

    manifest["pages"] = normalized_pages
    manifest["page_count"] = manifest.get("page_count", len(normalized_pages))
    manifest["measure_region_version"] = MEASURE_REGION_VERSION
    return manifest


def _render_pages_with_verovio(job_id: str, musicxml_path: Path) -> Dict:
    """Render MusicXML to paginated SVG score pages using Verovio."""
    job_dir = get_job_dir(job_id)

    toolkit = _create_verovio_toolkit(musicxml_path)

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
        svg = _inline_svg_path_strokes(toolkit.renderToSVG(page_number))
        svg_path = job_dir / f"{job_id}_page_{page_number}.svg"
        svg_path.write_text(svg)
        width, height = _read_svg_dimensions(svg_path)
        measure_regions = _extract_measure_regions_from_svg(svg, toolkit)
        pages.append(
            {
                "page_number": page_number,
                "image_path": f"/api/download/{job_id}/{svg_path.name}",
                "width": width,
                "height": height,
                "measure_regions": measure_regions,
            }
        )

    measure_index = 0
    for page in pages:
        for region in page["measure_regions"]:
            region["measure_index"] = measure_index
            measure_index += 1

    return {
        "job_id": job_id,
        "title": title,
        "page_count": len(pages),
        "pages": pages,
        "musicxml_path": f"/api/download/{job_id}/{musicxml_path.name}",
        "measure_region_version": MEASURE_REGION_VERSION,
    }


def render_score_pages(job_id: str, musicxml_path: Path) -> Dict:
    """Render and cache score pages for a MusicXML file."""
    job_dir = get_job_dir(job_id)
    manifest_path = job_dir / "manifest.json"

    if manifest_path.exists():
        existing_manifest = json.loads(manifest_path.read_text())
        has_png_pages = any(
            str(page.get("image_path", "")).lower().endswith(".png")
            for page in existing_manifest.get("pages", [])
        )
        if has_png_pages:
            manifest = _render_pages_with_verovio(job_id, musicxml_path)
            _cache_manifest_for_job(job_id, manifest)
        else:
            manifest = _normalize_manifest(existing_manifest, job_id, musicxml_path)
            _cache_manifest_for_job(job_id, manifest)
    else:
        manifest = _build_manifest_from_existing_pages(job_id, musicxml_path)
        if manifest is None:
            manifest = _render_pages_with_verovio(job_id, musicxml_path)
        _cache_manifest_for_job(job_id, manifest)

    return manifest


def warm_score_pages_cache(job_id: str, musicxml_path: Path):
    """Best-effort score-page rendering that never blocks the rest of a job."""
    try:
        render_score_pages(job_id, musicxml_path)
    except Exception as exc:
        logger.warning("Score page rendering failed for %s: %s", job_id, exc)


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
        warm_score_pages_cache(job_id, canonical_path)

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
        demo_asset_dir = get_hardcoded_score_asset_dir(file.filename)
        if demo_asset_dir is not None and demo_asset_dir.exists():
            hydrate_bundled_score_pages(job_id, mxl_path, demo_asset_dir)
        else:
            background_tasks.add_task(warm_score_pages_cache, job_id, mxl_path)
        background_tasks.add_task(run_audio_pipeline, job_id, mxl_path)

        return {"job_id": job_id, "status": "queued", "message": "Processing MusicXML file."}
    else:
        # PDF file - run full pipeline with Audiveris transcription
        pdf_path = job_dir / f"{job_id}.pdf"
        async with aiofiles.open(pdf_path, "wb") as out_file:
            await out_file.write(content)

        hardcoded_mxl_path = get_hardcoded_mxl_for_pdf(file.filename)
        if hardcoded_mxl_path is not None and not hardcoded_mxl_path.exists():
            raise HTTPException(
                status_code=500,
                detail=f"Hardcoded MusicXML file not found: {hardcoded_mxl_path}",
            )

        jobs[job_id] = {
            "status": "processing",
            "progress": {"transcription": "queued", "audio_conversion": "not_started"},
            "files": {"musicxml": None, "score_pages": None, "parts": []},
            "original_filename": original_filename,
        }

        if hardcoded_mxl_path is not None:
            canonical_mxl_path = job_dir / f"{job_id}.mxl"
            shutil.copyfile(hardcoded_mxl_path, canonical_mxl_path)
            jobs[job_id]["progress"]["transcription"] = "completed"
            jobs[job_id]["progress"]["audio_conversion"] = "queued"
            jobs[job_id]["files"]["musicxml"] = f"/api/download/{job_id}/{job_id}.mxl"

            demo_asset_dir = get_hardcoded_score_asset_dir(file.filename)
            if demo_asset_dir is not None and demo_asset_dir.exists():
                hydrate_bundled_score_pages(job_id, canonical_mxl_path, demo_asset_dir)

            logger.info(
                "Using hardcoded MusicXML for %s from %s",
                file.filename,
                hardcoded_mxl_path,
            )

            if jobs[job_id]["files"].get("score_pages") is None:
                background_tasks.add_task(warm_score_pages_cache, job_id, canonical_mxl_path)
            background_tasks.add_task(run_audio_pipeline, job_id, canonical_mxl_path)

            return {
                "job_id": job_id,
                "status": "queued",
                "message": "Using hardcoded MusicXML for this PDF.",
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
    cached_alignment = jobs.get(job_id, {}).get("alignment")
    cached_mappings = cached_alignment.get("mappings", []) if cached_alignment else []
    has_measure_indices = all("measure_index" in mapping for mapping in cached_mappings)
    has_current_version = cached_alignment.get("version") == ALIGNMENT_VERSION if cached_alignment else False

    if (
        job_id not in jobs
        or "alignment" not in jobs[job_id]
        or not has_measure_indices
        or not has_current_version
    ):
        job_dir = get_job_dir(job_id)
        mxl_path = job_dir / f"{job_id}.mxl"
        if mxl_path.exists():
            alignment = extract_alignment(mxl_path)
            if job_id in jobs:
                jobs[job_id]["alignment"] = alignment
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
    mxl_path = job_dir / f"{job_id}.mxl"
    manifest_path = job_dir / "manifest.json"
    if manifest_path.exists():
        manifest = _normalize_manifest(json.loads(manifest_path.read_text()), job_id, mxl_path)
        manifest_path.write_text(json.dumps(manifest, indent=2))
        return manifest

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
    elif filename.endswith(".svg"):
        media_type = "image/svg+xml"
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

            if message_type == "user_join":
                # Client sending their user info
                user_id = data.get("user_id")
                username = data.get("username")
                if user_id and username:
                    connection_manager.add_user_info(websocket, job_id, user_id, username)
                    logger.info(f"User {username} ({user_id}) joined job {job_id}")

                    # Broadcast user_joined to other clients
                    await connection_manager.broadcast(
                        job_id,
                        {
                            "type": "user_joined",
                            "user_id": user_id,
                            "username": username
                        },
                        exclude=websocket
                    )

                    # Send presence update to the joining user
                    present_users = connection_manager.get_present_users(job_id)
                    await websocket.send_json({
                        "type": "presence_update",
                        "users": present_users
                    })

            elif message_type == "annotation_added":
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
        user_info = connection_manager.disconnect(websocket, job_id)
        logger.info(f"WebSocket disconnected for job {job_id}")

        # Broadcast user_left if we have user info
        if user_info:
            await connection_manager.broadcast(
                job_id,
                {
                    "type": "user_left",
                    "user_id": user_info['user_id']
                }
            )
    except Exception as e:
        logger.error(f"WebSocket error for job {job_id}: {e}")
        user_info = connection_manager.disconnect(websocket, job_id)

        # Broadcast user_left if we have user info
        if user_info:
            await connection_manager.broadcast(
                job_id,
                {
                    "type": "user_left",
                    "user_id": user_info['user_id']
                }
            )


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
