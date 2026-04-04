"""
Annotation Service - Manages collaborative annotations on music scores.

Handles CRUD operations, persistence, and Yjs document synchronization for real-time collaboration.
"""
import json
import logging
import uuid
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime

from pydantic import BaseModel
import y_py as Y

logger = logging.getLogger(__name__)

# Base output directory
OUTPUT_DIR = Path("outputs")


# --- DATA MODELS ---


class PathData(BaseModel):
    """Freehand drawing path data"""
    points: List[Dict[str, float]]  # [{x: float, y: float}, ...]
    color: str
    strokeWidth: float
    opacity: float = 1.0


class TextData(BaseModel):
    """Text annotation data"""
    content: str
    position: Dict[str, float]  # {x: float, y: float}
    fontSize: float
    color: str


class ShapeData(BaseModel):
    """Shape annotation data"""
    shapeType: str  # "circle" | "rect" | "arrow"
    bounds: Dict[str, float]  # {x, y, width, height}
    color: str
    strokeWidth: float


class Annotation(BaseModel):
    """Complete annotation model"""
    id: str
    job_id: str
    page_number: int
    type: str  # "path" | "text" | "shape"
    user_id: str
    timestamp: float
    path: Optional[PathData] = None
    text: Optional[TextData] = None
    shape: Optional[ShapeData] = None


