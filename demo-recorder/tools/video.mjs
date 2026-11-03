#!/usr/bin/env node
// video.mjs: turn a screen-recording video with a voice-over into an editable HTML demo.
// The mechanical part (frames, audio, transcript, skeleton, comparisons) lives here; Claude Code
// rebuilds the screens as HTML following .claude/commands/video-to-demo.md.
//
//   node tools/video.mjs prepare    <video> <work> [--max-frames 60] [--dpr 2] [--scene 0.012]
//   node tools/video.mjs transcribe <work> [--lang es]            (needs ELEVENLABS_API_KEY)
//   node tools/video.mjs scaffold   <work> [--slug name] [--title "…"] [--out dir]
//   node tools/video.mjs frames     <work> 12.0,12.5,13.0          (extra frames at given times)
//   node tools/video.mjs crop       <work> <frame.png> x y w h <name>   (image asset from a frame)
//   node tools/video.mjs compare    <work>                         (needs Playwright)
//
// Requires ffmpeg and ffprobe on PATH. Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseShowinfo, selectFrames, guessViewport, frameName, buildScaffold, resolveScreen } from './videolib.mjs';

// ------------------------------------------------------------------ helpers
function run(bin, args, { allowFail = false } = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error && r.error.code === 'ENOENT') {
    throw new Error(`${bin} not found. Install ffmpeg (macOS: brew install ffmpeg · Windows: winget install ffmpeg · Linux: apt install ffmpeg).`);
  }
  if (r.status !== 0 && !allowFail) throw new Error(`${bin} failed: ${(r.stderr || '').split('\n').slice(-6).join('\n')}`);
  return r;
}
const ff = (args, o) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], o);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n');

function loadVideo(work) {
  const f = path.join(work, 'video.json');
  if (!fs.existsSync(f)) throw new Error(`${f} not found: run "prepare" first.`);
  return readJson(f);
}

function probe(video) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', video]);
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream in ' + video);
  return {
    width: v.width, height: v.height,
    duration: parseFloat(j.format && j.format.duration) || 0,
    hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

// A frame is blank when its brightness barely varies (uniform white/black/grey).
function isBlank(file) {
  const r = run('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print', '-f', 'null', '-'], { allowFail: true });
  const min = parseFloat((r.stderr.match(/lavfi\.signalstats\.YMIN=([0-9.]+)/) || [])[1]);
  const max = parseFloat((r.stderr.match(/lavfi\.signalstats\.YMAX=([0-9.]+)/) || [])[1]);
  return Number.isFinite(min) && Number.isFinite(max) && max - min < 12;
}

function extractFrame(video, t, out) {
  ff(['-ss', String(t), '-i', video, '-frames:v', '1', out]);
}

// ------------------------------------------------------------------ commands
function cmdPrepare(video, work, opts) {
  if (!fs.existsSync(video)) throw new Error('Video not found: ' + video);
  const info = probe(video);
  fs.mkdirSync(path.join(work, 'frames'), { recursive: true });
  const maxFrames = opts.maxFrames || 60;

  // Scene detection: adjust the threshold to keep a useful number of key frames.
  // UI changes score low (a panel opening ≈ 0.01–0.03), so start sensitive and back off
  // only when there are too many changes (cursor movement, animations).
  let threshold = opts.scene || 0.012;
  let times = [];
  for (let i = 0; i < 8; i++) {
    const r = run('ffmpeg', ['-hide_banner', '-i', video, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], { allowFail: true });
    times = parseShowinfo(r.stderr);
    if (times.length > maxFrames - 2 && !opts.scene) threshold = Math.min(0.9, threshold * 1.5);
    else if (times.length === 0 && threshold > 0.004 && !opts.scene) threshold /= 2;
    else break;
  }
  let picked = selectFrames(times, info.duration);
  if (picked.length > maxFrames) {
    const step = picked.length / maxFrames;
    picked = Array.from({ length: maxFrames }, (_, i) => picked[Math.floor(i * step)]);
  }

  // Extract, skipping blank frames (e.g. white/black while the page is still loading).
  const frames = [];
  let skipped = 0;
  for (const t of picked) {
    const tmp = path.join(work, 'frames', '.tmp.png');
    extractFrame(video, t, tmp);
    if (isBlank(tmp) && picked.length > 1) { skipped++; fs.rmSync(tmp); continue; }
    const file = frameName(frames.length, t);
    fs.renameSync(tmp, path.join(work, 'frames', file));
    frames.push({ file, t });
  }
  if (skipped) console.log(`(skipped ${skipped} blank frame${skipped === 1 ? '' : 's'})`);

  // Contact sheets (4×3 thumbnails) to skim the whole video quickly.
  const thumbs = path.join(work, 'frames', '.thumbs');
  fs.mkdirSync(thumbs, { recursive: true });
  frames.forEach((f, i) => ff(['-i', path.join(work, 'frames', f.file), '-vf', 'scale=480:-2', path.join(thumbs, String(i + 1).padStart(4, '0') + '.png')]));
  ff(['-framerate', '1', '-i', path.join(thumbs, '%04d.png'), '-vf', 'tile=4x3:padding=8:margin=8:color=white', '-fps_mode', 'passthrough', path.join(work, 'frames', 'sheet-%02d.png')], { allowFail: true });
  fs.rmSync(thumbs, { recursive: true, force: true });

  if (info.hasAudio) ff(['-i', video, '-vn', '-ac', '1', '-b:a', '64k', path.join(work, 'audio.mp3')]);

  const viewport = guessViewport(info.width, info.height, opts.dpr);
  writeJson(path.join(work, 'video.json'), {
    source: path.resolve(video), duration: info.duration, width: info.width, height: info.height,
    viewport, hasAudio: info.hasAudio, sceneThreshold: threshold, frames,
  });
  const sheets = fs.readdirSync(path.join(work, 'frames')).filter((f) => f.startsWith('sheet-'));
  console.log(`${frames.length} key frames, ${sheets.length} contact sheet(s), viewport ${viewport.w}×${viewport.h} (dpr ${viewport.dpr})${info.hasAudio ? ', audio.mp3' : ', no audio track'} → ${work}/`);
}

