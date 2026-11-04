#!/usr/bin/env node
// demo.mjs — inspect, unpack, personalize and repack Demo Recorder exports.
// No dependencies. Node 18+.
//
//   node tools/demo.mjs info     <demo.html|dir>
//   node tools/demo.mjs unpack   <demo.html> <dir>
//   node tools/demo.mjs pack     <dir> <out.html>
//   node tools/demo.mjs strings  <demo.html|dir> [--json] [--min N]
//   node tools/demo.mjs replace  <demo.html|dir> <map.json> <out.html|dir> [--substring]
//   node tools/demo.mjs texts    <demo.html|dir> <texts.json> [--no-screens]   (strings to translate)
//   node tools/demo.mjs translate <demo.html|dir> <texts.json> <out.html|dir> [--lang xx] [--no-screens]
//   node tools/demo.mjs voices                                (ElevenLabs voices you can use)
//   node tools/demo.mjs voice    <demo.html|dir> [out] [--voice name|id] [--model m] [--lang xx] [--force]
//   node tools/demo.mjs upgrade  <demo.html> [out.html]      (re-pack with the latest player)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleDemo, parseDemo } from '../extension/lib/format.js';
import { spawnSync } from 'node:child_process';
import { collectTexts, applyTranslations } from '../extension/lib/translate.js';
import { listVoices, voiceSteps, nextAssetId, DEFAULT_TTS_MODEL } from '../extension/lib/voice.js';
import { parseEnv } from './videolib.mjs';
import { decode, escText, escAttr, reEsc, visitHtml, stripHead } from '../extension/lib/text.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_DIR = path.join(HERE, '..', 'extension', 'player');

const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/avif': 'avif',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/font-woff2': 'woff2', 'application/font-woff': 'woff', 'application/octet-stream': 'bin',
  'video/mp4': 'mp4', 'audio/mpeg': 'mp3',
};
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));
Object.assign(EXT_MIME, { jpeg: 'image/jpeg', woff2: 'font/woff2', woff: 'font/woff', svg: 'image/svg+xml', ico: 'image/x-icon' });

// ------------------------------------------------------------------ io
function load(input) {
  if (fs.statSync(input).isDirectory()) return loadDir(input);
  return parseDemo(fs.readFileSync(input, 'utf8'));
}

function loadDir(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'demo.json'), 'utf8'));
  const screens = {};
  for (const id of Object.keys(manifest.screens || {})) {
    const f = path.join(dir, 'screens', id + '.html');
    if (fs.existsSync(f)) screens[id] = fs.readFileSync(f, 'utf8');
  }
  const css = {};
  const cssDir = path.join(dir, 'css');
  if (fs.existsSync(cssDir)) {
    for (const f of fs.readdirSync(cssDir)) if (f.endsWith('.css')) css[f.slice(0, -4)] = fs.readFileSync(path.join(cssDir, f), 'utf8');
  }
  const assets = {};
  const idx = path.join(dir, 'assets', 'assets.json');
  if (fs.existsSync(idx)) {
    const map = JSON.parse(fs.readFileSync(idx, 'utf8'));
    for (const [id, file] of Object.entries(map)) {
      const fp = path.join(dir, 'assets', file);
      if (!fs.existsSync(fp)) continue;
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime = EXT_MIME[ext] || 'application/octet-stream';
      assets[id] = `data:${mime};base64,` + fs.readFileSync(fp).toString('base64');
    }
  }
  return { manifest, screens, css, assets };
}

function readPlayer() {
  return {
    playerJs: fs.readFileSync(path.join(PLAYER_DIR, 'player.js'), 'utf8'),
    playerCss: fs.readFileSync(path.join(PLAYER_DIR, 'player.css'), 'utf8'),
  };
}