class AnnotationStore:
    """Manages annotations with persistence and Yjs synchronization"""

    def __init__(self):
        # In-memory storage: {job_id: {annotation_id: Annotation}}
        self.annotations: Dict[str, Dict[str, Annotation]] = {}

        # Yjs documents: {job_id: Y.YDoc}
        self.yjs_docs: Dict[str, Y.YDoc] = {}

    def get_yjs_doc(self, job_id: str) -> Y.YDoc:
        """Get or create Yjs document for a job"""
        if job_id not in self.yjs_docs:
            self.yjs_docs[job_id] = Y.YDoc()
            # Load existing annotations into Yjs doc
            self._load_annotations(job_id)
        return self.yjs_docs[job_id]

    def _get_annotation_file(self, job_id: str) -> Path:
        """Get path to annotation JSON file"""
        job_dir = OUTPUT_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        return job_dir / "annotations.json"

    def _load_annotations(self, job_id: str):
        """Load annotations from disk into memory and Yjs"""
        annotation_file = self._get_annotation_file(job_id)

        if not annotation_file.exists():
            self.annotations[job_id] = {}
            return

        try:
            with open(annotation_file, "r") as f:
                data = json.load(f)
                annotations_dict = {}

                for ann_data in data.get("annotations", []):
                    annotation = Annotation(**ann_data)
                    annotations_dict[annotation.id] = annotation

                self.annotations[job_id] = annotations_dict
                logger.info(f"Loaded {len(annotations_dict)} annotations for job {job_id}")

                # Sync to Yjs document
                if job_id in self.yjs_docs:
                    with self.yjs_docs[job_id].begin_transaction() as txn:
                        ymap = self.yjs_docs[job_id].get_map("annotations")
                        for ann_id, annotation in annotations_dict.items():
                            ymap.set(txn, ann_id, annotation.model_dump())

        except Exception as e:
            logger.error(f"Failed to load annotations for {job_id}: {e}")
            self.annotations[job_id] = {}

    def _save_annotations(self, job_id: str):
        """Persist annotations to disk"""
        if job_id not in self.annotations:
            return

        annotation_file = self._get_annotation_file(job_id)

        try:
            data = {
                "job_id": job_id,
                "annotations": [ann.model_dump() for ann in self.annotations[job_id].values()]
            }

            with open(annotation_file, "w") as f:
                json.dump(data, f, indent=2)

            logger.info(f"Saved {len(self.annotations[job_id])} annotations for job {job_id}")
        except Exception as e:
            logger.error(f"Failed to save annotations for {job_id}: {e}")

    def get_all(self, job_id: str) -> List[Annotation]:
        """Get all annotations for a job"""
        if job_id not in self.annotations:
            self._load_annotations(job_id)

        return list(self.annotations.get(job_id, {}).values())

    def get_by_id(self, job_id: str, annotation_id: str) -> Optional[Annotation]:
        """Get specific annotation by ID"""
        if job_id not in self.annotations:
            self._load_annotations(job_id)

        return self.annotations.get(job_id, {}).get(annotation_id)

    def create(self, annotation: Annotation) -> Annotation:
        """Create new annotation"""
        job_id = annotation.job_id

        if job_id not in self.annotations:
            self._load_annotations(job_id)

        # Ensure ID is set
        if not annotation.id:
            annotation.id = str(uuid.uuid4())

        # Set timestamp
        annotation.timestamp = datetime.now().timestamp()

        # Store in memory
        if job_id not in self.annotations:
            self.annotations[job_id] = {}

        self.annotations[job_id][annotation.id] = annotation

        # Update Yjs document
        if job_id in self.yjs_docs:
            with self.yjs_docs[job_id].begin_transaction() as txn:
                ymap = self.yjs_docs[job_id].get_map("annotations")
                ymap.set(txn, annotation.id, annotation.model_dump())

        # Persist to disk
        self._save_annotations(job_id)

        logger.info(f"Created annotation {annotation.id} for job {job_id}")
        return annotation

    def update(self, annotation: Annotation) -> Optional[Annotation]:
        """Update existing annotation"""
        job_id = annotation.job_id

        if job_id not in self.annotations:
            self._load_annotations(job_id)

        if annotation.id not in self.annotations.get(job_id, {}):
            logger.warning(f"Annotation {annotation.id} not found for update")
            return None

        # Update in memory
        self.annotations[job_id][annotation.id] = annotation

        # Update Yjs document
        if job_id in self.yjs_docs:
            with self.yjs_docs[job_id].begin_transaction() as txn:
                ymap = self.yjs_docs[job_id].get_map("annotations")
                ymap.set(txn, annotation.id, annotation.model_dump())

        # Persist to disk
        self._save_annotations(job_id)

        logger.info(f"Updated annotation {annotation.id} for job {job_id}")
        return annotation

    def delete(self, job_id: str, annotation_id: str) -> bool:
        """Delete annotation"""
        if job_id not in self.annotations:
            self._load_annotations(job_id)

        if annotation_id not in self.annotations.get(job_id, {}):
            logger.warning(f"Annotation {annotation_id} not found for deletion")
            return False

        # Remove from memory
        del self.annotations[job_id][annotation_id]

        # Remove from Yjs document
        if job_id in self.yjs_docs:
            with self.yjs_docs[job_id].begin_transaction() as txn:
                ymap = self.yjs_docs[job_id].get_map("annotations")
                ymap.pop(txn, annotation_id)

        # Persist to disk
        self._save_annotations(job_id)

        logger.info(f"Deleted annotation {annotation_id} for job {job_id}")
        return True

    def get_yjs_state_vector(self, job_id: str) -> bytes:
        """Get Yjs state vector for synchronization"""
        doc = self.get_yjs_doc(job_id)
        return Y.encode_state_vector(doc)

    def apply_yjs_update(self, job_id: str, update: bytes):
        """Apply Yjs update from client"""
        doc = self.get_yjs_doc(job_id)
        Y.apply_update(doc, update)

        # Sync Yjs changes back to our annotation store
        with doc.begin_transaction() as txn:
            ymap = doc.get_map("annotations")

            # Rebuild annotations from Yjs state
            if job_id not in self.annotations:
                self.annotations[job_id] = {}

            # Get all current annotations from Yjs
            yjs_annotations = {}
            for key in ymap.keys():
                value = ymap.get(txn, key)
                if value:
                    try:
                        ann = Annotation(**value)
                        yjs_annotations[key] = ann
                    except Exception as e:
                        logger.error(f"Failed to parse annotation from Yjs: {e}")

            # Update our store
            self.annotations[job_id] = yjs_annotations

        # Persist changes
        self._save_annotations(job_id)


# Global annotation store instance
annotation_store = AnnotationStore()
