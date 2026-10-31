<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

FRIDAY's Phase II research foundation is documented in [Research engine](docs/research-engine.md). Say or type `research <objective>` to start a local evidence-driven brief, or `research history` to reopen saved work. Validate with `npm run test:research`.

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/bac3a480-e6fc-43a5-98ce-cd3cd460b06a

## Run Locally

See [project layout and validation commands](docs/project-layout.md) for the frontend/backend split. Browser-readable walkthroughs are in [docs/visuals](docs/visuals/).

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `GEMINI_API_KEY` and/or `VENICE_API_KEY` in [backend/.env.local](backend/.env.local). Chat priority defaults to `venice,gemini,ollama`.
3. Run the app:
   `npm run desktop`

## Desktop Voice Mode

FRIDAY now supports audible replies and microphone input in browsers with the Web Speech API, such as Chrome or Edge.

- Click the microphone button, allow microphone access, then say: `Friday status`
- Wake phrase mode is enabled by default. Press the mic once to arm it, then say `Friday wake up`. After activation, FRIDAY stays in hands-free conversation mode: it auto-detects your next sentence, records until you pause, answers, and keeps listening. Say or type `sleep` to stand down.
- Use the ear button to toggle hands-free follow-up detection. If it is off, press the mic for each follow-up turn.
- Keep the radio button enabled for wake-phrase mode, or turn it off to submit every final voice transcript.
- Click the speaker button to mute or restore spoken responses.
- Click the sliders button to pick the best installed Windows/Edge voice and tune rate/pitch. FRIDAY now defaults to a brighter feminine voice profile; Microsoft Jenny, Aria, Zira, Samantha, Hazel, or other natural female voices usually sound best.
- If Chrome/Edge shows a voice engine network failure, FRIDAY switches to Gemini STT mode. Press the mic once, speak for up to 25 seconds, then press the mic again to transcribe the full sentence.
- Desktop bridge commands currently support approved browser targets and local targets, including: `open instagram`, `open youtube`, `open google`, `open gmail`, `open whatsapp`, `open chatgpt`, `open github`, `open opera gx`, `open notepad`, `open calculator`, `open settings`, `open explorer`, `open downloads`, `open documents`, `open desktop`, and `open vscode`.

On Windows, launch it like a desktop companion:

```powershell
.\backend\scripts\start-friday.ps1
```

This opens FRIDAY in its own Electron desktop window and starts the local server behind it. Use `npm run dev` only when you specifically want the browser-based development server.

To run FRIDAY as a hidden desktop listener that opens when you say `Friday wake up`:

```powershell
.\backend\scripts\start-friday-desktop.ps1
```

In desktop mode, the Electron shell stays alive in the background with a hidden FRIDAY window. The first time it runs, Windows/Electron may request microphone permission. After that, saying `Friday wake up` shows the FRIDAY window and starts the first spoken line. Closing the FRIDAY window hides it instead of fully quitting; quit the Electron process to stop background listening.

To make FRIDAY start when you sign in to Windows:

```powershell
.\backend\scripts\install-friday-startup.ps1
```

To make the hidden wake phrase listener start when you sign in to Windows:

```powershell
.\backend\scripts\install-friday-desktop-startup.ps1
```

## Deploy to Render

This repo includes `render.yaml` for a Render web service.

1. Push this project to GitHub.
2. In Render, create a new Blueprint from the GitHub repo.
3. Add the secret environment variables when prompted:
   `GEMINI_API_KEY`
   `VENICE_API_KEY`
