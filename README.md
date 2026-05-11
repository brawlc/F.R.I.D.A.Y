<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/bac3a480-e6fc-43a5-98ce-cd3cd460b06a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Desktop Voice Mode

FRIDAY now supports audible replies and microphone input in browsers with the Web Speech API, such as Chrome or Edge.

- Click the microphone button, allow microphone access, then say: `Friday status`
- Double-clap wake is enabled by default. Press the mic once to arm it, clap twice, then speak your command. After activation, FRIDAY stays in hands-free conversation mode: it auto-detects your next sentence, records until you pause, answers, and keeps listening. Say or type `sleep` to stand down.
- Use the ear button to toggle hands-free follow-up detection. If it is off, press the mic for each follow-up turn.
- Keep the radio button enabled for wake-phrase mode, or turn it off to submit every final voice transcript.
- Click the speaker button to mute or restore spoken responses.
- Click the sliders button to pick the best installed Windows/Edge voice and tune rate/pitch. FRIDAY now defaults to a brighter feminine voice profile; Microsoft Jenny, Aria, Zira, Samantha, Hazel, or other natural female voices usually sound best.
- If Chrome/Edge shows a voice engine network failure, FRIDAY switches to Gemini STT mode. Press the mic once, speak for up to 25 seconds, then press the mic again to transcribe the full sentence.
- Desktop bridge commands currently support approved browser targets and local targets, including: `open instagram`, `open youtube`, `open google`, `open gmail`, `open whatsapp`, `open chatgpt`, `open github`, `open opera gx`, `open notepad`, `open calculator`, `open settings`, `open explorer`, `open downloads`, `open documents`, `open desktop`, and `open vscode`.

On Windows, launch it like a desktop companion:

```powershell
.\start-friday.ps1
```

To run FRIDAY as a hidden desktop listener that opens when you clap twice:

```powershell
.\start-friday-desktop.ps1
```

In desktop mode, the Electron shell stays alive in the background with a hidden FRIDAY window. The first time it runs, Windows/Electron may request microphone permission. After that, double clap shows the FRIDAY window and starts the first spoken line. Closing the FRIDAY window hides it instead of fully quitting; quit the Electron process to stop background listening.

To make FRIDAY start when you sign in to Windows:

```powershell
.\install-friday-startup.ps1
```

To make the hidden clap listener start when you sign in to Windows:

```powershell
.\install-friday-desktop-startup.ps1
```

## Deploy to Render

This repo includes `render.yaml` for a Render web service.

1. Push this project to GitHub.
2. In Render, create a new Blueprint from the GitHub repo.
3. Add the required secret environment variable when prompted:
   `GEMINI_API_KEY`
4. Render uses:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`

The hosted Render version can run the chat, voice UI, and Gemini features in the browser. Local desktop actions such as opening apps or folders only work on your Windows machine through the local server.

## Cloud + Desktop Bridge

To use both Render and desktop control:

1. Keep the Render web service live for the hosted FRIDAY UI.
2. On your Windows PC, also run:
   `.\start-friday.ps1`
3. Open the Render URL in your browser.

When the hosted page receives a desktop command, it first asks Render. If the command needs Windows access, it automatically falls back to the local bridge at `http://127.0.0.1:3000`. Keep that local bridge running whenever you want FRIDAY to open local apps, folders, or Opera GX.
