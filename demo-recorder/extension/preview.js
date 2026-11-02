// Preview a recording straight from IndexedDB (extension pages can't run the
// exported file's inline scripts, so the player is loaded as a normal script).
import { buildDemoData } from './lib/build.js';

const id = location.hash.slice(1);
const data = await buildDemoData(id);
window.DEMO_SOURCE = {
  manifest: data.manifest,
  assets: data.assets,
  screen: (sid) => data.screens[sid] || '',
  css: (key) => data.css[key] || '',
};
const s = document.createElement('script');
s.src = 'player/player.js';
document.body.appendChild(s);
