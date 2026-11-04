// Import an exported .demo.html back into a recording (to share demos between users).
// Pure: returns the records to store; the caller writes them to IndexedDB.
import { parseDemo, FORMAT_VERSION } from './format.js';

const STEP_FIELDS = ['type', 'target', 'x', 'y', 'from', 'text', 'key', 'top', 'left', 'url', 'label', 'note', 'hold', 'zoom', 'narration', 'narrationEnd', 'duration', 'voice', 'voiceMs', 'voiceText', 'highlight'];

function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// existingCss(key) → stored text or undefined; used to avoid overwriting shared stylesheets.
export async function importDemo(html, { sessionId, now = Date.now(), existingCss = async () => undefined } = {}) {
  let parsed;
  try {
    parsed = parseDemo(html);
  } catch {
    throw new Error("This file isn't a Demo Recorder export (no demo data found).");
  }
  const { manifest, screens: rawScreens, css: rawCss, assets } = parsed;
  if (!manifest || !Array.isArray(manifest.steps)) throw new Error("This file isn't a Demo Recorder export (no steps found).");
  const warnings = [];
  if ((manifest.version || 1) > FORMAT_VERSION) {
    warnings.push('Made with a newer version of Demo Recorder: update the extension if something looks wrong.');
  }

  // Stylesheets live in a store shared by all recordings: never overwrite a different text.
  const cssRename = {};
  const css = {};
  for (const [key, text] of Object.entries(rawCss || {})) {
    const have = await existingCss(key);
    const k = have === undefined || have === text ? key : key + 'i' + hash(text);
    if (k !== key) cssRename[key] = k;
    css[k] = text;
  }
  const fixCss = (h) => (Object.keys(cssRename).length
    ? h.replace(/data-demo-css="([^"]+)"/g, (m, k) => `data-demo-css="${cssRename[k] || k}"`)
    : h);

  const prefix = sessionId.slice(0, 8) + '-';
  const screens = [];
  const remap = {};
  for (const [sid, meta] of Object.entries(manifest.screens || {})) {
    if (rawScreens[sid] == null) continue;
    remap[sid] = prefix + sid;
    screens.push({
      id: prefix + sid,
      sessionId,
      html: fixCss(rawScreens[sid]),
      url: (meta && meta.url) || '',
      title: (meta && meta.title) || '',
      viewport: (meta && meta.viewport) || manifest.viewport,
      t: now,
    });
  }

  const steps = [];
  for (const st of manifest.steps) {
    if (!st || !remap[st.screen]) continue;
    const o = { sessionId, screen: remap[st.screen], t: now + (Number(st.t) || 0) };
    for (const k of STEP_FIELDS) if (st[k] !== undefined) o[k] = st[k];
    steps.push(o);
  }
  if (!steps.length) throw new Error('This demo has no steps to import.');

  const firstUrl = (screens[0] && screens[0].url) || '';
  const session = {
    id: sessionId,
    title: (manifest.title || 'Imported demo') + ' (imported)',
    url: firstUrl,
    createdAt: now,
    settings: manifest.settings || {},
    imported: { from: manifest.createdAt || null, at: now },
    assets: assets || {},
  };
  if (manifest.lang) session.lang = manifest.lang;
  if (manifest.voiceover) session.voiceover = manifest.voiceover;
  return { session, screens, steps, css, warnings };
}
