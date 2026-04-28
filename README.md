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
- Homebrew (macOS) - for installing mkcert

Then, to launch the app, run `./start.sh` from the root directory. Note that this script was written for Mac.

**First-time setup:** The script will automatically install `mkcert` via Homebrew and generate local SSL certificates for HTTPS support. This enables secure connections needed for camera access on iPad.

The app will be available at:
- **Web app (local HTTP):** http://localhost:8081
- **Web app (HTTPS for iPad):** https://YOUR_LOCAL_IP
- **API docs:** https://YOUR_LOCAL_IP/docs

### For iPad Testing (Camera/Nod Detection)

The app uses HTTPS via nginx reverse proxy with mkcert certificates. To test on iPad:

1. Run `./start.sh` (certificates auto-generated for your local IP)
2. On iPad Safari, navigate to `https://YOUR_LOCAL_IP` (port 443, not 8081!)
3. Accept the certificate warning **once** (covers both app and API)
4. Camera features work immediately!

**How it works:** Nginx provides HTTPS on port 443, proxying to both the Expo dev server (port 8081) and API (port 8443). Single certificate = single acceptance!

**Alternative:** If you need remote access outside your local network, use `ENABLE_TUNNELS=1 ./start.sh` to create public HTTPS tunnels via localtunnel (less stable, only use if necessary).

### For iPad Testing In Expo Go

Expo Go can load the native app over LAN, but the API endpoint needs to be reachable from the iPad too.

1. Start the backend stack so the API is available on your Mac:
   `PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" /Applications/Docker.app/Contents/Resources/bin/docker compose up --build -d`
2. Start Expo:
   `npx expo start --host lan`
3. Open the project in Expo Go on the iPad.

If Expo Go can open the app but API requests fail, create a local `.env.local` file with an explicit API URL before starting Expo:

```env
EXPO_PUBLIC_API_BASE_URL=https://YOUR_MAC_IP:8443
```

If the iPad still rejects the local HTTPS certificate, point `EXPO_PUBLIC_API_BASE_URL` at a trusted HTTPS tunnel instead of the LAN URL. Expo automatically inlines `EXPO_PUBLIC_*` variables during `npx expo start`, so reloading Expo Go will pick up the new API target.

## Demo overview by requirement

To get a gist of the app, you may want to look at requirements 5 and 6 before 3 and 4. 

### 1. and 2. Hello World app / Hello Styles

Run the standalone Expo app in `hello-world/` (a simple `npm start` suffices).

### 3. Cross-device networking

1. Open the launnched app on multiple browser tabs or multiple devices.
2. To get shared annotations, first upload a file on one device, then hit the share icon in the top right corner. This will give you a code.
3. Press the "Join Shared Score" option in the home screen of your second device and type in the code from step (2). This will open the score on the second device. Now you can annotate on either and it will be synced up.

### 4. Gesture detection

To test on an iPad, navigate to `https://YOUR_LOCAL_IP` in Safari (requires HTTPS for camera access). In any score, select the "Nod to Turn Page" button in the top right and grant camera permissions. To turn one page forward, nod vigorously once.

**Note:** Accept the certificate warning once when prompted - this covers both the app and API. 

### 5. Sheet music transcription/display

Use the main app to upload either:

- `demo-files/cello1.pdf` for PDF transcription
- `demo-files/String Quartet in A minor, Op.2548 (Beatty, Stephen W.).mxl` for direct MusicXML/MXL ingest (works cleaner)

Then open the generated paginated score and scroll/page through it.

### 6. Sheet music playback

After a score is processed, use the player screen’s play button to demonstrate generated audio playback. This can take some time to generate.
