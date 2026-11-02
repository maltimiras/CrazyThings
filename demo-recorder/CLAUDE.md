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
- Optional on any step: `note` (caption callout), `hold` (ms to pause).

**Settings** (`demo-data.settings`): `mode` is `autoplay` or `guided` (the viewer clicks hotspots to advance). Also `speed`, `browserFrame`, `cursor`, `showKeys` (keycap overlay for key presses), `loop`. URL overrides: `?mode=guided`, `?speed=2`, `?autoplay=1`, `?frame=0`, `?keys=0`.

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

5. **Pack and verify**
   ```bash
   node tools/demo.mjs pack demos/<slug>/work demos/<slug>/<slug>.demo.html
   node tools/demo.mjs strings demos/<slug>/<slug>.demo.html | grep -i "<old names>"   # should print nothing
   ```
   Optionally render a screenshot with Playwright (preinstalled in cloud sessions) by opening the file and calling `window.demoPlayer.jump(i, false)`.

## Rules: don't break playback

- Do **not** remove, rename or move `data-demo-target` attributes. They are how clicks and typing find their element. Keep the element that carries the attribute.
- Do **not** remove `<base href>`, `<style data-demo-css>` placeholders, `data-demo-scroll`, or `demo-asset:` references.
- Prefer changing text over changing structure. Keep replacement strings roughly the same length, so layouts (and the recorded click positions) still line up.
- Screens are inert snapshots: there are no scripts, and `<script>` tags inside a screen are not run.
- To change the player, edit `extension/player/*`. Then `node tools/demo.mjs upgrade file.demo.html` re-packs any demo with the new player.

## Developing the extension

- Load it unpacked from `extension/` (chrome://extensions → Developer mode → Load unpacked).
- Run `npm test` (= `node test/e2e.mjs [outDir]`) after changes to `content.js`, `lib/*` or `player/*`. It records the sample app in headless Chromium, exports, replays, and writes screenshots.
- Shared format code lives in `extension/lib/format.js` (used by the extension and the CLI). Keep it free of browser-only APIs.
