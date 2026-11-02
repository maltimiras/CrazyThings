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

1. Open your app in a normal tab and set the window to the size you want the demo to be.
2. Click the toolbar icon, then **Start recording this tab**. A small `● REC` badge appears in the bottom-left of the page.
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

Space plays/pauses, ←/→ move between steps, and the timeline is clickable. URL options (they override the export settings): `?mode=guided`, `?autoplay=1`, `?speed=1.5`, `?loop=1`, `?controls=0`, `?frame=0`, `?cursor=0`, `?keys=0`, `?captions=0`, `?bg=light|none`, `?zoom=1|0`. `window.demoPlayer` exposes `play()`, `pause()` and `jump(i)` for embedding.

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

## Test

```bash
npm test     # loads the extension in headless Chromium, records examples/sample-app, exports, replays, asserts
```

## Limitations

- **Closed** shadow roots and cross-origin iframes can't be read. Cross-origin iframes are shown as a placeholder.
- Hover-only states (`:hover` menus, tooltips) aren't captured unless they're in the DOM when a snapshot is taken. Clicking to open them works.
- Drag-and-drop plays back as a click followed by the resulting screen. Canvas/WebGL charts and videos are static images.
- Snapshots are taken at the moment of each action. Very chatty apps (live tickers, clocks) can produce extra `change` steps; delete them in the review page.
- Exports with many screens can get large (each screen is a full DOM). Identical screens are merged automatically.