function save(data, out) {
  if (out.endsWith('.html') || out.endsWith('.htm')) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    // Only embed assets something still references (e.g. video frames replaced by rebuilt HTML).
    const used = new Set();
    for (const t of [...Object.values(data.screens), ...Object.values(data.css || {})]) {
      for (const m of t.matchAll(/demo-asset:(a\d+)/g)) used.add(m[1]);
    }
    for (const s of data.manifest.steps || []) if (s.voice) used.add(s.voice); // voice-over clips
    const assets = Object.fromEntries(Object.entries(data.assets || {}).filter(([id]) => used.has(id)));
    const dropped = Object.keys(data.assets || {}).length - Object.keys(assets).length;
    if (dropped) console.log(`(left out ${dropped} unused asset${dropped === 1 ? '' : 's'})`);
    fs.writeFileSync(out, assembleDemo({ ...data, assets, ...readPlayer() }));
    return;
  }
  fs.mkdirSync(path.join(out, 'screens'), { recursive: true });
  fs.mkdirSync(path.join(out, 'css'), { recursive: true });
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(out, 'demo.json'), JSON.stringify(data.manifest, null, 2) + '\n');
  for (const [id, html] of Object.entries(data.screens)) fs.writeFileSync(path.join(out, 'screens', id + '.html'), html);
  for (const [k, text] of Object.entries(data.css)) fs.writeFileSync(path.join(out, 'css', k + '.css'), text);
  const map = {};
  for (const [id, url] of Object.entries(data.assets || {})) {
    const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) continue;
    const ext = MIME_EXT[(m[1] || '').toLowerCase()] || 'bin';
    const file = `${id}.${ext}`;
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    fs.writeFileSync(path.join(out, 'assets', file), buf);
    map[id] = file;
  }
  fs.writeFileSync(path.join(out, 'assets', 'assets.json'), JSON.stringify(map, null, 2) + '\n');
}

// ------------------------------------------------------------------ commands
function cmdInfo(input) {
  const { manifest, screens, css, assets } = load(input);
  const size = (o) => Object.values(o).reduce((n, s) => n + s.length, 0);
  console.log(`Title:    ${manifest.title}`);
  console.log(`Viewport: ${manifest.viewport?.w}×${manifest.viewport?.h}   Mode: ${manifest.settings?.mode}`);
  console.log(`Screens:  ${Object.keys(screens).length} (${(size(screens) / 1024).toFixed(0)} KB)  CSS: ${Object.keys(css).length} (${(size(css) / 1024).toFixed(0)} KB)  Assets: ${Object.keys(assets).length} (${(size(assets) / 1024).toFixed(0)} KB)`);
  console.log('');
  for (const s of manifest.steps) {
    let d = '';
    if (s.type === 'click') d = `“${s.label || ''}”`;
    else if (s.type === 'type') d = `“${s.text}”`;
    else if (s.type === 'key') d = s.key;
    else if (s.type === 'scroll') d = `→ ${s.top}px`;
    else if (s.url) d = s.url;
    const note = (typeof s.duration === 'number' ? `   [⏱ ${(s.duration / 1000).toFixed(1)}s]` : '') + (s.highlight === false ? '   [box off]' : s.highlight === 'card' ? '   [box card]' : '') + (s.zoom === false ? '   [zoom off]' : typeof s.zoom === 'number' ? `   [zoom ${s.zoom}×]` : '') + (s.note ? `   📝 ${s.note}` : '') + (s.voice ? `   🔊 ${((s.voiceMs || 0) / 1000).toFixed(1)}s` : '') + (s.narration ? `   🎙 ${s.narration.length > 60 ? s.narration.slice(0, 57) + '…' : s.narration}` : '');
    console.log(`${String(s.id).padStart(3)}  ${s.type.padEnd(8)} ${s.screen.padEnd(4)} ${s.target ? s.target.padEnd(5) : '     '} ${d}${note}`);
  }
}

