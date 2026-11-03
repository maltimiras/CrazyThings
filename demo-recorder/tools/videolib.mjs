// Pure helpers for tools/video.mjs (video demo → HTML demo). No ffmpeg or fs here: unit-testable.
import { wordsToPhrases, assignPhrases } from '../extension/lib/narration.js';

// Times (s) of the frames ffmpeg's showinfo filter printed ("... pts_time:12.345 ...").
export function parseShowinfo(stderr) {
  const out = [];
  for (const m of String(stderr).matchAll(/pts_time:\s*([0-9.]+)/g)) out.push(parseFloat(m[1]));
  return out;
}

// Key-frame times: always the start and the end, the scene changes (not too close to each other),
// and extra frames during long static stretches so slow changes aren't missed.
export function selectFrames(sceneTimes, duration, { minGap = 0.6, maxGap = 10, settle = 0.4 } = {}) {
  const end = Math.max(0, duration - 0.05);
  // A scene change is detected on its first frame, often mid-transition: look a bit later.
  const cand = [0, ...sceneTimes.map((t) => Math.min(end, t + settle)), end].sort((a, b) => a - b);
  const picked = [];
  for (const t of cand) {
    if (!picked.length || t - picked[picked.length - 1] >= minGap) picked.push(t);
    else if (t === end) picked[picked.length - 1] = end; // keep the true last frame
  }
  const filled = [];
  for (let i = 0; i < picked.length; i++) {
    filled.push(picked[i]);
    const next = picked[i + 1];
    if (next == null) break;
    const gap = next - picked[i];
    if (gap > maxGap) {
      const n = Math.floor(gap / maxGap);
      for (let k = 1; k <= n; k++) {
        const t = picked[i] + (gap * k) / (n + 1);
        if (next - t >= minGap) filled.push(t);
      }
    }
  }
  return filled.map((t) => Math.round(t * 1000) / 1000);
}

// CSS viewport of the recorded screen. Retina recordings (≥2400 px wide) are usually 2×.
export function guessViewport(width, height, dpr) {
  const d = dpr || (width >= 2400 ? 2 : 1);
  return { w: Math.round(width / d), h: Math.round(height / d), dpr: d };
}

// Read KEY=VALUE lines of a .env file (comments, `export`, quotes allowed).
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

export function frameName(i, t) {
  return `f${String(i + 1).padStart(3, '0')}_${t.toFixed(1).padStart(5, '0')}s.png`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Placeholder screen: the video frame as a full-page background, so the scaffold plays at once.
// Claude replaces each placeholder with real HTML that uses the shared css (data-demo-css="app").
export function placeholderScreen(assetId, frameFile, title) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title || '')}</title>` +
    '<style data-demo-css="app"></style>' +
    `<style>html,body{margin:0;height:100%}body{background:#fff url(demo-asset:${assetId}) 0 0/100% 100% no-repeat}</style>` +
    `</head><body data-demo-placeholder="${esc(frameFile)}"></body></html>`;
}

// Build the unpacked demo (manifest + placeholder screens + notes) from video.json and the transcript.
// frameAssets: asset id per frame index (e.g. ['a1', 'a2', ...]).
export function buildScaffold({ title, video, words = [], frameAssets }) {
  const frames = video.frames;
  const steps = frames.map((f, i) => ({
    id: i + 1,
    type: i === 0 ? 'start' : i === frames.length - 1 ? 'end' : 'change',
    screen: 's' + (i + 1),
    t: Math.round(f.t * 1000),
  }));
  // The video's own clock is the audio timeline: step t (ms) ↔ audio seconds.
  const audio = { segments: [{ wall: 0, at: 0 }] };
  const texts = assignPhrases(steps, audio, wordsToPhrases(words));
  steps.forEach((s, i) => { if (texts[i]) s.narration = texts[i]; });

  const screens = {};
  const screenMeta = {};
  frames.forEach((f, i) => {
    const id = 's' + (i + 1);
    screens[id] = placeholderScreen(frameAssets[i], f.file, title);
    screenMeta[id] = { url: '', title: title || '', viewport: video.viewport, frame: f.file, at: f.t };
  });

  const manifest = {
    format: 'demo-recorder',
    version: 1,
    title: title || 'Video demo',
    createdAt: new Date().toISOString(),
    viewport: video.viewport,
    settings: { mode: 'autoplay', subtitles: true, zoom: false },
    source: { video: video.source, duration: video.duration },
    screens: screenMeta,
    steps,
  };

  const lines = [
    `# ${manifest.title}: video → HTML demo`,
    '',
    `Source: \`${video.source}\` · ${video.duration.toFixed(1)} s · ${video.width}×${video.height} px → viewport ${video.viewport.w}×${video.viewport.h} (dpr ${video.viewport.dpr})`,
    '',
    '| step | type | time | screen | frame | narration |',
    '|---|---|---|---|---|---|',
    ...steps.map((s, i) => `| ${s.id} | ${s.type} | ${frames[i].t.toFixed(1)} s | ${s.screen} | frames/${frames[i].file} | ${(s.narration || '').replace(/\|/g, '\\|')} |`),
    '',
    '## Checklist',
    '- [ ] css/app.css: shared design system (colors, fonts, spacing, components)',
    '- [ ] every screens/sN.html rebuilt as HTML (no `data-demo-placeholder` left)',
    '- [ ] steps decided (click/type/scroll/key/change), targets stamped with data-demo-target',
    '- [ ] narration placed and tidied',
    '- [ ] `node tools/video.mjs compare` checked, then `node tools/demo.mjs pack`',
    '',
  ];
  return { manifest, screens, notes: lines.join('\n') };
}

// Resolve a screen for rendering outside the player (compare): shared css + embedded assets.
export function resolveScreen(html, css, assets) {
  return html
    .replace(/<style data-demo-css="([^"]+)"([^>]*)><\/style>/g, (m, k, rest) => `<style${rest}>${css[k] || ''}</style>`)
    .replace(/demo-asset:(a\d+)/g, (m, id) => assets[id] || m);
}
