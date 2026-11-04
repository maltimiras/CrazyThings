// Preview a recording straight from IndexedDB (extension pages can't run the
// exported file's inline scripts, so the player is loaded as a normal script).
// The URL hash is "<sessionId>" or "<sessionId>@<step>"; edits on the review page
// ('preview-refresh') reload the preview at the step it was showing.
import { buildDemoData } from './lib/build.js';

const [id, step] = location.hash.slice(1).split('@');
const data = await buildDemoData(id);
window.DEMO_SOURCE = {
  manifest: data.manifest,
  assets: data.assets,
  screen: (sid) => data.screens[sid] || '',
  css: (key) => data.css[key] || '',
};
window.DEMO_START_STEP = parseInt(step || '0', 10) || 0;
const s = document.createElement('script');
s.src = 'player/player.js';
document.body.appendChild(s);

let timer = null;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'preview-refresh' || msg.id !== id) return false;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const at = window.demoPlayer ? Math.min(window.demoPlayer.index, data.manifest.steps.length - 1) : 0;
    location.hash = `${id}@${Math.max(0, at)}`;
    location.reload();
  }, 400);
  return false;
});