4. Render uses:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`

The hosted Render version can run the chat, voice UI, and Gemini features in the browser. Local desktop actions such as opening apps or folders only work on your Windows machine through the local server.

## Kali VM Bridge

FRIDAY can connect to a local Kali VM over SSH for defensive diagnostics. Configure `KALI_SSH_HOST`, `KALI_SSH_PORT`, `KALI_SSH_USER`, and `KALI_SSH_KEY` in `backend/.env.local`, then use commands such as `kali status`, `kali network diagnostics`, `kali dns example.com`, `kali whois example.com`, or `kali scan 192.168.1.1 authorized`.

## Reverse Engineering Intelligence Workbench

FRIDAY includes a local, evidence-first Reverse Engineering Workbench. Open **Modules → Reverse**, or ask FRIDAY to open the reverse engineering workbench.

The first release supports authorized, offline-only static analysis of local files:

- Static file triage with SHA-256, bounded strings, format identification, and entropy signals.
- PE, ELF, and Mach-O header metadata; it does not claim decompiled code is original source.
- Classic PCAP header/packet-summary analysis without exposing packet payloads.
- Source-file and safe ZIP source-archive import, definition, dependency, and route mapping without running builds or package scripts.
- Authorized public website observation for one page: HTTP headers, DOM counts, forms, same-origin links/assets, client-side framework signals, and API-like references. Private-network targets and cross-origin redirects are blocked.
- JSON and Markdown evidence reports, a tamper-evident audit chain, job cancellation, and a capability registry that shows detected but not-enabled tools.

Every upload requires an explicit local authorization assertion and approved scope. Results label directly observed facts, parser-reported findings, hypotheses, confirmed conclusions, and unknowns separately. Sensitive-looking values are redacted from string evidence and reports.

This is deliberately not a dynamic-analysis or offensive workbench: it does not execute artifacts, issue shell commands from prompts, probe networks, crawl websites, bypass authentication, inspect session secrets, flash firmware, or control hardware. A child worker with time and V8-memory limits is used for static parsing, but it is not a substitute for a disposable VM or container.

Website Studio is also available in the workbench. For an approved public reference URL, it creates an **original** editable Vite + React starter in your Downloads folder. It uses only high-level public design cues and never copies reference-site logos, text, images, protected assets, source code, private routes, or backend behavior. Open the generated folder in VS Code, run `npm install`, then `npm run dev` to customize and preview it. Set `FRIDAY_WEBSITE_STUDIO_OUTPUT_DIR` only if you need a different local output directory.

Optional settings are in [`backend/.env.example`](backend/.env.example). Current defaults: 8 MB upload limit, 4 MB inspection limit, 30-second worker limit, and 192 MB worker V8 heap. Run the module tests with:

```powershell
npm run test:reverse-engineering
```

## Cloud + Desktop Bridge

To use both Render and desktop control:

1. Keep the Render web service live for the hosted FRIDAY UI.
2. On your Windows PC, also run:
   `.\backend\scripts\start-friday.ps1`
3. Open the Render URL in your browser.

When the hosted page receives a desktop command, it first asks Render. If the command needs Windows access, it automatically falls back to the local bridge at `http://127.0.0.1:3000`. Keep that local bridge running whenever you want FRIDAY to open local apps, folders, or Opera GX.
# Live rendered website scanning

## Website Studio: build, preview, edit and export

Website reports include downloadable HTML and rendered observations, separate desktop/mobile coverage, and explicit unknowns. Live sampling records block geometry, spacing, corner radii and DOM animation timing; the build brief preserves those measurements. A completed scan covers the sampled page, not every route or private backend. Invalid generated HTML/JavaScript now triggers the next provider before a template is used. Existing project names are rejected before spending generation credit.

After building and reviewing a site in the browser, choose **Open in VS Code / Codex** from the finished-project panel. FRIDAY opens the saved project folder and `FRIDAY-CODEX-HANDOFF.md` in a new VS Code window. The brief includes the original request, reference-file pointers and generation limitations. In VS Code, open the Codex sidebar to request further edits; no task is automatically submitted. Existing handoff notes are preserved. Save FRIDAY drafts before opening VS Code, then use **Reload saved files** after saving external changes.

Deep scan now measures six desktop and three mobile viewports. It includes visible layout, computed DOM styles, headings, control labels, public resource metadata and open/closed shadow DOM. Creating a project starts a deep scan if one is not available in the current desktop session.

The builder passes observations and the user's design brief to configured Venice, Gemini, Ollama, then OpenAI providers, trying the next provider on failure. To enable the fourth fallback, set `OPENAI_API_KEY` in `backend/.env.local` and restart FRIDAY; `OPENAI_MODEL` defaults to `gpt-4o`. This requires separately billed OpenAI API access. Website generation requests JSON with a larger output limit and a two-minute OpenAI timeout. Generated HTML/CSS/JavaScript is checked for basic structure and JavaScript syntax. If providers fail, the UI explicitly labels the result `adaptive-template`; it is not presented as an AI reconstruction. Neither mode guarantees an exact clone or recovery of private backend behavior.

New projects are saved as editable source folders in Downloads. FRIDAY opens their isolated local preview in Opera GX when installed (otherwise the default browser), then saves a source ZIP in Downloads. The **Your websites** editor reopens registered projects, edits `index.html`, `styles.css` or `app.js`, saves with conflict detection, and refreshes the preview. Earlier file contents are backed up under `.friday-re/studio/<project-id>/`. Refresh Opera after saving to see updates there. Preview URLs are local and available while the FRIDAY backend runs; reopening a project restores its preview after a restart.

The generated project can also be opened directly via `index.html`, edited in VS Code, or run with its optional Vite commands. Demo forms and interactions operate locally; authentication, payments, databases and real message delivery need explicit backend integrations. Generated previews use a separate loopback origin, deny network API calls and external frames, and have no desktop bridge. ZIP export includes only the generated source allowlist, never secrets or arbitrary files.

In the desktop Reverse Workbench, leave **Deep live scan** enabled and select **Analyze website**. FRIDAY opens the public site in a separate isolated browser view beside a live findings panel. It waits for client rendering, samples four scroll positions, and measures visible HTML regions, computed DOM styles, resource entries, shadow DOM and technology clues. Scan outlines and the moving sweep identify activity; the panel reports observed evidence. Stop or close the scan window to cancel.

This is bounded client-side observation, not a recursive crawl or recovery of original React components, canvas scene graphs, databases or private backend code. Canvas text can differ from computed DOM fonts. The browser session has no FRIDAY desktop bridge, uses temporary storage, denies permissions and downloads, and restricts navigation to the reference site's canonical host. Normal public page assets can load from public CDNs. Results remain in the workbench for the current session; building remains a separate action.

