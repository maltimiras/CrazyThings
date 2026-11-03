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
  args: ['--window-size=1280,900', '--screen-info={1920x1200}',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', // fake microphone for narration
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: null, // real window sizes, so the recording-size feature can resize the window
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

  // ---- export options set through the review page UI
  await ext.goto(`chrome-extension://${extId}/review.html#${sessionId}`);
  await ext.waitForSelector('[data-setting=controls]');
  await ext.selectOption('[data-setting=autoStart]', 'true');
  await ext.selectOption('[data-setting=background]', 'light');
  await ext.selectOption('[data-setting=speed]', '2');
  for (const k of ['controls', 'browserFrame', 'showKeys']) await ext.uncheck(`[data-setting=${k}]`);
  await ext.check('[data-setting=loop]');
  await sleep(300);
  const opt = await ext.evaluate(async (id) => {
    const { buildDemoHtml } = await import('./lib/build.js');
    const { html, data } = await buildDemoHtml(id, { inline: false });
    return { html, settings: data.manifest.settings };
  }, sessionId);
  const s2 = opt.settings;
  assert(s2.autoStart === true && s2.background === 'light' && s2.speed === 2 && s2.loop === true &&
    s2.controls === false && s2.browserFrame === false && s2.showKeys === false && s2.cursor === true,
    'review-page options saved into the export ' + JSON.stringify(s2));
  const file2 = path.join(OUT, 'options.demo.html');
  fs.writeFileSync(file2, opt.html);
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push('options: ' + e.message));
  await p2.goto('file://' + file2);
  await p2.waitForFunction(() => window.demoPlayer);
  await sleep(1500);
  const ui = await p2.evaluate(() => ({
    playing: window.demoPlayer.playing,
    controls: getComputedStyle(document.querySelector('.dp-controls')).display,
    bar: getComputedStyle(document.querySelector('.dp-bar')).display,
    cover: document.querySelector('.dp-cover').hidden,
    light: document.documentElement.classList.contains('dp-bg-light'),
  }));
  await p2.screenshot({ path: path.join(OUT, 'options.png') });
  assert(ui.playing && ui.cover, 'autoStart plays without a Play button');
  assert(ui.controls === 'none' && ui.bar === 'none' && ui.light, 'control bar and browser frame hidden, light background');
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));

  // ---- auto-zoom, switched off for the first click through the per-step selector
  await ext.check('[data-setting=zoom]');
  await ext.selectOption('[data-setting=zoomLevel]', '2.2');
  await ext.selectOption('#steps td.z select >> nth=0', 'off');
  await sleep(300);
  const zhtml = await ext.evaluate(async (id) => {
    const { buildDemoHtml } = await import('./lib/build.js');
    return (await buildDemoHtml(id, { inline: false })).html;
  }, sessionId);
  const file3 = path.join(OUT, 'zoom.demo.html');
  fs.writeFileSync(file3, zhtml);
  const p3 = await ctx.newPage();
  p3.on('pageerror', (e) => errors.push('zoom: ' + e.message));
  await p3.goto('file://' + file3 + '?autoplay=0&speed=1');
  await p3.bringToFront(); // background tabs throttle requestAnimationFrame
  await p3.waitForFunction(() => window.demoPlayer);
  const zinfo = await p3.evaluate(() => {
    const st = window.demoPlayer.steps;
    const clicks = st.map((s, i) => (s.type === 'click' ? i : -1)).filter((i) => i >= 0);
    return { off: clicks[0], offZoom: st[clicks[0]].zoom, on: clicks[1], change: st.findIndex((s, i) => s.type === 'change' && i > clicks[1]), };
  });
  assert(zinfo.offZoom === false, 'per-step zoom off saved into the export');
  // Run one step and record the largest zoom scale seen while it is the current step.
  const maxScale = (i) => p3.evaluate((i) => new Promise((res) => {
    const z = document.querySelector('.dp-zoom');
    let max = 1;
    window.demoPlayer.jump(i, true);
    const t0 = performance.now();
    (function tick() {
      if (window.demoPlayer.index === i) max = Math.max(max, new DOMMatrix(getComputedStyle(z).transform).a);
      if (window.demoPlayer.index !== i && performance.now() - t0 > 200) { window.demoPlayer.pause(); return res(+max.toFixed(2)); }
      if (performance.now() - t0 > 8000) { window.demoPlayer.pause(); return res(+max.toFixed(2)); }
      requestAnimationFrame(tick);
    })();
  }), i);
  const sOn = await maxScale(zinfo.on);
  await p3.evaluate((i) => { window.demoPlayer.jump(i, true); }, zinfo.on);
  await sleep(1100);
  await p3.screenshot({ path: path.join(OUT, 'zoom-in.png') });
  await p3.evaluate(() => window.demoPlayer.pause());
  const sOff = await maxScale(zinfo.off);
  assert(Math.abs(sOn - 2.2) < 0.05, `click step zooms to 2.2× (saw ${sOn}×)`);
  assert(sOff === 1, `step with zoom off stays at 1× (saw ${sOff}×)`);
  // Play from the zoomed click into the following page update; record the lowest scale during the update.
  const afterChange = await p3.evaluate((i) => new Promise((res) => {
    const z = document.querySelector('.dp-zoom');
    let min = 99;
    window.demoPlayer.jump(i - 1, true);
    const t0 = performance.now();
    (function tick() {
      const k = window.demoPlayer.index;
      if (k === i) min = Math.min(min, new DOMMatrix(getComputedStyle(z).transform).a);
      if (k > i || performance.now() - t0 > 10000) { window.demoPlayer.pause(); return res(+min.toFixed(3)); }
      requestAnimationFrame(tick);
    })();
  }), zinfo.change);
  assert(Math.abs(afterChange - 1) < 0.01, `zooms back out on a page update (scale ${afterChange})`);
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));

  // ---- recording size: resize the window so the page area is exactly 1100×720, record, restore
  // (uses a tab opened by Chrome itself: pages created by Playwright have their viewport pinned)
  const sizeTab = await ext.evaluate(async (url) => {
    const t = await chrome.tabs.create({ url, active: true });
    for (let i = 0; i < 50 && (await chrome.tabs.get(t.id)).status !== 'complete'; i++) await new Promise((r) => setTimeout(r, 100));
    const w = await chrome.windows.get(t.windowId);
    return { id: t.id, windowId: t.windowId, width: w.width, height: w.height };
  }, appUrl);
  const tooBig = await ext.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'resize', tabId, w: 5000, h: 3000 }), sizeTab.id);
  assert(!tooBig.error && tooBig.warnings.length === 1 && /doesn't fit/.test(tooBig.warnings[0]),
    'a size larger than the screen gives a warning, not an error: ' + (tooBig.error || tooBig.warnings[0]));
  const rs = await ext.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'start', tabId, size: { w: 1100, h: 720 }, restore: true }), sizeTab.id);
  assert(!rs.error && rs.resized && rs.resized.actual.w === 1100 && rs.resized.actual.h === 720,
    'window resized so the page is exactly 1100×720 ' + JSON.stringify(rs.resized && rs.resized.actual || rs.error));
  await sleep(1500);
  const sizeSession = (await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'getState' }))).state.sessionId;
  await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
  await sleep(600);
  const sizeVp = await ext.evaluate(async (id) => {
    const { buildDemoData } = await import('./lib/build.js');
    return (await buildDemoData(id)).manifest.viewport;
  }, sizeSession);
  assert(sizeVp && sizeVp.w === 1100 && sizeVp.h === 720, 'export plays at the recorded size ' + JSON.stringify(sizeVp));
  const restored = await ext.evaluate((winId) => chrome.windows.get(winId).then((w) => ({ width: w.width, height: w.height })), sizeTab.windowId);
  assert(restored.width === sizeTab.width && restored.height === sizeTab.height,
    `window restored after recording (${restored.width}×${restored.height})`);

  // ---- narration: record the (fake) microphone, pause/resume, transcribe with a stubbed
  //      ElevenLabs response, export subtitles, and keep words when a step is deleted
  const narPagePromise = ctx.waitForEvent('page');
  const narTab = await ext.evaluate(async (url) => (await chrome.tabs.create({ url, active: true })).id, appUrl);
  const np = await narPagePromise;
  await np.waitForSelector('user-chip');
  const rn = await ext.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'start', tabId, narration: true }), narTab);
  assert(!rn.error && rn.state && rn.state.narration, 'narration recording started ' + JSON.stringify(rn.error || rn.warnings));
  await np.bringToFront();
  await sleep(1500);
  await np.click('#new');
  await sleep(1800);
  await np.click('input[name=deal]');
  await np.keyboard.type('Pilot', { delay: 30 });
  await sleep(1200);
  const narSession = (await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'getState' }))).state.sessionId;
  await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'pause' }));
  await sleep(1000);
  await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'resume' }));
  await sleep(1000);
  await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
  await sleep(800);
  const aud = await ext.evaluate(async (id) => {
    const { db } = await import('./lib/db.js');
    const s = await db.getSession(id);
    const b = await db.getAudioBlob(id);
    return { audio: s.audio, size: b ? b.size : 0, type: b ? b.type : '' };
  }, narSession);
  assert(aud.size > 1000 && /audio/.test(aud.type), `microphone audio stored (${aud.size} bytes, ${aud.type})`);
  assert(aud.audio.segments.length === 2 && aud.audio.duration > 4000 && aud.audio.duration < 9000,
    `pause is cut out of the audio timeline (${aud.audio.segments.length} segments, ${aud.audio.duration} ms)`);

  const rv = await ctx.newPage();
  rv.on('dialog', (d) => d.accept());
  rv.on('pageerror', (e) => errors.push('review: ' + e.message));
  await rv.goto(`chrome-extension://${extId}/review.html#${narSession}`);
  await rv.evaluate(() => chrome.storage.local.set({ elKey: 'test-key' }));
  await rv.reload();
  await rv.waitForSelector('#narr:not([hidden])');
  const ci = await rv.evaluate(async (id) => {
    const { db } = await import('./lib/db.js');
    const { stepStarts } = await import('./lib/narration.js');
    const s = await db.getSession(id);
    const steps = await db.getSteps(id);
    const st = stepStarts(steps, s.audio);
    const ci = steps.findIndex((x) => x.type === 'click');
    const w = (text, at) => ({ text, start: at, end: at + 0.25, type: 'word' });
    const words = [w('Welcome', st[0] + 0.1), w('everyone.', st[0] + 0.4), w('Create', st[ci] + 0.05), w('a', st[ci] + 0.3), w('deal.', st[ci] + 0.5)];
    const orig = window.fetch;
    window.fetch = async (url, init) => {
      if (String(url).includes('api.elevenlabs.io')) {
        window.__sent = { key: init.headers['xi-api-key'], model: init.body.get('model_id'), ts: init.body.get('timestamps_granularity'), size: init.body.get('file').size };
        return new Response(JSON.stringify({ text: 'Welcome everyone. Create a deal.', words }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return orig(url, init);
    };
    return ci;
  }, narSession);
  await rv.waitForFunction(() => !document.getElementById('transcribe').disabled);
  await rv.click('#transcribe');
  await rv.waitForFunction(() => [...document.querySelectorAll('textarea.nar')].some((t) => t.value === 'Create a deal.'), null, { timeout: 10000 });
  const sent = await rv.evaluate(() => window.__sent);
  assert(sent && sent.key === 'test-key' && sent.model === 'scribe_v2' && sent.ts === 'word' && sent.size > 1000,
    'ElevenLabs request carries the key, scribe_v2, word timestamps and the audio');
  const nar = await rv.evaluate(async (id) => {
    const { db } = await import('./lib/db.js');
    return (await db.getSteps(id)).map((s) => s.narration || '');
  }, narSession);
  assert(nar[0] === 'Welcome everyone.' && nar[ci] === 'Create a deal.' && nar.filter(Boolean).length === 2,
    'transcript sentences land on the steps they were spoken over ' + JSON.stringify(nar));

  const subHtml = await rv.evaluate(async (id) => {
    const { buildDemoHtml } = await import('./lib/build.js');
    return (await buildDemoHtml(id, { inline: false })).html;
  }, narSession);
  const file4 = path.join(OUT, 'narration.demo.html');
  fs.writeFileSync(file4, subHtml);
  const p4 = await ctx.newPage();
  p4.on('pageerror', (e) => errors.push('subtitles: ' + e.message));
  await p4.goto('file://' + file4 + '?autoplay=0');
  await p4.bringToFront();
  await p4.waitForFunction(() => window.demoPlayer);
  await p4.evaluate((i) => { window.demoPlayer.jump(i, true); }, ci);
  await p4.waitForFunction(() => document.querySelector('.dp-hud').classList.contains('has-sub'), null, { timeout: 5000 });
  const subText = await p4.evaluate(() => document.querySelector('.dp-subtitle').textContent);
  await p4.screenshot({ path: path.join(OUT, 'subtitles.png') });
  await p4.evaluate(() => window.demoPlayer.pause());
  assert(subText === 'Create a deal.', 'player shows the step narration as a subtitle');
  await p4.goto('file://' + file4 + '?autoplay=0&subs=0');
  await p4.waitForFunction(() => window.demoPlayer);
  await p4.evaluate((i) => { window.demoPlayer.jump(i, true); }, ci);
  await sleep(1200);
  const subOff = await p4.evaluate(() => document.querySelector('.dp-hud').classList.contains('has-sub'));
  await p4.evaluate(() => window.demoPlayer.pause());
  assert(!subOff, '?subs=0 hides subtitles');

  await rv.bringToFront();
  await rv.click(`#steps tr:nth-child(${ci + 1}) td.x button`);
  await sleep(400);
  const merged = await rv.evaluate(async (id) => {
    const { db } = await import('./lib/db.js');
    return (await db.getSteps(id)).map((s) => s.narration || '');
  }, narSession);
  assert(merged.includes('Welcome everyone. Create a deal.') || merged[ci - 1].endsWith('Create a deal.'),
    'deleting a step moves its narration to the previous step ' + JSON.stringify(merged.slice(0, ci + 1)));
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));
  console.log('\nAll good. Screenshots in', OUT);
} finally {
  await ctx.close();
  server.close();
}
