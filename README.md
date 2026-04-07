# Scorely

Scorely is a React Native / Expo project for collaborative sheet-music practice. This repository contains:

- `hello-world/`: a small Expo demo app for the "Hello World" and style-guide requirements
- the main app in the repo root: upload/transcription, score display, playback, annotations, and nod-based page turning
- `backend/`: the FastAPI + Audiveris + audio-conversion backend
- `demo-files/`: sample `.pdf` and `.mxl` scores to use during demos

## Quickstart

Prerequisites:
- Docker Desktop
- Node.js + npm

Then, to launch the app, run `ENABLE_TUNNELS=1 ./start.sh` from the root directory. Note that this script was written for Mac.

This will launch the main app both locally and via a tunnel. You should use the local version for most requirements/testing. The tunnel version is **only** necessary for testing nod-to-turn-page on an iPad (camera use requires an HTTPS connection).

## Demo overview by requirement

To get a gist of the app, you may want to look at requirements 5 and 6 before 3 and 4. 

### 1. and 2. Hello World app / Hello Styles

Run the standalone Expo app in `hello-world/` (a simple `npm start` suffices).

### 3. Cross-device networking

1. Open the launnched app on multiple browser tabs or multiple devices.
2. To get shared annotations, first upload a file on one device, then hit the share icon in the top right corner. This will give you a code.
3. Press the "Join Shared Score" option in the home screen of your second device and type in the code from step (2). This will open the score on the second device. Now you can annotate on either and it will be synced up.

### 4. Gesture detection

To test on an iPad, you must use the tunnel link rather than the normal local version (if just testing on a laptop, the local link is fine and more stable). In any score select the "Nod to Turn Page" button in the top right and grant camera permissions. To turn one page forward nod vigorously once. 

Note that you have to open both the links for the API and for the app itself in your browser and paste in the IP address as requested in order for this to work. 

### 5. Sheet music transcription/display

Use the main app to upload either:

- `demo-files/cello1.pdf` for PDF transcription
- `demo-files/String Quartet in A minor, Op.2548 (Beatty, Stephen W.).mxl` for direct MusicXML/MXL ingest (works cleaner)

Then open the generated paginated score and scroll/page through it.

### 6. Sheet music playback

After a score is processed, use the player screen’s play button to demonstrate generated audio playback. This can take some time to generate.