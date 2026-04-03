"""
Test script for Scorely API
Run this to test the API endpoints locally
"""
import requests
import json
from pathlib import Path

# API base URL
BASE_URL = "http://localhost:8000"

def test_health_check():
    """Test the health check endpoint"""
    print("\n=== Testing Health Check ===")
    response = requests.get(f"{BASE_URL}/")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    return response.status_code == 200

def test_upload_pdf(pdf_path):
    """Test PDF upload and transcription"""
    print(f"\n=== Testing PDF Upload ===")
    print(f"Uploading: {pdf_path}")

    if not Path(pdf_path).exists():
        print(f"Error: File not found at {pdf_path}")
        print("Please provide a valid PDF path")
        return None

    with open(pdf_path, 'rb') as f:
        files = {'file': (Path(pdf_path).name, f, 'application/pdf')}
        response = requests.post(f"{BASE_URL}/api/transcribe", files=files)

    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")

    if response.status_code == 200:
        return response.json()
    return None

def test_convert_to_midi(musicxml_path):
    """Test MusicXML to MIDI conversion"""
    print(f"\n=== Testing MusicXML to MIDI Conversion ===")
    print(f"Converting: {musicxml_path}")

    payload = {"musicxml_path": musicxml_path}
    response = requests.post(
        f"{BASE_URL}/api/convert-to-midi",
        json=payload
    )

    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")

    if response.status_code == 200:
        return response.json()
    return None

def test_download_file(filename):
    """Test file download"""
    print(f"\n=== Testing File Download ===")
    print(f"Downloading: {filename}")

    response = requests.get(f"{BASE_URL}/api/download/{filename}")
    print(f"Status: {response.status_code}")

    if response.status_code == 200:
        output_path = f"test_output_{filename}"
        with open(output_path, 'wb') as f:
            f.write(response.content)
        print(f"File saved to: {output_path}")
        return True
    else:
        print(f"Error: {response.text}")
        return False

def test_job_status(job_id):
    """Test job status check"""
    print(f"\n=== Testing Job Status ===")
    print(f"Job ID: {job_id}")

    response = requests.get(f"{BASE_URL}/api/status/{job_id}")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")

    return response.status_code == 200

def main():
    """Run all tests"""
    print("=" * 60)
    print("Scorely API Test Suite")
    print("=" * 60)
    print("\nMake sure the API server is running:")
    print("  cd backend")
    print("  uvicorn main:app --reload --port 8000")
    print("=" * 60)

    # Test 1: Health check
    if not test_health_check():
        print("\n❌ Health check failed. Is the server running?")
        return

    print("\n✅ Health check passed")

    # Test 2: Upload PDF
    print("\n" + "=" * 60)
    print("To test PDF upload, you need a sample PDF file.")
    print("Example usage:")
    print('  result = test_upload_pdf("path/to/your/sheet_music.pdf")')
    print("=" * 60)

    # Example with a sample path (user should modify this)
    # Uncomment and modify the path below to test:
    # result = test_upload_pdf("/path/to/sample.pdf")
    # if result:
    #     job_id = result.get('job_id')
    #     test_job_status(job_id)

    print("\n✅ API is ready for testing!")
    print("\nNext steps:")
    print("1. Place a PDF file in a known location")
    print("2. Modify this script to test with your PDF")
    print("3. Or use curl/Postman to test the endpoints")

if __name__ == "__main__":
    try:
        main()
    except requests.exceptions.ConnectionError:
        print("\n❌ Could not connect to the API server.")
        print("Make sure it's running with: uvicorn main:app --reload --port 8000")
    except Exception as e:
        print(f"\n❌ Error: {e}")