function cmdStrings(input, opts) {
  const { manifest, screens } = load(input);
  const found = new Map(); // text -> { count, where:Set }
  const add = (raw, where) => {
    const t = raw.replace(/\s+/g, ' ').trim();
    if (t.length < opts.min) return;
    if (!/[\p{L}\p{N}]/u.test(t)) return;
    let e = found.get(t);
    if (!e) found.set(t, (e = { count: 0, where: new Set() }));
    e.count++;
    e.where.add(where);
  };
  for (const [id, html] of Object.entries(screens)) {
    visitHtml(stripHead(html), (text) => { add(decode(text), id); return text; }, (v) => { add(decode(v), id + '@attr'); return v; });
  }
  manifest.title && add(manifest.title, 'manifest.title');
  for (const [id, m] of Object.entries(manifest.screens || {})) {
    m.title && add(m.title, `${id}.title`);
    m.url && add(m.url, `${id}.url`);
  }
  for (const s of manifest.steps) {
    for (const k of ['text', 'from', 'label', 'note', 'narration']) if (s[k]) add(String(s[k]), `step${s.id}.${k}`);
  }
  const kind = (t) =>
    /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t) ? 'email' :
    /^https?:\/\//.test(t) ? 'url' :
    /^[$€£¥]\s?[\d.,]+[kKmMbB]?$|^[\d.,]+\s?[$€£¥]$|^[\d.,]+\s?(USD|EUR|GBP)$/.test(t) ? 'money' :
    /^[+-]?[\d.,]+\s?%$/.test(t) ? 'percent' :
    /^[+-]?[\d.,]+[kKmMbB]?$/.test(t) ? 'number' :
    /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}/.test(t) ? 'date' :
    /^\+?[\d ()-]{7,}$/.test(t) ? 'phone' : 'text';
  const rows = [...found.entries()].map(([text, e]) => ({ text, kind: kind(text), count: e.count, where: [...e.where].slice(0, 6) }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  if (opts.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  for (const r of rows) console.log(`${String(r.count).padStart(4)}  ${r.kind.padEnd(7)} ${JSON.stringify(r.text)}`);
  console.error(`\n${rows.length} distinct strings`);
}

function buildReplacer(map, opts) {
  const pairs = Array.isArray(map) ? map.map((p) => [p.from, p.to]) : Object.entries(map);
  const clean = pairs.filter(([f]) => f && f.length).sort((a, b) => b[0].length - a[0].length);
  const make = (esc) => {
    if (!clean.length) return (s) => s;
    const lookup = new Map(clean.map(([f, t]) => [esc(f), esc(String(t))]));
    const alt = [...lookup.keys()].map(reEsc).join('|');
    const re = opts.substring
      ? new RegExp(`(${alt})`, 'g')
      : new RegExp(`(?<![\\p{L}\\p{N}_])(${alt})(?![\\p{L}\\p{N}_])`, 'gu');
    return (s) => s.replace(re, (m) => { stats.hits++; return lookup.get(m); });
  };
  const stats = { hits: 0 };
  return { text: make(escText), attr: make(escAttr), raw: make((s) => s), stats };
}

function cmdReplace(input, mapFile, out, opts) {
  const data = load(input);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const R = buildReplacer(map, opts);
  for (const id of Object.keys(data.screens)) {
    let html = data.screens[id];
    html = html.replace(/(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i, (m, a, t, b) => a + R.text(t) + b);
    data.screens[id] = visitHtml(html, R.text, R.attr);
  }
  const m = data.manifest;
  if (m.title) m.title = R.raw(m.title);
  for (const meta of Object.values(m.screens || {})) {
    if (meta.title) meta.title = R.raw(meta.title);
    if (meta.url) meta.url = R.raw(meta.url);
  }
  for (const s of m.steps) for (const k of ['text', 'from', 'label', 'note', 'narration', 'url']) if (typeof s[k] === 'string') s[k] = R.raw(s[k]);
  save(data, out);
  console.log(`Replaced ${R.stats.hits} occurrence(s) → ${out}`);
}

// Every string a translation must cover: [{ text, kind: 'ui'|'voice', to: '' }]. Fill in "to".
function cmdTexts(input, out, opts) {
  const data = load(input);
  const items = collectTexts(data, { screens: opts.screens }).map((it) => ({ ...it, to: '' }));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(items, null, 2) + '\n');
  const voice = items.filter((i) => i.kind === 'voice').length;
  console.log(`${items.length} strings (${voice} narration) → ${out}. Fill in each "to", then run translate.`);
}

function cmdTranslate(input, file, out, opts) {
  const data = load(input);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = Array.isArray(raw) ? Object.fromEntries(raw.filter((r) => r && r.to).map((r) => [r.text, r.to])) : raw;
  const wanted = collectTexts(data, { screens: opts.screens });
  const missing = wanted.filter((w) => !map[w.text]);
  const n = applyTranslations(data, map, { screens: opts.screens });
  if (opts.lang) data.manifest.lang = opts.lang;
  save(data, out);
  console.log(`Translated ${n} occurrence(s) → ${out}`);
  if (missing.length) {
    console.log(`${missing.length} string(s) had no translation and were kept, e.g.:`);
    for (const m of missing.slice(0, 10)) console.log('  ' + JSON.stringify(m.text));
  }
  if (data.manifest.steps.some((s) => s.narration)) console.log('Voice clips were removed (they were in the original language). Generate new ones: node tools/demo.mjs voice ' + out);
}

// ElevenLabs key: ELEVENLABS_API_KEY, else a .env file next to the demo (or up to 4 folders up), else in the current folder.
function findElevenLabsKey(input) {
  if (process.env.ELEVENLABS_API_KEY) return { key: process.env.ELEVENLABS_API_KEY, from: 'ELEVENLABS_API_KEY' };
  const dirs = [];
  for (let d = input ? path.dirname(path.resolve(input)) : null, i = 0; d && i < 5; i++) {
    dirs.push(d);
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  dirs.push(process.cwd());
  for (const dir of [...new Set(dirs)]) {
    for (const name of ['.env', '.env.local', 'elevenlabs.env']) {
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) continue;
      const env = parseEnv(fs.readFileSync(f, 'utf8'));
      const key = env.ELEVENLABS_API_KEY || env.XI_API_KEY || env.ELEVEN_API_KEY;
      if (key) return { key, from: f };
    }
  }
  throw new Error('No ElevenLabs API key found. Set ELEVENLABS_API_KEY, or put a .env file next to the demo containing:\n  ELEVENLABS_API_KEY=your_key');
}

async function cmdVoices(input) {
  const { key, from } = findElevenLabsKey(input);
  console.error(`Using the ElevenLabs key from ${from}`);
  for (const v of await listVoices(key)) console.log(`${v.id}  ${v.name.padEnd(24)} ${v.description}`);
}

// Voice every narrated step with ElevenLabs text-to-speech (clips embedded in the demo).
async function cmdVoice(input, out, opts) {
  const data = load(input);
  const { key, from } = findElevenLabsKey(input);
  console.log(`Using the ElevenLabs key from ${from}`);
  const m = data.manifest;
  let voiceId = opts.voice || (m.voiceover && m.voiceover.voiceId);
  let voiceName = '';
  if (!voiceId || !/^[A-Za-z0-9]{16,}$/.test(voiceId)) {
    const voices = await listVoices(key);
    const want = (voiceId || '').toLowerCase();
    const v = want ? voices.find((x) => x.name.toLowerCase() === want) || voices.find((x) => x.name.toLowerCase().startsWith(want)) : voices[0];
    if (!v) throw new Error(`No voice called "${voiceId}". List them with: node tools/demo.mjs voices`);
    voiceId = v.id; voiceName = v.name;
  }
  const model = opts.model || (m.voiceover && m.voiceover.model) || DEFAULT_TTS_MODEL;
  const lang = opts.lang || m.lang || '';
  const sameVoice = m.voiceover && m.voiceover.voiceId === voiceId && m.voiceover.model === model;
  const steps = m.steps;
  const has = (s) => s.voice && data.assets[s.voice] && s.voiceText === s.narration;
  const { voiced } = await voiceSteps(steps, {
    key, voiceId, model, languageCode: lang,
    skip: (i) => !opts.force && sameVoice && has(steps[i]),
    onClip: (i, clip) => {
      const s = steps[i];
      if (s.voice) delete data.assets[s.voice];
      const id = nextAssetId(data.assets);
      data.assets[id] = `data:${clip.mime};base64,${clip.base64}`;
      s.voice = id; s.voiceMs = clip.ms; s.voiceText = s.narration;
    },
    onProgress: (d, t) => process.stdout.write(`\rVoicing ${d}/${t}…`),
  });
  if (voiced) process.stdout.write('\n');
  for (const s of steps) if (s.voice && !s.narration) { delete data.assets[s.voice]; delete s.voice; delete s.voiceMs; delete s.voiceText; }
  m.voiceover = { voiceId, ...(voiceName ? { name: voiceName } : m.voiceover && m.voiceover.voiceId === voiceId ? { name: m.voiceover.name } : {}), model };
  if (m.settings) m.settings.voice = true;
  const target = out || input;
  save(data, target);
  const total = steps.filter((s) => s.voice).length;
  const secs = steps.reduce((n, s) => n + (s.voice ? s.voiceMs || 0 : 0), 0) / 1000;
  console.log(`Voiced ${voiced} step(s) (${total} with voice, ${secs.toFixed(0)} s of speech) → ${target}`);
}

// ------------------------------------------------------------------ main
const argv = process.argv.slice(2);
const flags = { json: false, substring: false, min: 2, screens: true, lang: '' };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') flags.json = true;
  else if (a === '--substring') flags.substring = true;
  else if (a === '--min') flags.min = +argv[++i];
  else if (a === '--no-screens') flags.screens = false;
  else if (a === '--lang') flags.lang = argv[++i];
  else if (a === '--voice') flags.voice = argv[++i];
  else if (a === '--model') flags.model = argv[++i];
  else if (a === '--force') flags.force = true;
  else pos.push(a);
}
const [cmd, ...args] = pos;
// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set at startup (Node ≥ 22.21).
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY && (cmd === 'voice' || cmd === 'voices')) {
  const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status == null ? 1 : r.status);
}
const need = (n, usage) => { if (args.length < n) { console.error('Usage: node tools/demo.mjs ' + usage); process.exit(1); } };

