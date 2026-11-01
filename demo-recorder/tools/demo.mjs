#!/usr/bin/env node
// demo.mjs — inspect, unpack, personalize and repack Demo Recorder exports.
// No dependencies. Node 18+.
//
//   node tools/demo.mjs info     <demo.html|dir>
//   node tools/demo.mjs unpack   <demo.html> <dir>
//   node tools/demo.mjs pack     <dir> <out.html>
//   node tools/demo.mjs strings  <demo.html|dir> [--json] [--min N]
//   node tools/demo.mjs replace  <demo.html|dir> <map.json> <out.html|dir> [--substring]
//   node tools/demo.mjs upgrade  <demo.html> [out.html]      (re-pack with the latest player)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleDemo, parseDemo } from '../extension/lib/format.js';

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
    fs.writeFileSync(out, assembleDemo({ ...data, ...readPlayer() }));
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

// ------------------------------------------------------------------ text helpers
const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const escText = (s) => s.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Attributes that never hold user-visible data. Everything else (value, placeholder, title,
// alt, aria-label, custom-element props like name="Jane Cooper", data-* labels…) is treated as text.
const SKIP_ATTRS = new RegExp('^(' + [
  'class', 'id', 'style', 'src', 'srcset', 'srcdoc', 'href', 'xlink:href', 'action', 'for', 'type', 'rel', 'role',
  'lang', 'dir', 'tabindex', 'xmlns(:\\w+)?', 'viewbox', 'd', 'points', 'transform', 'fill', 'stroke', 'stroke-[\\w-]+',
  'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'x2', 'y1', 'y2', 'offset', 'media', 'sizes',
  'aria-(hidden|controls|labelledby|describedby|owns|expanded|selected|checked|haspopup)', 'data-demo-[\\w-]+',
  'shadowrootmode', 'slot', 'part', 'autocomplete', 'inputmode', 'charset', 'http-equiv', 'crossorigin', 'loading',
].join('|') + ')$', 'i');
const TOKEN_RE = /(<style\b[^>]*>[\s\S]*?<\/style>)|(<[^>]+>)|([^<]+)/gi;
const ATTR_RE = /(\s([^\s="'>\/]+)=")([^"]*)(")/g;

function visitHtml(html, onText, onAttr) {
  return html.replace(TOKEN_RE, (m, style, tag, text) => {
    if (style) return style;
    if (tag) {
      if (!onAttr || tag[1] === '/' || tag[1] === '!') return tag;
      return tag.replace(ATTR_RE, (mm, a, name, v, b) => (SKIP_ATTRS.test(name) || !v ? mm : a + onAttr(v, name) + b));
    }
    return onText ? onText(text) : text;
  });
}

function stripHead(html) {
  // ignore <head> (title handled separately) – keeps strings output focused on visible UI
  return html.replace(/<head\b[\s\S]*?<\/head>/i, '');
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
    const note = s.note ? `   📝 ${s.note}` : '';
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
    for (const k of ['text', 'from', 'label', 'note']) if (s[k]) add(String(s[k]), `step${s.id}.${k}`);
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
  for (const s of m.steps) for (const k of ['text', 'from', 'label', 'note', 'url']) if (typeof s[k] === 'string') s[k] = R.raw(s[k]);
  save(data, out);
  console.log(`Replaced ${R.stats.hits} occurrence(s) → ${out}`);
}

// ------------------------------------------------------------------ main
const argv = process.argv.slice(2);
const flags = { json: false, substring: false, min: 2 };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') flags.json = true;
  else if (a === '--substring') flags.substring = true;
  else if (a === '--min') flags.min = +argv[++i];
  else pos.push(a);
}
const [cmd, ...args] = pos;
const need = (n, usage) => { if (args.length < n) { console.error('Usage: node tools/demo.mjs ' + usage); process.exit(1); } };

try {
  switch (cmd) {
    case 'info': need(1, 'info <demo.html|dir>'); cmdInfo(args[0]); break;
    case 'unpack': need(2, 'unpack <demo.html> <dir>'); save(load(args[0]), args[1]); console.log(`Unpacked → ${args[1]}/`); break;
    case 'pack': need(2, 'pack <dir> <out.html>'); save(load(args[0]), args[1]); console.log(`Packed → ${args[1]}`); break;
    case 'strings': need(1, 'strings <demo.html|dir> [--json] [--min N]'); cmdStrings(args[0], flags); break;
    case 'replace': need(3, 'replace <demo.html|dir> <map.json> <out.html|dir> [--substring]'); cmdReplace(args[0], args[1], args[2], flags); break;
    case 'upgrade': need(1, 'upgrade <demo.html> [out.html]'); save(load(args[0]), args[1] || args[0]); console.log('Player upgraded.'); break;
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
