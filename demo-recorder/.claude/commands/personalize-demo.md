---
description: Make a version of a recorded demo with synthetic data for one prospect
argument-hint: <path/to/demo.html> <prospect name / short brief>
---

Personalize a Demo Recorder export for a prospect. Follow the workflow and rules in `CLAUDE.md`.

Input: $ARGUMENTS

Steps:
1. Parse the arguments: the first is the source `.demo.html`, the rest is the prospect brief (company, industry, region, anything else given). If anything essential is missing, make reasonable assumptions and state them.
2. Run `node tools/demo.mjs info` and `node tools/demo.mjs strings --json` on the source. Identify every piece of data that belongs to the recorded account: people, emails, companies, logos, amounts, dates, URLs and IDs.
3. Design ONE coherent, fictional dataset that fits the prospect's industry and size. Use realistic names, plausible numbers and a domain like `app.<prospect>.com` for the URL bar. Write it to `demos/<slug>/map.json`.
4. Run `replace` into `demos/<slug>/work/`. Then hand-edit `screens/*.html` and `demo.json` for what the map can't do: consistent totals across screens, text split across tags, chart labels, the typed values in `type` steps, and the demo title.
5. Suggest or refresh captions (`note`) on the key steps, so they speak to the prospect's use case (short, benefit-oriented, at most about 6 captions). If steps have `narration` (the presenter's spoken script), rewrite it for the prospect too: same facts as the screens, natural spoken tone, similar length.
6. Pack to `demos/<slug>/<slug>.demo.html`. Check that no original strings remain, and make sure `data-demo-target` attributes are intact (count them before and after).
7. If the source had voice clips (`node tools/demo.mjs info` shows 🔊 on the steps), regenerate them for the new narration: `node tools/demo.mjs voice demos/<slug>/<slug>.demo.html`. It uses the same voice by default; add `--voice "<name>"` to change it. Only changed steps are voiced again. Skip this step if no ElevenLabs key is available, and say so.
8. Report: the output path, the map you used, the manual edits, and anything you couldn't change (for example text inside images or canvas).
