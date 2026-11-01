// The exported demo file format. Shared by the extension (export) and tools/demo.mjs (Node).
//
//   <script type="application/json" id="demo-data">   manifest: settings, screens meta, steps
//   <script type="text/css"  id="css-KEY">             shared stylesheets (referenced by <style data-demo-css="KEY">)
//   <script type="text/html" id="screen-ID">           one full HTML document per screen
//   <script type="application/json" id="demo-assets"> {"a1": "data:image/png;base64,..."} referenced as demo-asset:a1
//   <script id="demo-player">                          the player
//
// Raw-text blocks are escaped so they can't terminate their <script> container.

export const FORMAT_VERSION = 1;

export const escapeRaw = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
export const unescapeRaw = (s) => s.replace(/<\\\/(script)/gi, '</$1').replace(/<\\!--/g, '<!--');

const jsonForScript = (obj, indent) =>
  JSON.stringify(obj, null, indent).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\u0021--');

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function assembleDemo({ manifest, screens, css, assets, playerJs, playerCss }) {
  const out = [];
  out.push('<!DOCTYPE html>');
  out.push('<html lang="en">');
  out.push('<head>');
  out.push('<meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push(`<title>${escHtml(manifest.title || 'Demo')}</title>`);
  out.push(`<style id="demo-player-css">\n${playerCss}\n</style>`);
  out.push('</head>');
  out.push('<body>');
  out.push('<div id="demo-root"></div>');
  out.push('<!-- ===== DEMO DATA: steps, screen metadata and settings (safe to edit) ===== -->');
  out.push(`<script type="application/json" id="demo-data">\n${jsonForScript(manifest, 2)}\n</script>`);
  out.push('<!-- ===== SHARED STYLESHEETS ===== -->');
  for (const [key, text] of Object.entries(css || {})) {
    out.push(`<script type="text/css" id="css-${key}">${escapeRaw(text)}</script>`);
  }
  out.push('<!-- ===== SCREENS: one HTML document per screen (edit text/numbers here) ===== -->');
  for (const id of Object.keys(manifest.screens || {})) {
    const html = screens[id];
    if (html == null) continue;
    out.push(`<script type="text/html" id="screen-${id}">\n${escapeRaw(html)}\n</script>`);
  }
  out.push('<!-- ===== ASSETS (images/fonts, referenced as demo-asset:ID) ===== -->');
  out.push(`<script type="application/json" id="demo-assets">${jsonForScript(assets || {})}</script>`);
  out.push('<!-- ===== PLAYER ===== -->');
  out.push(`<script id="demo-player">\n${playerJs.replace(/<\/script/gi, '<\\/script')}\n</script>`);
  out.push('</body>');
  out.push('</html>');
  return out.join('\n');
}

export function parseDemo(html) {
  const m = html.match(/<script type="application\/json" id="demo-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Not a demo file (no #demo-data block found)');
  const manifest = JSON.parse(m[1]);
  const css = {};
  for (const x of html.matchAll(/<script type="text\/css" id="css-([^"]+)">([\s\S]*?)<\/script>/g)) {
    css[x[1]] = unescapeRaw(x[2]);
  }
  const screens = {};
  for (const x of html.matchAll(/<script type="text\/html" id="screen-([^"]+)">\n?([\s\S]*?)\n?<\/script>/g)) {
    screens[x[1]] = unescapeRaw(x[2]);
  }
  const a = html.match(/<script type="application\/json" id="demo-assets">([\s\S]*?)<\/script>/);
  const assets = a ? JSON.parse(a[1]) : {};
  return { manifest, screens, css, assets };
}

// --- target stamps -----------------------------------------------------------
// Each action stamps the element it acts on with data-demo-target="tN". Screens that are
// identical apart from their stamps are merged into one screen carrying all stamps
// (space separated, matched with [data-demo-target~="tN"]).

const STAMP_RE = / data-demo-target="([^"]*)"/g;

export function stripTargets(html) {
  const stamps = [];
  let norm = '';
  let last = 0;
  for (const m of html.matchAll(STAMP_RE)) {
    norm += html.slice(last, m.index);
    stamps.push([norm.length, m[1].split(/\s+/).filter(Boolean)]);
    last = m.index + m[0].length;
  }
  norm += html.slice(last);
  return { norm, stamps };
}

export function insertTargets(norm, stampMap) {
  const offsets = [...stampMap.keys()].sort((a, b) => a - b);
  let out = '';
  let last = 0;
  for (const off of offsets) {
    out += norm.slice(last, off) + ` data-demo-target="${[...stampMap.get(off)].join(' ')}"`;
    last = off;
  }
  return out + norm.slice(last);
}
