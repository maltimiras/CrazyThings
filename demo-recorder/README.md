# Demo Recorder

A Chrome extension that records a walkthrough of any HTML web app (clicks, typing, keyboard shortcuts, scrolling, DOM updates) and exports a **single self-contained `.demo.html`**. The file replays the walkthrough with an animated cursor, typing, keycaps and captions. You don't need the real app, a login or a network connection.

The export is plain, readable HTML and JSON, so **Claude Code can rewrite it with synthetic data** for each prospect (see [`CLAUDE.md`](CLAUDE.md) and the `/personalize-demo` command).

```
record in Chrome  ──►  review & caption  ──►  export demo.html  ──►  claude: /personalize-demo demo.html "Northwind, logistics, 200 reps"
```

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder.
3. Pin **Demo Recorder** to the toolbar.

## Record

1. Open your app in a normal tab.
2. Click the toolbar icon. Under **Recording size**, pick the page size the demo should have (1280×720, 1440×900, 1920×1080, a custom size, or the current window). The window is resized so the page area is exactly that size, and put back afterwards if "Restore window size" is ticked. If the size doesn't fit your screen, or the page zoom isn't 100%, the popup says so. Then click **Start recording this tab**. A small `● REC` badge appears in the bottom-left of the page.
3. Do the demo. Each click, typing session, special key (`Enter`, `Esc`, `Tab`, arrows, `Ctrl/⌘+…`), scroll, and settled DOM change becomes a step. Page navigations are followed automatically.
4. Click **Stop & review**. The review page opens: delete noisy steps, add captions, set the export options (autoplay or guided, start automatically, speed, loop, control bar, browser frame, cursor, key-press overlay, captions, background, auto-zoom), then **Preview** or **Export HTML**.

Leave **Embed images & fonts** on (the default) so the file works offline and for viewers who aren't logged in.

## How it works

| Piece | What it does |
|---|---|
| `extension/content.js` | Takes a **screen** (a full HTML snapshot) at each action. It removes scripts and event handlers, keeps form values (passwords masked), scroll positions, open shadow DOM (as declarative shadow DOM), same-origin iframes, and canvases/video (as images). The element being acted on gets `data-demo-target="tN"`. Stylesheets, including CSS-in-JS rules added through the CSSOM, are captured once and deduplicated. |
| `extension/background.js` | Holds recording state across page loads and streams screens and steps into IndexedDB. |
| `extension/review.*`, `lib/build.js` | Merges screens that are identical, inlines assets, and assembles the file. |
| `extension/player/` | Replays in sandboxed iframes (no scripts run). It double-buffers screens so changes look instant, animates the cursor, typing and scrolling, and supports captions, auto-zoom onto clicks and typing (switchable per step), guided hotspots, a timeline, speed control and fullscreen. |
| `tools/demo.mjs` | CLI: `info`, `strings`, `replace`, `unpack`, `pack`, `upgrade`. |

### Player controls

Space plays/pauses, ←/→ move between steps, and the timeline is clickable. **Pace** switches between *Natural* (each step paced by its animations) and *As recorded* (each step lasts as long as in the original recording or video, which keeps a voice-over in sync). On the review page you can also set the pace and override how long any single step lasts (⏱ seconds); an open Preview tab reloads by itself after each change, at the same step. URL options (they override the export settings): `?mode=guided`, `?timing=recorded`, `?step=5`, `?autoplay=1`, `?speed=1.5`, `?loop=1`, `?controls=0`, `?frame=0`, `?cursor=0`, `?keys=0`, `?captions=0`, `?bg=light|none`, `?zoom=1|0`. `window.demoPlayer` exposes `play()`, `pause()` and `jump(i)` for embedding.

## Convert a video demo (Claude Code)

Have an older demo as a video with a voice-over? Claude Code can rebuild it as an HTML demo in the same style: the same player, cursor, zoom and subtitles, with editable screens and the narration as text per step.

```bash
cd demo-recorder
export ELEVENLABS_API_KEY=…   # or keep it in a .env file next to your videos (see below)
claude
> /video-to-demo ~/Videos/acme-walkthrough.mp4
```

The ElevenLabs key can also live in a `.env` file in your videos folder (or a parent folder), so you don't have to export it each time: `ELEVENLABS_API_KEY=your_key`. Keep it out of git; `demo-recorder/.gitignore` already ignores `.env` files.

Needs `ffmpeg` (`brew install ffmpeg` / `winget install ffmpeg` / `apt install ffmpeg`). Playwright is optional (`npm i -D playwright && npx playwright install chromium`); Claude uses it to compare its HTML with the video frames.