async function cmdTranscribe(work, opts) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('Set ELEVENLABS_API_KEY (your ElevenLabs API key) first.');
  const audio = path.join(work, 'audio.mp3');
  if (!fs.existsSync(audio)) throw new Error('No audio.mp3 in ' + work + ' (the video had no audio track?)');
  const base = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, '');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), 'audio.mp3');
  fd.append('model_id', opts.model || 'scribe_v2');
  fd.append('timestamps_granularity', 'word');
  if (opts.lang) fd.append('language_code', opts.lang);
  const res = await fetch(base + '/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  writeJson(path.join(work, 'transcript.json'), { text: json.text || '', language_code: json.language_code || opts.lang || '', words: json.words || [] });
  console.log(`Transcript: ${(json.words || []).filter((w) => !w.type || w.type === 'word').length} words → ${work}/transcript.json`);
}

function cmdScaffold(work, opts) {
  const video = loadVideo(work);
  const slug = opts.slug || path.basename(video.source).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video-demo';
  const out = opts.out || path.join('demos', slug, 'work');
  const tFile = path.join(work, 'transcript.json');
  const words = fs.existsSync(tFile) ? readJson(tFile).words : [];
  if (!words.length) console.warn('No transcript.json: narration left empty (run "transcribe" first to fill it).');

  fs.mkdirSync(path.join(out, 'screens'), { recursive: true });
  fs.mkdirSync(path.join(out, 'css'), { recursive: true });
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

  // Placeholder images: frames scaled to the viewport, as JPEG (they're replaced by HTML later).
  const assetMap = {};
  const frameAssets = video.frames.map((f, i) => {
    const id = 'a' + (i + 1);
    const file = `${id}.jpg`;
    ff(['-i', path.join(work, 'frames', f.file), '-vf', `scale=${video.viewport.w}:${video.viewport.h}`, '-q:v', '4', path.join(out, 'assets', file)]);
    assetMap[id] = file;
    return id;
  });
  const { manifest, screens, notes } = buildScaffold({ title: opts.title || slug, video, words, frameAssets });
  writeJson(path.join(out, 'demo.json'), manifest);
  for (const [id, html] of Object.entries(screens)) fs.writeFileSync(path.join(out, 'screens', id + '.html'), html);
  const cssFile = path.join(out, 'css', 'app.css');
  if (!fs.existsSync(cssFile)) fs.writeFileSync(cssFile, '/* Shared design system for every screen (colors, fonts, spacing, components). */\n');
  writeJson(path.join(out, 'assets', 'assets.json'), assetMap);
  fs.writeFileSync(path.join(out, 'NOTES.md'), notes);
  video.demoDir = path.resolve(out);
  writeJson(path.join(work, 'video.json'), video);
  const withNarr = manifest.steps.filter((s) => s.narration).length;
  console.log(`Scaffold: ${manifest.steps.length} steps (${withNarr} with narration), placeholder screens → ${out}/  (playable now: node tools/demo.mjs pack ${out} ${path.join(path.dirname(out), slug + '.demo.html')})`);
}

function cmdFrames(work, list) {
  const video = loadVideo(work);
  const times = String(list).split(',').map(Number).filter((t) => t >= 0 && t <= video.duration);
  if (!times.length) throw new Error('Give times in seconds, e.g. 12.0,12.5,13.0');
  fs.mkdirSync(path.join(work, 'frames', 'extra'), { recursive: true });
  for (const t of times) {
    const out = path.join(work, 'frames', 'extra', `t${t.toFixed(2).padStart(7, '0')}s.png`);
    extractFrame(video.source, t, out);
    console.log(out);
  }
}

