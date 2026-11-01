// End-to-end test: load the extension in Chromium, record a session on the sample app,
// export it, then replay the exported file and check the player reaches the end.
//   node test/e2e.mjs [outDir]
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const APP = path.join(ROOT, 'examples', 'sample-app');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'demo-recorder-e2e'));
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, msg) => { if (!c) throw new Error('Assertion failed: ' + msg); console.log('  ✓ ' + msg); };

const server = http.createServer((req, res) => {
  const p = path.join(APP, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const type = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(f)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${server.address().port}/`;

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-profile-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1280, height: 800 },
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  console.log('Extension', extId);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(appUrl);
  await page.waitForSelector('user-chip');

  const ext = await ctx.newPage();
  await ext.goto(`chrome-extension://${extId}/review.html`);
  const tabId = await ext.evaluate(async (url) => (await chrome.tabs.query({ url: url + '*' }))[0].id, appUrl);
  const r = await ext.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'start', tabId }), tabId);
  assert(!r.error, 'recording started ' + (r.error || ''));

  await page.bringToFront();
  await sleep(600);
  await page.click('#search');
  await page.keyboard.type('glob', { delay: 40 });
  await sleep(900);
  await page.keyboard.press('Escape');
  await page.fill('#search', '');
  await page.dispatchEvent('#search', 'input');
  await sleep(1500);
  await page.click('#new');
  await sleep(1200);
  await page.click('input[name=deal]');
  await page.keyboard.type('Enterprise rollout', { delay: 25 });
  await page.click('input[name=company]');
  await page.keyboard.type('Stark Industries', { delay: 25 });
  await page.click('input[name=amount]');
  await page.keyboard.type('$250,000', { delay: 25 });
  await page.click('button[type=submit]');
  await sleep(1800);
  await page.mouse.move(700, 700);
  await page.mouse.wheel(0, 120);
  await page.hover('#activity');
  await page.mouse.wheel(0, 200);
  await sleep(1200);

  const state = await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'getState' }));
  console.log('  steps while recording:', state.steps);
  const sessionId = state.state.sessionId;
  await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
  await sleep(500);

  const result = await ext.evaluate(async (id) => {
    const { buildDemoHtml, loadSession } = await import('./lib/build.js');
    const { steps, screens } = await loadSession(id);
    const { html, stats, data } = await buildDemoHtml(id, { inline: true });
    return { html, stats, raw: { steps: steps.map((s) => s.type), screens: screens.length }, exported: { steps: data.manifest.steps.length, screens: Object.keys(data.screens).length } };
  }, sessionId);
  console.log('  raw steps:', result.raw.steps.join(', '));
  console.log(`  raw screens: ${result.raw.screens} → exported screens: ${result.exported.screens}, assets ${result.stats.inlined}/${result.stats.total}`);
  const file = path.join(OUT, 'sample.demo.html');
  fs.writeFileSync(file, result.html);
  console.log('  wrote', file, (result.html.length / 1024).toFixed(0) + ' KB');

  const types = result.raw.steps;
  assert(types[0] === 'start', 'first step is start');
  assert(types.filter((t) => t === 'click').length >= 5, 'clicks captured');
  assert(types.filter((t) => t === 'type').length >= 4, 'typing captured');
  assert(types.includes('key'), 'Escape key captured');
  assert(types.includes('scroll'), 'scroll captured');
  assert(types.includes('change'), 'DOM change captured');
  assert(types[types.length - 1] === 'end', 'last step is end');
  assert(result.exported.screens < result.raw.screens, 'identical screens deduplicated');
  assert(result.html.includes('Stark Industries'), 'typed text present');
  const tags = (result.html.split('<script id="demo-player">')[0]).match(/<script\b[^>]*>/g);
  assert(tags.every((t) => /type="(application\/json|text\/html|text\/css)"/.test(t)), 'only the player is executable');
  assert(!/<script\b/i.test(result.html.match(/<script type="text\/html"[\s\S]*?<\/script>/g).map((s) => s.slice(30, -9)).join('')), 'screens contain no <script>');
  assert(/shadowrootmode="open"/.test(result.html), 'shadow DOM serialized');
  assert(/\.kpi b \{ color: rgb\(67, 56, 202\); \}|\.kpi b \{ color: #4338ca; \}/.test(result.html), 'CSSOM-inserted rule captured');
  assert(result.stats.inlined >= 1, 'assets inlined');

  // ---- replay the exported file
  const player = await ctx.newPage();
  player.on('pageerror', (e) => errors.push('player: ' + e.message));
  await player.setViewportSize({ width: 1440, height: 900 });
  await player.goto('file://' + file + '?speed=4');
  await player.waitForFunction(() => window.demoPlayer && document.querySelector('.dp-frame.on').contentDocument.body);
  await player.screenshot({ path: path.join(OUT, 'player-0.png') });
  await player.evaluate(() => window.demoPlayer.play());
  const n = await player.evaluate(() => window.demoPlayer.steps.length);
  let shot = 1;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await sleep(1500);
    await player.screenshot({ path: path.join(OUT, `player-${shot++}.png`) });
    const s = await player.evaluate(() => ({ i: window.demoPlayer.index, p: window.demoPlayer.playing }));
    if (!s.p && s.i >= n) break;
  }
  const fin = await player.evaluate(() => window.demoPlayer.index);
  assert(fin >= n, `player reached the end (${fin}/${n})`);
  const typed = await player.evaluate(() => {
    const d = document.querySelector('.dp-frame.on').contentDocument;
    return d.body.innerText;
  });
  assert(typed.includes('Stark Industries'), 'final screen shows created deal');
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));
  console.log('\nAll good. Screenshots in', OUT);
} finally {
  await ctx.close();
  server.close();
}
