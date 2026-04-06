"""
Audiveris OMR Service Wrapper
Handles PDF to MusicXML conversion using Audiveris
"""
import os
import subprocess
from pathlib import Path
from typing import Optional, List
import logging
from music21 import converter, stream

logger = logging.getLogger(__name__)

class AudiverisService:
    """Wrapper for Audiveris OMR engine"""

    def __init__(self, audiveris_path: Optional[str] = None):
        """
        Initialize Audiveris service

        Args:
            audiveris_path: Path to Audiveris executable or JAR file
        """
        # Check if we're running in Docker
        self.in_docker = os.path.exists('/.dockerenv') or os.path.exists('/var/run/docker.sock')

        if self.in_docker:
            # Inside Docker, we'll use the 'docker exec' approach, so we don't
            # necessarily need a local path to the executable.
            self.audiveris_path = audiveris_path or "docker-exec"
            return

        # Try different possible locations
        possible_paths = [
            audiveris_path,
            "/Applications/Audiveris.app/Contents/MacOS/Audiveris",  # Mac DMG install
            "/audiveris/audiveris.jar",  # Docker container
            "audiveris/audiveris.jar",  # Local relative path
        ]

        self.audiveris_path = None
        for path in possible_paths:
            if path and Path(path).exists():
                self.audiveris_path = path
                break

        if not self.audiveris_path:
            raise FileNotFoundError(
                "Audiveris not found. Please install Audiveris or set AUDIVERIS_PATH environment variable."
            )

    def transcribe_pdf(self, pdf_path: str, output_dir: str) -> str:
        """
        Convert PDF to MusicXML using Audiveris

        Args:
            pdf_path: Path to input PDF file
            output_dir: Directory to save output MusicXML

        Returns:
            Path to generated MusicXML file
        """
        pdf_path = Path(pdf_path).resolve()
        output_dir = Path(output_dir).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)

        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        if self.in_docker:
            # Running inside Docker - call Audiveris container via docker exec
            # Convert host paths (/app/cloud/job-id/file.pdf) to Audiveris container paths
            cwd = Path.cwd().resolve()
            relative_pdf = pdf_path.relative_to(cwd)
            relative_output = output_dir.relative_to(cwd)
            container_pdf = f"/audiveris/{relative_pdf}"
            container_output = f"/audiveris/{relative_output}"

            cmd = [
                'docker', 'exec',
                '-e', 'JAVA_OPTS=-Xmx4g',
                'scorely-audiveris',
                'audiveris',
                '-batch',
                '-export',
                container_pdf,
                '-output',
                container_output
            ]
        elif str(self.audiveris_path).endswith('.jar'):
            # Local JAR file
            cmd = [
                'java',
                '-jar',
                str(self.audiveris_path),
                '-batch',
                '-export',
                str(pdf_path),
                '-output',
                str(output_dir)
            ]
        else:
            # Mac app executable
            cmd = [
                str(self.audiveris_path),
                '-batch',
                '-export',
                str(pdf_path),
                '-output',
                str(output_dir)
            ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600  # 10 minute timeout
            )

            if result.returncode != 0:
                raise RuntimeError(
                    f"Audiveris failed: {result.stderr}"
                )

            # Search for generated .mxl files
            # Audiveris might create file.mxl OR file.mvt1.mxl, file.mvt2.mxl, etc.
            mxl_files = sorted(list(output_dir.glob(f"{pdf_path.stem}*.mxl")))
            
            if not mxl_files:
                # Fallback: search for any .mxl if stem-based search fails
                mxl_files = sorted(list(output_dir.glob("*.mxl")))
                
            if not mxl_files:
                raise FileNotFoundError(f"No MusicXML output found in {output_dir}")

            # If multiple movements, combine them
            if len(mxl_files) > 1:
                logger.info(f"Combining {len(mxl_files)} movements for {pdf_path.name}")
                combined_score = self._combine_mxl_files(mxl_files)
                final_mxl = output_dir / f"{pdf_path.stem}.mxl"
                combined_score.write('musicxml', fp=str(final_mxl))
                return str(final_mxl)
            
            return str(mxl_files[0])

        except subprocess.TimeoutExpired:
            raise TimeoutError(
                "Audiveris processing timed out (>10 minutes)"
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to run Audiveris: {str(e)}"
            )

    def _combine_mxl_files(self, mxl_paths: List[Path]) -> stream.Score:
        """Combines multiple MusicXML files into a single Score object."""
        if not mxl_paths:
            return stream.Score()
            
        combined_score = converter.parse(str(mxl_paths[0]))
        
        for mxl_path in mxl_paths[1:]:
            next_score = converter.parse(str(mxl_path))
            
            # Match parts by index and append measures
            for i, part in enumerate(next_score.parts):
                if i < len(combined_score.parts):
                    # Append all measures from this movement to the combined part
                    for measure in part.getElementsByClass('Measure'):
                        combined_score.parts[i].append(measure)
                else:
                    logger.warning(f"Movement {mxl_path.name} has more parts ({i+1}) than the first movement.")
                    
        return combined_score

    def _combine_mxl_files(self, mxl_paths: List[Path]) -> stream.Score:
        """Combines multiple MusicXML files into a single Score object."""
        if not mxl_paths:
            return stream.Score()
            
        combined_score = converter.parse(str(mxl_paths[0]))
        
        for mxl_path in mxl_paths[1:]:
            next_score = converter.parse(str(mxl_path))
            
            # Match parts by index and append measures
            for i, part in enumerate(next_score.parts):
                if i < len(combined_score.parts):
                    # Append all measures from this movement to the combined part
                    for measure in part.getElementsByClass('Measure'):
                        combined_score.parts[i].append(measure)
                else:
                    logger.warning(f"Movement {mxl_path.name} has more parts ({i+1}) than the first movement.")
                    
        return combined_score


# Singleton instance
_audiveris_service = None

def get_audiveris_service() -> AudiverisService:
    """Get or create Audiveris service instance"""
    global _audiveris_service
    if _audiveris_service is None:
        audiveris_path = os.getenv('AUDIVERIS_PATH')
        try:
            _audiveris_service = AudiverisService(audiveris_path)
        except FileNotFoundError:
            # Audiveris not available - will use placeholder
            _audiveris_service = None
    return _audiveris_service
