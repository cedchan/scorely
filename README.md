# Scorely

Scorely is a React Native / Expo project for collaborative sheet-music practice. This repository contains:

- `hello-world/`: a small Expo demo app for the "Hello World" and style-guide requirements
- the main app in the repo root: upload/transcription, score display, playback, annotations, and nod-based page turning
- `backend/`: the FastAPI + Audiveris + audio-conversion backend
- `demo-files/`: sample `.pdf` and `.mxl` scores to use during demos

## Repository layout

- `hello-world/`
  A focused Expo app for requirements 1 and 2.
- `demo-files/`
  Sample files for upload demos:
  `demo-files/cello1.pdf`
  `demo-files/String Quartet in A minor, Op.2548 (Beatty, Stephen W.).mxl`
- `backend/`
  FastAPI backend, Audiveris integration, score rendering, and audio generation.
- `start.sh`
  Convenience script to launch Docker, the Expo web app, and optional HTTPS tunnels for iPad Safari.

## Prerequisites

For the full app demo:

- Docker Desktop
- Node.js + npm

For the `hello-world/` demo:

- Node.js + npm

## Demo overview by requirement

### 1. Hello World app

Run the standalone Expo app in `hello-world/` and show the opening screen on an iPad.

### 2. Hello styles

Use the second screen in `hello-world/` to show:

- the required colors `#FAF7F0`, `#A9988F`, `#58392F`
- the Afacad regular font
- FontAwesome icons

### 3. Cross-device networking

Use the main app to open the same score on two devices and draw annotations on one device. The other device should receive the shared notes in real time.

### 4. Custom gesture detection

Use the main app on iPad Safari over HTTPS, enable `Nod to Turn Page`, then show that a nod advances the score.

### 5. Sheet music transcription/display

Use the main app to upload:

- `demo-files/cello1.pdf` for PDF transcription
- `demo-files/String Quartet in A minor, Op.2548 (Beatty, Stephen W.).mxl` for direct MusicXML/MXL ingest

Then open the generated paginated score and scroll/page through it.

### 6. Sheet music playback

After a score is processed, use the player screen’s play button to demonstrate generated audio playback.

## Running the Hello World / Hello Styles demo

This demo is self-contained in `hello-world/`.

```bash
cd hello-world
npm install
npx expo start
```

Suggested demo flow:

1. Open the Expo app on your target device.
2. Show the opening `Hello World` screen.
3. Navigate to the styles screen.
4. Show the required colors, Afacad text samples, and FontAwesome icons.

## Running the main Scorely demo locally

From the repository root:

```bash
./start.sh
```

This script will:

- rebuild and start Docker services for the backend
- wait for the API on port `8000`
- install/update frontend dependencies
- start the Expo web app on port `8081`

When startup finishes, it prints:

- local app URL
- LAN app URL
- LAN API URL
- API docs URL

Typical local URLs:

- App: `http://localhost:8081`
- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

To stop Docker later:

```bash
PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" \
/Applications/Docker.app/Contents/Resources/bin/docker compose down
```

## Running the main Scorely demo on an iPad

For iPad Safari, camera access for nod detection requires a secure context. A plain LAN URL like `http://192.168.x.x:8081` is not sufficient for `getUserMedia`.

Use the built-in tunnel mode:

```bash
ENABLE_TUNNELS=1 ./start.sh
```

This does everything from the local startup flow, then additionally:

- starts a localtunnel HTTPS URL for the Expo web app
- starts a localtunnel HTTPS URL for the backend API
- prints a single HTTPS app URL in this form:

```text
https://<frontend>.loca.lt/?api=https%3A%2F%2F<backend>.loca.lt
```

Open that exact full HTTPS app URL on the iPad.

### Important iPad note

Use the tunneled HTTPS app URL for:

- camera / nod detection
- uploads from Safari
- any demo where the app must reach the backend from outside your laptop

If you open an old or non-HTTPS URL, you may see:

- camera access failures
- uploads posting to the wrong backend host
- stale cached frontend bundles

If Safari seems stuck on an older version:

1. close the old tab
2. reopen the newly printed HTTPS app URL
3. if needed, remove `loca.lt` site data in Safari settings and retry

## Demo script for the main app

### A. Upload + transcription + display

1. Start the app with either:
   `./start.sh`
   or
   `ENABLE_TUNNELS=1 ./start.sh`
2. Open the app.
3. Tap `Upload New Piece`.
4. Choose one of:
   `demo-files/cello1.pdf`
   `demo-files/String Quartet in A minor, Op.2548 (Beatty, Stephen W.).mxl`
5. Wait for processing to finish.
6. Show the generated paginated score in the player screen.

Notes:

- the PDF path demonstrates transcription via Audiveris
- the MXL path demonstrates direct ingest of already-electronic sheet music

### B. Playback

1. Open a processed score in the player screen.
2. Wait for audio generation to complete.
3. Tap the play button in the header.
4. Demonstrate generated playback.

### C. Cross-device annotations

1. Open the same score on two devices.
2. Enable annotations.
3. Draw handwritten notes on device A.
4. Show that device B receives the updates in real time.

### D. Nod-based page turning

Best on iPad Safari using the HTTPS tunnel URL.

1. Open a score in the player.
2. Tap `Nod to Turn Page`.
3. Allow camera access in Safari.
4. Nod to trigger the next page.

## Manual commands

If you want to run pieces manually instead of `start.sh`:

### Backend only

```bash
PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" \
/Applications/Docker.app/Contents/Resources/bin/docker compose up --build -d
```

### Frontend only

```bash
npm install
npx expo start --web --host lan --clear
```

### Logs

```bash
PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" \
/Applications/Docker.app/Contents/Resources/bin/docker compose logs -f
```

### API docs

Open:

```text
http://localhost:8000/docs
```

## Troubleshooting

### Upload fails on iPad

Make sure you are using the tunneled HTTPS app URL printed by:

```bash
ENABLE_TUNNELS=1 ./start.sh
```

Do not use a plain `http://192.168...` app URL for Safari upload/camera demos.

### Nod detection says camera is unsupported

This usually means the app is running on an insecure origin. Use the HTTPS tunneled URL, not the LAN HTTP URL.

### Docker command not found

On macOS, this repo’s scripts use Docker Desktop from:

```text
/Applications/Docker.app/Contents/Resources/bin/docker
```

So make sure Docker Desktop is installed and running.

### Expo starts but the iPad still shows an older build

Close the old Safari tab and reopen the latest HTTPS tunnel URL. If the issue persists, clear the saved `loca.lt` website data on the iPad and try again.
