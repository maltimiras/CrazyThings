# Demo Recorder: guide for Claude Code

This folder contains:

- `extension/`: a Chrome MV3 extension that records a web app (clicks, typing, keys, scrolling, DOM changes) and exports one self-contained `*.demo.html`.
- `tools/demo.mjs`: a dependency-free CLI to inspect, unpack, personalize and repack those files.
- `test/e2e.mjs`: an end-to-end test (loads the extension in Chromium, records `examples/sample-app`, replays the export).

Most sessions here are about **making a version of a recorded demo with synthetic data for one prospect**. Follow the workflow below.

## The demo file format

An exported demo is one HTML file with these `<script>` data blocks (none of them executes except the player):

| Block | What it is | Edit? |
|---|---|---|
| `#demo-data` (JSON) | `title`, `settings`, `screens` (url/title/viewport per screen), `steps` | yes |
| `#screen-sN` (text/html) | a full HTML snapshot of the app at one moment | yes: text, numbers, names |
| `#css-KEY` (text/css) | shared stylesheets, referenced from screens by `<style data-demo-css="KEY"></style>` | rarely |
| `#demo-assets` (JSON) | `{ "a1": "data:image/png;base64,…" }`, referenced as `demo-asset:a1` | swap logos/avatars |
| `#demo-player` | the player | never (use `upgrade`) |

**Steps** (`demo-data.steps[]`). Each step acts on the screen named in `screen`:

- `start` / `navigate` / `change` / `end`: show that screen (a page load or a DOM update).
- `click`: the cursor moves to the element `[data-demo-target~="tN"]` in that screen (`x`/`y` = relative point inside it) and clicks.
- `type`: types into the target, animating from `from` to `text`.
- `key`: shows a keycap overlay (`key`, e.g. `Escape`, `Ctrl+K`).
- `scroll`: animates the window (or the target element) to `top`/`left`.
- Optional on any step: `note` (caption callout), `hold` (ms to pause), `duration` (ms the step lasts; overrides the pace), `narration` (what the presenter says during this step: shown as subtitles, and voiced when the step has a clip), `narrationEnd` (video/recording ms when that narration stops being spoken; the subtitle stays on screen until then, also over the following steps).
- Voice-over clips (made with ElevenLabs text-to-speech): `voice` (an asset id in `#demo-assets`, e.g. `a12`, holding `data:audio/mpeg;base64,…`), `voiceMs` (when the speech ends, in ms) and `voiceText` (the narration the clip was made from). When `narration` no longer equals `voiceText`, the clip is outdated: regenerate it with `node tools/demo.mjs voice`. Never write `voice` fields by hand.
- Optional on `click`/`type` steps: `zoom`. Use `false` to keep the full page in view for that step, a number (e.g. `2`) for a custom zoom level, or `true` to zoom even when auto-zoom is off globally. Zoom is a CSS transform on the live HTML, so it never affects what you can edit.

