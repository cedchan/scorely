import os
import sys
import logging
from pathlib import Path
from audiveris_service import AudiverisService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_single_file_transcription():
    pdf_path = "/Users/cedricc/Documents/Penn/CIS-5120/scorely/backend/uploads/f1fa1f13-010d-4cc9-a253-e22f5ac282bc.pdf"
    output_dir = "/Users/cedricc/Documents/Penn/CIS-5120/scorely/backend/outputs/test_result"
    
    # Ensure output dir exists and is clean
    output_path = Path(output_dir)
    if output_path.exists():
        import shutil
        shutil.rmtree(output_path)
    output_path.mkdir(parents=True)

    print(f"Testing transcription for: {pdf_path}")
    print(f"Output directory: {output_dir}")

    try:
        # Initialize service (it will use Docker if detected or local path)
        service = AudiverisService()
        
        # Run transcription
        result_path = service.transcribe_pdf(pdf_path, output_dir)
        
        print(f"\nTranscription successful!")
        print(f"Result path: {result_path}")
        
        # Check for multiple files
        mxl_files = list(output_path.glob("*.mxl"))
        print(f"Total .mxl files generated: {len(mxl_files)}")
        for f in mxl_files:
            print(f" - {f.name}")
            
        if len(mxl_files) == 1:
            print("\nSUCCESS: Only one MusicXML file was generated (movements combined).")
        else:
            print(f"\nFAILURE: Expected 1 file, but found {len(mxl_files)}.")

    except Exception as e:
        print(f"\nError during test: {e}")

if __name__ == "__main__":
    test_single_file_transcription()
