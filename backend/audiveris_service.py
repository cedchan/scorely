"""
Audiveris OMR Service Wrapper
Handles PDF to MusicXML conversion using Audiveris
"""
import os
import subprocess
from pathlib import Path
from typing import Optional

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
        pdf_path = Path(pdf_path)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        if self.in_docker:
            # Running inside Docker - call Audiveris container via docker exec
            # Convert paths to container paths
            container_pdf = f"/audiveris/input/{pdf_path.name}"
            container_output = "/audiveris/output"

            cmd = [
                'docker', 'exec', 'scorely-audiveris',
                'audiveris',  # wrapper script we created
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
                timeout=300  # 5 minute timeout
            )

            if result.returncode != 0:
                raise RuntimeError(
                    f"Audiveris failed: {result.stderr}"
                )

            # Find the generated MusicXML file for this specific upload.
            # Audiveris sometimes exports `<stem>.mxl`, and other times it exports
            # movement files such as `<stem>.mvt1.mxl`, `<stem>.mvt2.mxl`, etc.
            expected_output = output_dir / f"{pdf_path.stem}.mxl"

            if expected_output.exists():
                return str(expected_output)

            matching_mxl_files = sorted(output_dir.glob(f"{pdf_path.stem}*.mxl"))
            if matching_mxl_files:
                return str(matching_mxl_files[0])

            raise FileNotFoundError(
                f"No MusicXML output found for {pdf_path.stem} in {output_dir}"
            )

        except subprocess.TimeoutExpired:
            raise TimeoutError(
                "Audiveris processing timed out (>5 minutes)"
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to run Audiveris: {str(e)}"
            )


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