try {
  switch (cmd) {
    case 'info': need(1, 'info <demo.html|dir>'); cmdInfo(args[0]); break;
    case 'unpack': need(2, 'unpack <demo.html> <dir>'); save(load(args[0]), args[1]); console.log(`Unpacked → ${args[1]}/`); break;
    case 'pack': need(2, 'pack <dir> <out.html>'); save(load(args[0]), args[1]); console.log(`Packed → ${args[1]}`); break;
    case 'strings': need(1, 'strings <demo.html|dir> [--json] [--min N]'); cmdStrings(args[0], flags); break;
    case 'replace': need(3, 'replace <demo.html|dir> <map.json> <out.html|dir> [--substring]'); cmdReplace(args[0], args[1], args[2], flags); break;
    case 'texts': need(2, 'texts <demo.html|dir> <texts.json> [--no-screens]'); cmdTexts(args[0], args[1], flags); break;
    case 'translate': need(3, 'translate <demo.html|dir> <texts.json> <out.html|dir> [--lang xx] [--no-screens]'); cmdTranslate(args[0], args[1], args[2], flags); break;
    case 'voices': await cmdVoices(args[0]); break;
    case 'voice': need(1, 'voice <demo.html|dir> [out] [--voice name|id] [--model m] [--lang xx] [--force]'); await cmdVoice(args[0], args[1], flags); break;
    case 'upgrade': need(1, 'upgrade <demo.html> [out.html]'); save(load(args[0]), args[1] || args[0]); console.log('Player upgraded.'); break;
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
