---
description: Turn a screen-recording video with a voice-over into an editable HTML demo
argument-hint: <path/to/video.mp4> [title or notes]
---

Convert a video demo into a Demo Recorder `.demo.html`: the same player, cursor, zoom and subtitles as a recorded demo, with screens rebuilt as **editable HTML** and the voice-over as **narration text per step**. The rules in `CLAUDE.md` apply.

Input: $ARGUMENTS

Work in `demos/<slug>/` (slug from the video name). `<work>` = `demos/<slug>/video` and `<demo>` = `demos/<slug>/work`.

## 1. Prepare
1. Check `ffmpeg -version`. If it's missing, tell the user how to install it and stop.
2. Run `node tools/video.mjs prepare <video> <work>`. Read `<work>/video.json`: duration, `viewport` (the CSS size the screens must have) and the key-frame list.
   - If the video zooms or crops (the UI doesn't fill the frame), or the guessed `dpr` looks wrong (UI text clearly too small or too large), rerun with `--dpr`.
3. Run `node tools/video.mjs transcribe <work> --lang <es|ca|en…>`. The key is read from `ELEVENLABS_API_KEY`, or from a `.env` file (`ELEVENLABS_API_KEY=…`) in the video's folder, its parent folders, the work folder or the current folder. **Never print, copy or commit the key.** If no key is found, ask the user to add a `.env` next to their videos, or continue without narration and say so.
4. Run `node tools/video.mjs scaffold <work> --slug <slug> --title "<title>" --out <demo>`. The demo is already playable as a slideshow of frames. Read `<demo>/NOTES.md` (frames, times and narration per step).
5. Look at the contact sheets `<work>/frames/sheet-*.png` (12 frames per sheet, in order) to understand the whole flow. Then open individual frames.

## 2. Design system first
From 2–3 representative frames, write `<demo>/css/app.css`. It is shared by every screen through `<style data-demo-css="app"></style>`.
- Colors (exact hex sampled by eye), font stack (system UI unless a font is clearly recognizable), sizes, spacing, radii, shadows.
- Component classes for what repeats: sidebar/nav, header, buttons, inputs, tables, cards, badges, modals, toasts.
- Repeated parts of the UI (navigation, header) must be the **same HTML** in every screen.

## 3. Rebuild each screen
Replace every `screens/sN.html` placeholder (the ones with `data-demo-placeholder`) with real HTML:
- Exactly `viewport.w × viewport.h` CSS px, with the same layout. Copy the text exactly as shown (names, numbers, dates, labels).
- Icons: inline SVG or simple shapes. Simple charts: inline SVG with the right values.
- Logos, avatars, photos and complex charts: crop them from a frame with `node tools/video.mjs crop <work> <frame.png> x y w h <name>`. Coordinates are in frame pixels (multiply CSS px by `dpr`). Use the printed `demo-asset:aN`.
- Keep `<style data-demo-css="app"></style>` in the `<head>`. Put screen-specific CSS in a small extra `<style>` only when needed.
- Overlays (modals, dropdowns, toasts) go on top of the full page underneath, as in the frame.
- Scrolled content: lay out the full page and add `data-demo-scroll="top,left"` on the scrolled element (or on `<html>` for the window).

## 4. Decide the steps
Go through consecutive frames and decide what the user did between them. Use `node tools/video.mjs frames <work> t1,t2,…` to look between key frames (the cursor position before a change, the typing in progress, a short-lived menu).

| What changed | Step on the screen **before** the change |
|---|---|
| Something was clicked (button, row, tab, menu) | `click` with `target`, plus `data-demo-target="tN"` on that element. Use `x`/`y` (0–1 inside the element) from the cursor position. |
| Text appeared in a field | `type` with `target`, `from` (old value) and `text` (new value). Usually a `click` on the field comes first. |
| The page moved | `scroll` with `top` (and `target` for an inner scroller) |
| A shortcut / Enter / Esc did it | `key` with `key` (e.g. `Enter`, `Ctrl+K`) |
| It changed by itself (loading, toast) | `change` |

- Each step's `screen` is the state **before** its action. The next step shows the result.
- Merge near-identical frames, and drop half-way transition frames. Add screens when an important state was only visible between key frames (extract it with `frames`).
- Use unique target ids (`t1`, `t2`, …) across the demo.
- Set every screen's `url` in `demo.json` (from the address bar if visible, otherwise a plausible `https://app.<company>.com/...`) and its `title`. The player shows the URL bar.

## 5. Narration
- Keep each sentence on the step during which it's said. When you merge or split steps, move the text with it.
- Tidy filler ("eh", "um", repeated words) without changing the meaning or the language.
- Settings in `demo.json`: `subtitles: true`; `zoom: true` if the video zoomed onto clicks; `mode` stays `autoplay` unless the user asks for guided.

## 6. Verify
1. Run `node tools/video.mjs compare <work>` (needs Playwright: `npm i -D playwright && npx playwright install chromium`). Open `<work>/compare/sN.png`: the video frame is on the left, your HTML on the right. Fix the layout, text and color differences that matter. Small font-rendering differences are fine.
2. Run `node tools/demo.mjs pack <demo> demos/<slug>/<slug>.demo.html` (unused placeholder frames are left out automatically), then `node tools/demo.mjs info` on the result.
3. Check that no screen still contains `data-demo-placeholder`, and that every `click`/`type` target exists in its screen (`grep data-demo-target`).
4. If Playwright is available, open the packed file and check 2–3 steps with `window.demoPlayer.jump(i, false)` screenshots.

## 7. Report
Tell the user:
- the output file;
- the number of screens and steps;
- what was cropped as an image instead of rebuilt;
- steps you were unsure about (guessed clicks, unreadable text).

Mention that the demo can now be personalized with `/personalize-demo`, or imported into the extension with **⬆ Import demo**.
