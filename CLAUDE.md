# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scorely - An iPad app for reading and rehearsing chamber music, built with React Native (Expo). CIS-5120 project at Penn.

## Repository Structure

- `hello-world/` - React Native demo app showcasing the style guide
  - `App.js` - Single-page app displaying "Hello World" and complete style guide
  - `screens/` - Unused (originally for navigation demo)
- **Main App** (root directory):
  - `App.js` - Main application with navigation
  - `screens/` - Application screens
    - `UploadScreen.js` - PDF upload interface
    - `PlayerScreen.js` - Music display and playback interface
  - `assets/` - App icons and images
  - `app.json` - Expo configuration
- **Backend** (`backend/`):
  - `main.py` - FastAPI server with transcription endpoints
  - `requirements.txt` - Python dependencies
  - `test_api.py` - Test script for local API testing
  - `uploads/` - Temporary PDF storage
  - `outputs/` - Generated MusicXML and MIDI files
  - `README.md` - Backend setup and API documentation

## Style Guide

The app follows a consistent design system:

### Colors
- **Beige (Primary Background)**: `#FAF7F0`
- **Light Brown (Secondary)**: `#A9988F`
- **Dark Brown (Primary Text/Accents)**: `#58392F`

### Typography
- **Font Family**: Afacad Regular (`@expo-google-fonts/afacad`)
- Use `Afacad_400Regular` for all text elements
- Common sizes: 32px (large headings), 24px (medium headings), 18px (body), 14px (small)

### Icons
- **Icon Library**: FontAwesome (`@fortawesome/react-native-fontawesome`)
- Import from `@fortawesome/free-solid-svg-icons` and `@fortawesome/free-regular-svg-icons`
- Default icon color: Dark Brown (`#58392F`)
- Relevant music icons: faMusic, faGuitar, faDrum, faHeadphones

## Development Commands

### Docker Setup (Recommended for Teams)
```bash
# One-time setup: Install Audiveris DMG or place JAR in backend/audiveris/
# See DOCKER_SETUP.md for detailed instructions

docker-compose up --build         # Start all services
# API available at http://localhost:8000
# API docs at http://localhost:8000/docs

docker-compose down               # Stop services
docker-compose logs -f api        # View logs
```

### Backend API (Local Development)
```bash
cd backend
python3 -m venv venv              # Create virtual environment
source venv/bin/activate          # Activate (macOS/Linux)
pip install -r requirements.txt   # Install dependencies

# Install Audiveris first (DMG or JAR)
export AUDIVERIS_PATH=/Applications/Audiveris.app/Contents/MacOS/Audiveris

uvicorn main:app --reload --port 8000  # Start API server

# Test the API
python test_api.py                # Run test script
# or visit http://localhost:8000/docs for Swagger UI
```

### Main App
```bash
npm start          # Start Expo dev server
npm run ios        # Run on iOS simulator (iPad recommended)
npm run android    # Run on Android emulator
npm run web        # Run in web browser
```

### Hello World Demo App
```bash
cd hello-world
npm start          # Start Expo dev server
npm run ios        # Run on iOS simulator
npm run android    # Run on Android emulator
npm run web        # Run in web browser
```

## Key Dependencies

- **React Navigation**: `@react-navigation/native`, `@react-navigation/native-stack` - Screen navigation
- **FontAwesome**: `@fortawesome/react-native-fontawesome` with icon packages - Icons
- **Fonts**: `expo-font`, `@expo-google-fonts/afacad` - Custom typography
- **Document Picker**: `expo-document-picker` - PDF file selection
- **Expo**: Built on Expo for simplified React Native development

## System Architecture

### 📱 React Native App (Frontend)
- **UI + Rendering**: Display musical scores using MusicXML
- **MIDI Playback**: Audio playback of transcribed scores
- **Gesture Detection**: Touch interactions for annotations and navigation
- **Realtime Annotations**: Shared annotations using Firebase/Supabase

### ☁️ Python Backend (FastAPI)
- **PDF → OMR**: Optical Music Recognition using Audiveris (planned integration)
- **MusicXML Output**: Convert sheet music PDFs to MusicXML format
- **MIDI Generation**: Generate MIDI files from MusicXML using music21
- **File Storage**: Manage uploaded PDFs and generated files
- **API Endpoints**:
  - `POST /api/transcribe` - Upload PDF for transcription
  - `POST /api/convert-to-midi` - Convert MusicXML to MIDI
  - `GET /api/download/{filename}` - Download generated files
  - `GET /api/status/{job_id}` - Check job status

### 🗄️ Realtime Backend
- **Firebase / Supabase**: Realtime database for collaborative features
- **Shared Annotations**: Sync annotations and markings across users

## Architecture Notes

### Font Loading
- Fonts must be loaded using `useFonts` hook from `@expo-google-fonts/afacad`
- Component should return `null` until fonts are loaded
- Always specify `fontFamily: 'Afacad_400Regular'` in styles

### Styling Approach
- StyleSheet.create for all component styles
- Define color constants for consistency
- Use flexbox for layouts
- ScrollView for content that may overflow screen height
