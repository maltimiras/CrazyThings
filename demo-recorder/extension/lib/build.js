// Turns a recorded session (IndexedDB) into demo data / a standalone HTML file.
import { db } from './db.js';
import { FORMAT_VERSION, assembleDemo, stripTargets, insertTargets } from './format.js';

export const DEFAULT_SETTINGS = {
  mode: 'autoplay',      // 'autoplay' | 'guided' (viewer clicks hotspots to advance)
  autoStart: false,      // start playing as soon as the file opens (no Play button)
  speed: 1,
  loop: false,           // restart from the beginning when finished
  controls: true,        // bottom control bar (play/pause, timeline, speed…)
  browserFrame: true,    // draw a fake browser window with the URL bar
  cursor: true,          // animated mouse cursor and click ripples
  showKeys: true,        // keycap overlay for key presses (Enter, Esc, Alt+K…)
  captions: true,        // show step captions (notes) as callouts
  background: 'dark',    // 'dark' | 'light' | 'none' (white, no shadow — for embedding)
};

export function describeStep(s) {
  switch (s.type) {
    case 'start': return 'Start · ' + (s.url || '');
    case 'navigate': return 'Page load · ' + (s.url || '');
    case 'click': return `Click “${s.label || 'element'}”`;
    case 'type': return `Type “${s.text || ''}”`;
    case 'key': return `Press ${s.key}`;
    case 'scroll': return `Scroll to ${s.top}px`;
    case 'change': return 'Page updates';
    case 'end': return 'End';
    default: return s.type;
  }
}

export async function loadSession(sessionId) {
  const [session, steps, screens] = await Promise.all([
    db.getSession(sessionId), db.getSteps(sessionId), db.getScreens(sessionId),
  ]);
  return { session, steps, screens };
}

// Build manifest + screens + css (no assets yet).
export async function buildDemoData(sessionId) {
  const { session, steps, screens: rawScreens } = await loadSession(sessionId);
  if (!session) throw new Error('Recording not found');
  const byId = new Map(rawScreens.map((s) => [s.id, s]));
  const groups = new Map(); // normalized html -> { id, norm, stamps, meta }
  const remap = {};
  let n = 0;
  for (const st of steps) {
    if (!st.screen || remap[st.screen]) continue;
    const scr = byId.get(st.screen);
    if (!scr) continue;
    const { norm, stamps } = stripTargets(scr.html);
    let g = groups.get(norm);
    if (!g) {
      g = { id: 's' + (++n), norm, stamps: new Map(), meta: { url: scr.url, title: scr.title, viewport: scr.viewport } };
      groups.set(norm, g);
    }
    for (const [off, ids] of stamps) {
      if (!g.stamps.has(off)) g.stamps.set(off, new Set());
      ids.forEach((i) => g.stamps.get(off).add(i));
    }
    remap[scr.id] = g.id;
  }

  const screens = {};
  const screenMeta = {};
  for (const g of groups.values()) {
    screens[g.id] = insertTargets(g.norm, g.stamps);
    screenMeta[g.id] = g.meta;
  }

  const t0 = steps.length ? steps[0].t : 0;
  const outSteps = [];
  for (const st of steps) {
    if (!st.screen || !remap[st.screen]) continue;
    const o = { id: outSteps.length + 1, type: st.type, screen: remap[st.screen] };
    for (const k of ['target', 'x', 'y', 'from', 'text', 'key', 'top', 'left', 'url', 'label', 'note', 'hold']) {
      if (st[k] !== undefined && st[k] !== null && st[k] !== '') o[k] = st[k];
    }
    o.t = st.t - t0;
    outSteps.push(o);
  }

  const css = {};
  for (const html of Object.values(screens)) {
    for (const m of html.matchAll(/data-demo-css="([^"]+)"/g)) {
      if (!(m[1] in css)) css[m[1]] = (await db.getCss(m[1])) || '';
    }
  }

  const firstMeta = screenMeta.s1 || { viewport: { w: 1280, h: 800 } };
  const manifest = {
    format: 'demo-recorder',
    version: FORMAT_VERSION,
    title: session.title,
    createdAt: new Date(session.createdAt).toISOString(),
    viewport: firstMeta.viewport,
    settings: { ...DEFAULT_SETTINGS, ...(session.settings || {}) },
    screens: screenMeta,
    steps: outSteps,
  };
  return { manifest, screens, css, assets: {} };
}