function cmdCrop(work, frame, x, y, w, h, name) {
  const video = loadVideo(work);
  if (!video.demoDir) throw new Error('Run "scaffold" first (crops are stored in the demo\'s assets).');
  const src = fs.existsSync(frame) ? frame : path.join(work, 'frames', frame);
  if (!fs.existsSync(src)) throw new Error('Frame not found: ' + frame);
  const assetsDir = path.join(video.demoDir, 'assets');
  const mapFile = path.join(assetsDir, 'assets.json');
  const map = fs.existsSync(mapFile) ? readJson(mapFile) : {};
  const next = 1 + Math.max(0, ...Object.keys(map).map((k) => parseInt(k.slice(1), 10) || 0));
  const id = 'a' + next;
  const file = `${id}-${String(name || 'crop').replace(/[^a-z0-9_-]+/gi, '-')}.png`;
  ff(['-i', src, '-vf', `crop=${w}:${h}:${x}:${y}`, path.join(assetsDir, file)]);
  map[id] = file;
  writeJson(mapFile, map);
  const d = video.viewport.dpr || 1;
  console.log(`${id} → assets/${file}  (frame pixels; ${Math.round(w / d)}×${Math.round(h / d)} CSS px)  use: <img src="demo-asset:${id}" width="${Math.round(w / d)}" height="${Math.round(h / d)}" alt="">`);
}

async function cmdCompare(work) {
  const video = loadVideo(work);
  if (!video.demoDir) throw new Error('Run "scaffold" first.');
  let chromium;
  try {
    ({ chromium } = createRequire(path.join(process.cwd(), 'x.js'))('playwright'));
  } catch {
    try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch {
      throw new Error('compare needs Playwright: npm i -D playwright && npx playwright install chromium');
    }
  }
  const dir = video.demoDir;
  const manifest = readJson(path.join(dir, 'demo.json'));
  const css = {};
  for (const f of fs.readdirSync(path.join(dir, 'css'))) if (f.endsWith('.css')) css[f.slice(0, -4)] = fs.readFileSync(path.join(dir, 'css', f), 'utf8');
  const map = readJson(path.join(dir, 'assets', 'assets.json'));
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif' };
  const assets = {};
  for (const [id, file] of Object.entries(map)) {
    const ext = path.extname(file).slice(1).toLowerCase();
    assets[id] = `data:${mime[ext] || 'application/octet-stream'};base64,` + fs.readFileSync(path.join(dir, 'assets', file)).toString('base64');
  }
  const out = path.join(work, 'compare');
  fs.mkdirSync(out, { recursive: true });
  const { w, h } = video.viewport;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  let n = 0;
  for (const [sid, meta] of Object.entries(manifest.screens)) {
    const f = path.join(dir, 'screens', sid + '.html');
    if (!fs.existsSync(f) || !meta.frame) continue;
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(resolveScreen(fs.readFileSync(f, 'utf8'), css, assets), { waitUntil: 'load' });
    const shot = (await page.screenshot()).toString('base64');
    const frame = fs.readFileSync(path.join(work, 'frames', meta.frame)).toString('base64');
    await page.setViewportSize({ width: w * 2 + 24, height: h + 40 });
    await page.setContent(`<body style="margin:0;background:#111;color:#ddd;font:14px system-ui">
      <div style="display:flex;gap:24px"><div><div style="padding:10px">${sid} · video frame ${meta.frame}</div><img src="data:image/png;base64,${frame}" style="width:${w}px;height:${h}px;display:block"></div>
      <div><div style="padding:10px">${sid} · HTML</div><img src="data:image/png;base64,${shot}" style="width:${w}px;height:${h}px;display:block"></div></div></body>`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(out, sid + '.png') });
    n++;
  }
  await browser.close();
  console.log(`${n} comparison image(s) → ${out}/ (left: video frame, right: your HTML)`);
}

// ------------------------------------------------------------------ main
const argv = process.argv.slice(2);
const opts = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--max-frames') opts.maxFrames = +argv[++i];
  else if (a === '--dpr') opts.dpr = +argv[++i];
  else if (a === '--scene') opts.scene = +argv[++i];
  else if (a === '--lang') opts.lang = argv[++i];
  else if (a === '--model') opts.model = argv[++i];
  else if (a === '--slug') opts.slug = argv[++i];
  else if (a === '--title') opts.title = argv[++i];
  else if (a === '--out') opts.out = argv[++i];
  else pos.push(a);
}
const [cmd, ...args] = pos;
const need = (n, usage) => { if (args.length < n) { console.error('Usage: node tools/video.mjs ' + usage); process.exit(1); } };

try {
  switch (cmd) {
    case 'prepare': need(2, 'prepare <video> <work> [--max-frames 60] [--dpr 2]'); cmdPrepare(args[0], args[1], opts); break;
    case 'transcribe': need(1, 'transcribe <work> [--lang es]'); await cmdTranscribe(args[0], opts); break;
    case 'scaffold': need(1, 'scaffold <work> [--slug name] [--title "…"] [--out dir]'); cmdScaffold(args[0], opts); break;
    case 'frames': need(2, 'frames <work> 12.0,12.5'); cmdFrames(args[0], args[1]); break;
    case 'crop': need(6, 'crop <work> <frame.png> x y w h [name]'); cmdCrop(args[0], args[1], +args[2], +args[3], +args[4], +args[5], args[6]); break;
    case 'compare': need(1, 'compare <work>'); await cmdCompare(args[0]); break;
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