How it works:
1. `tools/video.mjs` extracts the key frames at each screen change, the audio and the transcript.
2. It builds a skeleton demo that already plays as a slideshow.
3. Claude rebuilds each screen as HTML from the frames, decides the clicks, typing and scrolling, places the narration, compares its HTML with the frames, and packs the `.demo.html`.

If the transcript couldn't be made during the conversion (no key, or a network that blocks ElevenLabs), add it afterwards. Steps keep their video times, so each sentence lands on the right step:

```bash
node tools/video.mjs narrate demos/my-demo/my-demo.demo.html ~/Videos/my-demo.mp4 --lang es
```

The result can be personalized (`/personalize-demo`) or imported into the extension like any other demo. The screens are faithful rebuilds, not pixel copies. Logos, photos and complex charts are cropped from the video as images.

## Share a demo

Export it with **Export HTML** and send the `.demo.html` file:

- **To watch it:** anyone can open the file in a browser. No extension or login needed.
- **To edit it in their own Demo Recorder:** they click **⬆ Import demo** at the top of the Recordings list in the review page, or drop the file there. The popup also has an **Import demo…** button. The demo then becomes a normal recording they can preview, edit (steps, captions, narration, zoom, export options) and export again.
- Demos personalized with Claude Code can be imported the same way, to check or tweak them before sending.
- The narration **text** travels with the file; the original narration **audio** doesn't.

## Personalize with Claude Code

```bash
cd demo-recorder
claude
> /personalize-demo ~/Downloads/pipeline.demo.html "Northwind Traders, logistics, EU, 200 sales reps"
```

Or use the CLI directly:

```bash
node tools/demo.mjs strings pipeline.demo.html                              # what data is in there?
node tools/demo.mjs replace pipeline.demo.html map.json demos/northwind/work   # bulk swap → unpacked folder
#   …edit demos/northwind/work/screens/*.html and demo.json…
node tools/demo.mjs pack demos/northwind/work demos/northwind/northwind.demo.html
```

## Narration (voice-over)

Tick **🎙 Record narration** in the popup. A **Narration** box appears, so you can set things up *before* you press Start:

- **Language you'll speak:** used for the live transcript (and passed to ElevenLabs).
- **Microphone:** pick the input to use. If the list is replaced by **Allow microphone…**, click it once to grant access.
- **🎙 Test mic:** a volume bar shows whether the microphone hears you ("✓ Hearing you"), and the words Chrome understands appear below it. If they don't, you see why. You can still record and transcribe with ElevenLabs afterwards.
- **Live transcript while recording:** untick it to skip Chrome's transcription and use only ElevenLabs.

While recording, a small **Narration** window shows the volume bar and your words as they're transcribed. It isn't part of the demo, because only the page's HTML is recorded. Keep it open for the live transcript. If the selected microphone is missing, the default one is used and the popup says so.

- The microphone is recorded through page changes and pauses with the recording.
- **Live transcript (free, Google Chrome only):** Chrome transcribes while you talk, and each sentence is put on the step that was on screen when you said it. Chrome sends the audio to Google for this.
- **ElevenLabs (more accurate):** add your ElevenLabs API key **once** in **⚙ Settings** (the link under *Import demo* on the recordings page, or ⚙ in the popup); every recording uses it. **Test key** checks it has the *Speech to Text* permission. Then click **Transcribe with ElevenLabs** on a recording. It uses speech-to-text (`scribe_v2`) with word timings to fill each step's narration.
- Each step's narration is plain text you can edit in the review page. It's exported as `narration` on the step and shown as **subtitles** in the player (export option "Narration subtitles", or `?subs=0`). Claude Code can rewrite it per prospect like any other text.
- The original audio stays with the recording: play it, download it, or transcribe it again. It isn't embedded in exports. The plan is to generate the voice from the (personalized) text with ElevenLabs text-to-speech.

## Test

```bash
npm test     # unit tests, then the extension in headless Chromium: records examples/sample-app, exports, replays, asserts
```

## Limitations

- **Closed** shadow roots and cross-origin iframes can't be read. Cross-origin iframes are shown as a placeholder.
- Hover-only states (`:hover` menus, tooltips) aren't captured unless they're in the DOM when a snapshot is taken. Clicking to open them works.
- Drag-and-drop plays back as a click followed by the resulting screen. Canvas/WebGL charts and videos are static images.
- Snapshots are taken at the moment of each action. Very chatty apps (live tickers, clocks) can produce extra `change` steps; delete them in the review page.
- Exports with many screens can get large (each screen is a full DOM). Identical screens are merged automatically.