**Settings** (`demo-data.settings`): `mode` is `autoplay` or `guided` (the viewer clicks hotspots to advance). Also `autoStart` (play on open, no Play button), `timing` (`auto` = natural pacing, `recorded` = each step lasts as in the original, gap to the next step's `t`; video conversions use `recorded` so the voice-over stays in sync), `speed`, `loop`, `controls` (bottom control bar), `browserFrame`, `cursor`, `showKeys` (keycap overlay for key presses), `captions`, `subtitles` (show `narration` as subtitles), `voice` (play the voice clips), `background` (`dark` | `light` | `none`), `zoom` (auto-zoom onto clicks and typing) and `zoomLevel` (e.g. `1.8`). URL overrides: `?mode=guided`, `?timing=recorded`, `?step=N`, `?autoplay=1`, `?speed=2`, `?loop=1`, `?controls=0`, `?frame=0`, `?cursor=0`, `?keys=0`, `?captions=0`, `?subs=0`, `?voice=0`, `?bg=light`, `?zoom=1`.

Also in `demo-data`: `lang` (ISO code of the demo's language, set by translations) and `voiceover` (`{ voiceId, name, model }`: the ElevenLabs voice used for the clips).

**Voice playback:** a clip keeps playing over the following steps that have no clip of their own. The next step with a clip waits until the previous clip has finished, so sentences are never cut off. In natural pace, a voiced step lasts at least as long as its clip. In `recorded` pace the timing is **fitted to the voice**: the stretch from one voiced step to the next is scaled to that clip's length (`voiceMs` + 0.4 s pause), so screens change at the same point of the sentence as in the original, whatever the voice or language. Explicit `duration`s are kept, and `?voice=0` plays the original timing.

## Personalization workflow

Never edit the original recording in place. Work in `demos/<prospect-slug>/`.

1. **Inspect**
   ```bash
   node tools/demo.mjs info    path/to/original.demo.html
   node tools/demo.mjs strings path/to/original.demo.html --json > demos/<slug>/strings.json
   ```
   `strings` lists every visible string, with counts and a kind (`text`, `money`, `number`, `percent`, `date`, `email`, `url`, `phone`). That includes text nodes, text-bearing attributes, typed values, captions, page titles and URLs.

2. **Design one coherent synthetic dataset** for the prospect: their company name and domain, an industry-appropriate cast of people, emails on their domain, customer/account names, realistic amounts and dates. Everything must be fictional. Recordings often contain **real customer data from the source account: replace all of it** (names, emails, phone numbers, company names, IDs).

3. **Bulk replace** with a map (exact strings, longest match first, whole-word by default):
   ```json
   { "Acme Corp": "Northwind Traders", "jane@acme.com": "priya.shah@northwind.io", "$184,500": "$1.2M" }
   ```
   ```bash
   node tools/demo.mjs replace original.demo.html demos/<slug>/map.json demos/<slug>/work   # → unpacked dir
   ```
   Replacement covers text nodes, all non-structural attributes (value, placeholder, title, alt, aria-label, custom-element props…), `<title>`, and the manifest's typed `text`/`from`, `label`, `note` and screen `title`/`url`. It never touches class names, ids, CSS, `href`/`src`, or `data-demo-*`.
   Add `--substring` to match inside words too.

4. **Hand edits in the unpacked folder** (`demos/<slug>/work/`):
   - `demo.json`: the manifest. Edit captions (`note`), `title` and `settings`, delete unwanted steps.
   - `screens/sN.html`: one file per screen. Fix anything the map can't do: text split across tags (`Acme <b>Corp</b>`), numbers that must stay **consistent across screens** (KPI totals = sum of table rows, counts, chart labels/SVG text), dates, avatars and initials.
   - `assets/aN.png` + `assets/assets.json`: replace a logo by overwriting the file (keep the id; change the extension in `assets.json` if needed).
   - Keep the story consistent: a value typed in a `type` step (`text`) must also appear on the screens that come after it.
   - **Narration** (`narration` on steps, from the presenter's recorded voice): `replace` already swaps mapped names in it. Then reread every step's narration and rewrite it for the prospect: their company, their use case, and the same numbers as the screens. Keep it natural spoken language, one or two short sentences per step, and roughly the original length, because playback gives each step about 65 ms per character. Don't put narration on steps where nothing should be said.

5. **Pack and verify** (the user can also import the packed file into the extension, with **⬆ Import demo** on the review page, to review it there)
   ```bash
   node tools/demo.mjs pack demos/<slug>/work demos/<slug>/<slug>.demo.html
   node tools/demo.mjs strings demos/<slug>/<slug>.demo.html | grep -i "<old names>"   # should print nothing
   ```
   Optionally render a screenshot with Playwright (preinstalled in cloud sessions) by opening the file and calling `window.demoPlayer.jump(i, false)`.

## Language versions and voice-over

- `/translate-demo <demo> <language>` (`.claude/commands/translate-demo.md`): `demo.mjs texts` lists every string, you write the translations, and `demo.mjs translate` puts them in place. Translate the screens as well as the captions, typed values and narration.
- `node tools/demo.mjs voices` lists the ElevenLabs voices. `node tools/demo.mjs voice <demo> [--voice name] [--lang xx] [--force]` voices every narrated step and embeds the clips. It only redoes steps whose narration changed, unless you pass `--force` or pick another voice.
- The ElevenLabs key comes from `ELEVENLABS_API_KEY` or a `.env` next to the demo (or a parent folder). It needs the Text to Speech and Voices (read) permissions.
- In the extension, the same is available on the review page: the 🔊 Voice-over card, and 🌐 Language version, which translates with Claude through the Anthropic API key in ⚙ Settings.

## Rules: don't break playback

- Do **not** remove, rename or move `data-demo-target` attributes. They are how clicks and typing find their element. Keep the element that carries the attribute.
- Do **not** remove `<base href>`, `<style data-demo-css>` placeholders, `data-demo-scroll`, or `demo-asset:` references.
- Prefer changing text over changing structure. Keep replacement strings roughly the same length, so layouts (and the recorded click positions) still line up.
- Screens are inert snapshots: there are no scripts, and `<script>` tags inside a screen are not run.
- To change the player, edit `extension/player/*`. Then `node tools/demo.mjs upgrade file.demo.html` re-packs any demo with the new player.

## Converting a video demo

Use `/video-to-demo <video>` (`.claude/commands/video-to-demo.md`) to turn a screen recording with a voice-over into a demo. `tools/video.mjs` does the mechanical part:
- `prepare`: key frames, contact sheets, audio, viewport;
- `transcribe`: ElevenLabs speech-to-text;
- `scaffold`: a playable skeleton with narration per step;
- `frames`: extra frames at given times;
- `crop`: image assets from frames;
- `compare`: video frame next to your HTML;
- `narrate`: adds the narration text to a finished demo later, by each step's video time `t` (then `demo.mjs voice` can give it a new voice).

You rebuild the screens as HTML with one shared `css/app.css` and define the steps. Placeholder screens carry `data-demo-placeholder`; none may remain at the end.

## Developing the extension

- Load it unpacked from `extension/` (chrome://extensions → Developer mode → Load unpacked).
- Run `npm test` (= `node test/e2e.mjs [outDir]`) after changes to `content.js`, `lib/*` or `player/*`. It records the sample app in headless Chromium, exports, replays, and writes screenshots.
- Shared format code lives in `extension/lib/format.js` (used by the extension and the CLI). Keep it free of browser-only APIs.
