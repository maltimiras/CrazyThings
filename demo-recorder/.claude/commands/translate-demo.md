---
description: Make a version of a demo in another language (screens, captions, narration) and voice it with ElevenLabs
argument-hint: <path/to/demo.html> <language> [voice name] [--no-screens] [--no-voice]
---

Translate a Demo Recorder export into another language, then generate its voice-over. Follow the format rules in `CLAUDE.md`. You (Claude) do the translation yourself: no Anthropic API key is needed here.

Input: $ARGUMENTS

Steps:
1. Parse the arguments: the source `.demo.html` (or unpacked folder), the target language (a name or an ISO code, e.g. `Catalan` / `ca`, `pt-BR`), optionally an ElevenLabs voice name, `--no-screens` (translate only captions, narration and typed text) and `--no-voice`. The output goes to `demos/<slug>-<lang>/<slug>-<lang>.demo.html` unless a path is given.
2. Run `node tools/demo.mjs info <demo>`, then `node tools/demo.mjs texts <demo> demos/<slug>-<lang>/texts.json` (add `--no-screens` if asked). It lists every distinct string once, as `{ "text", "kind", "to": "" }`. `kind` is `ui` for screen text, captions, typed values and titles, and `voice` for the narration, which will be spoken.
3. Fill in every `"to"`. Read the whole list first, so terms are translated the same way everywhere.
   - `ui` strings: write them as a professionally localized version of the product would. Keep them about the original length (layouts and recorded click positions must still line up), with the same capitalization style and punctuation.
   - `voice` strings: write natural spoken language with the same meaning and roughly the same length. Each one plays over its step.
   - Keep unchanged: product, company and brand names, people's names, emails, URLs, codes and IDs, and numbers. Leave `"to"` empty for anything that must not change.
   - The file can be long: edit it in chunks. Don't skip strings.
4. Run `node tools/demo.mjs translate <demo> demos/<slug>-<lang>/texts.json demos/<slug>-<lang>/<slug>-<lang>.demo.html --lang <iso>`. Fix anything it reports as missing that should have been translated (or confirm it's a name).
5. Check the result. Run `node tools/demo.mjs strings <out>` and look for leftovers in the old language: text split across tags (`Hello <b>world</b>` is two strings, which can read badly when translated separately), and text in images, which can't be translated. For a split sentence, unpack, fix the screen HTML by hand, and pack again. Never touch `data-demo-target` or other `data-demo-*` attributes.
6. Voice (unless `--no-voice`): run `node tools/demo.mjs voices` to list the ElevenLabs voices. Pick the requested one, or one that suits the language and the original presenter. Then run `node tools/demo.mjs voice <out> --voice "<name>" --lang <iso>`. The key comes from `ELEVENLABS_API_KEY` or a `.env` file next to the demo (or in a parent folder); it needs the Text to Speech and Voices (read) permissions. If there's no key, or ElevenLabs can't be reached, say so and stop after step 5: the demo still works, with subtitles.
7. Report: the output path, how many strings were translated, anything kept in the original language and why, the voice used, and the total length of the speech. Mention that the user can open the file in a browser, or import it into the extension (⬆ Import demo) to review it there.