// ---------------------------------------------------------------------------
// Asset inlining: fetch images/fonts (with the user's cookies) and store them once
// in the asset table; screens/css reference them as demo-asset:aN.

const decodeAttr = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const CSS_URL_RE = /url\(\s*(?:&quot;|"|')?([^)"']*?)(?:&quot;|"|')?\s*\)/g;
const TAG_RE = /<(img|image|video|input|link|feImage|audio|source)\b[^>]*>/gi;
const ATTR_RE = /(\s(?:src|href|xlink:href|poster)=")([^"]*)(")/g;

function resolve(u, base) {
  u = decodeAttr(u.trim());
  if (!u || /^(data:|blob:|#|demo-asset:|javascript:|mailto:|about:)/i.test(u)) return null;
  try { return new URL(u, base).href; } catch { return null; }
}

function tagEligible(tag) {
  const name = tag.slice(1).split(/[\s>]/)[0].toLowerCase();
  if (name === 'link') return /rel="[^"]*icon/i.test(tag);
  if (name === 'input') return /type="image"/i.test(tag);
  return true;
}

function forEachUrl(html, base, cb) {
  // cb(resolvedUrl, rawUrl) -> replacement raw or undefined
  let out = html.replace(TAG_RE, (tag) => {
    if (!tagEligible(tag)) return tag;
    return tag.replace(ATTR_RE, (m, pre, val, post) => {
      const abs = resolve(val, base);
      if (!abs) return m;
      const rep = cb(abs);
      return rep ? pre + rep + post : m;
    });
  });
  out = out.replace(CSS_URL_RE, (m, val) => {
    const abs = resolve(val, base);
    if (!abs) return m;
    const rep = cb(abs);
    return rep ? `url(${rep})` : m;
  });
  return out;
}

const blobToDataUrl = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

export async function inlineAssets(data, { onProgress, maxBytes = 8 * 1024 * 1024 } = {}) {
  const urls = new Set();
  const bases = {};
  for (const [id, html] of Object.entries(data.screens)) {
    const b = html.match(/<base href="([^"]*)"/);
    bases[id] = b ? decodeAttr(b[1]) : (data.manifest.screens[id] || {}).url;
    forEachUrl(html, bases[id], (u) => { urls.add(u); });
  }
  for (const text of Object.values(data.css)) forEachUrl(text, undefined, (u) => { urls.add(u); });

  const list = [...urls];
  const map = new Map();
  const assets = {};
  let done = 0;
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const url = list[i++];
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size <= maxBytes) {
            const id = 'a' + (map.size + 1);
            map.set(url, id);
            assets[id] = await blobToDataUrl(blob);
          }
        }
      } catch { /* leave remote URL in place */ }
      done++;
      if (onProgress) onProgress(done, list.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  const sub = (u) => (map.has(u) ? 'demo-asset:' + map.get(u) : undefined);
  for (const id of Object.keys(data.screens)) data.screens[id] = forEachUrl(data.screens[id], bases[id], sub);
  for (const k of Object.keys(data.css)) data.css[k] = forEachUrl(data.css[k], undefined, sub);
  data.assets = assets;
  return { total: list.length, inlined: map.size };
}

export async function loadPlayer() {
  const [playerJs, playerCss] = await Promise.all([
    fetch(chrome.runtime.getURL('player/player.js')).then((r) => r.text()),
    fetch(chrome.runtime.getURL('player/player.css')).then((r) => r.text()),
  ]);
  return { playerJs, playerCss };
}

export async function buildDemoHtml(sessionId, { inline = true, onProgress } = {}) {
  const data = await buildDemoData(sessionId);
  let stats = null;
  if (inline) stats = await inlineAssets(data, { onProgress });
  const player = await loadPlayer();
  return { html: assembleDemo({ ...data, ...player }), stats, data };
}
