// End-to-end test: load the extension in Chromium, record a session on the sample app,
// export it, then replay the exported file and check the player reaches the end.
//   node test/e2e.mjs [outDir]
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseDemo, assembleDemo } from '../extension/lib/format.js';

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

  // ---- before any API key is saved: warn up front, and the Settings page lays out without overlaps
  const wk = await ctx.newPage();
  wk.on('pageerror', (e) => errors.push('warnings: ' + e.message));
  await wk.goto(`chrome-extension://${extId}/popup.html`);
  const narrWas = await wk.isChecked('#narration');
  if (!narrWas) await wk.check('#narration');
  await wk.waitForSelector('#nokey:not([hidden])');
  const hdrGear = await wk.evaluate(() => {
    // Long microphone names must not widen the popup; the Start button stays in view (sticky footer).
    const o = document.createElement('option');
    o.textContent = 'Default - A Very Long Microphone Name With Many Words In It (31b2:0011)';
    document.getElementById('mic').appendChild(o);
    const start = document.getElementById('start').getBoundingClientRect();
    return !!document.querySelector('header #settings') && document.body.scrollWidth <= 340 && start.bottom <= window.innerHeight;
  });
  if (!narrWas) await wk.uncheck('#narration');
  assert(hdrGear, 'popup: ⚙ Settings in the header, fixed 340px width with Start always in view, and a warning when narrating without an ElevenLabs key');
  await wk.goto(`chrome-extension://${extId}/review.html#${sessionId}`);
  await wk.waitForFunction(() => !document.getElementById('lv-warn').hidden);
  const lw = await wk.evaluate(() => ({ text: document.getElementById('lv-warn').textContent, go: document.getElementById('lv-go').disabled, voice: document.getElementById('lv-voice').disabled, top: !!document.getElementById('top-settings'), side: !!document.querySelector('.setlink') }));
  assert(/Anthropic API key/.test(lw.text) && /won't be voiced/.test(lw.text) && lw.go && lw.voice, 'Language version warns that translation needs an Anthropic key (button disabled) and voice needs ElevenLabs');
  assert(lw.top && !lw.side, '⚙ Settings is at the top right of the recordings page (no longer in the sidebar)');
  for (const [w, h] of [[1280, 800], [1600, 900]]) {
    await wk.setViewportSize({ width: w, height: h });
    await wk.goto(`chrome-extension://${extId}/review.html#settings`);
    await wk.waitForSelector('.setgrid fieldset');
    const lay = await wk.evaluate(() => {
      // Real voice lists have long descriptions: they must not widen the Voice-over box.
      document.getElementById('voice-pick').add(new Option('Alice - Clear, Engaging Educator · female, middle_aged, british, professional, informative_educational'));
      const bad = [];
      for (const fs of document.querySelectorAll('.setgrid fieldset')) {
        const f = fs.getBoundingClientRect();
        for (const c of fs.querySelectorAll('input, select, button')) {
          const r = c.getBoundingClientRect();
          if (r.left < f.left - 1 || r.right > f.right + 1) bad.push((c.id || c.dataset.pref || c.textContent).trim());
        }
      }
      for (const k of document.querySelectorAll('.setgrid .keyrow')) {
        const a = k.children[0].getBoundingClientRect();
        for (const b of [...k.children].slice(1)) { const r = b.getBoundingClientRect(); if (r.top > a.bottom - 4) bad.push('wrapped ' + (b.id || b.textContent)); }
      }
      return { bad, el: !document.getElementById('el-missing').hidden, an: !document.getElementById('an-missing').hidden, on: document.getElementById('top-settings').classList.contains('on') };
    });
    await wk.screenshot({ path: path.join(OUT, `settings-${w}.png`) });
    assert(!lay.bad.length && lay.el && lay.an && lay.on, `Settings at ${w}px: nothing spills out of its box, buttons stay next to their fields, both "not set" warnings show ` + lay.bad.join(', '));
  }
  await wk.close();

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

  // ---- popup narration setup: language, microphone list and the mic test (fake microphone)
  const ms = await ctx.newPage();
  await ms.goto(`chrome-extension://${extId}/mic-setup.html`);
  await ms.click('#allow');
  await ms.waitForFunction(() => /ready/.test(document.getElementById('msg').textContent), null, { timeout: 5000 });
  const pop = await ctx.newPage();
  pop.on('pageerror', (e) => errors.push('popup: ' + e.message));
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await pop.check('#narration');
  await pop.waitForSelector('#narrbox:not([hidden])');
  await pop.waitForFunction(() => !document.getElementById('mic').hidden && document.querySelectorAll('#mic option').length > 0, null, { timeout: 5000 });
  const micNames = await pop.$$eval('#mic option', (os) => os.map((o) => o.textContent));
  assert(micNames.length >= 1, 'popup lists the microphones: ' + micNames.join(', '));
  await pop.selectOption('#lang', 'es-ES');
  await pop.click('#testmic');
  await pop.waitForFunction(() => /Hearing you/.test(document.getElementById('micstatus').textContent), null, { timeout: 8000 });
  const lvl = await pop.$eval('#level', (el) => parseInt(el.style.width, 10) || 0);
  await sleep(1500);
  const heard = await pop.textContent('#heard');
  await pop.screenshot({ path: path.join(OUT, 'popup-mictest.png') });
  await pop.click('#testmic');
  assert(true, `mic test hears the microphone (level ${lvl}%); live words: ${heard}`);
  const saved = await pop.evaluate(() => chrome.storage.local.get(['narrationLang', 'recLive', 'recNarration']));
  assert(saved.narrationLang === 'es-ES' && saved.recLive === true && saved.recNarration === true, 'popup saves language and narration options');
  await pop.close();
  await ms.close().catch(() => {});

  // ---- narration: record the (fake) microphone, pause/resume, transcribe with a stubbed
  //      ElevenLabs response, export subtitles, and keep words when a step is deleted
  const narPagePromise = ctx.waitForEvent('page');
  const narTab = await ext.evaluate(async (url) => (await chrome.tabs.create({ url, active: true })).id, appUrl);
  const np = await narPagePromise;
  await np.waitForSelector('user-chip');
  const rn = await ext.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'start', tabId, narration: true }), narTab);
  assert(!rn.error && rn.state && rn.state.narration, 'narration recording started ' + JSON.stringify(rn.error || rn.warnings));
  const panelOpen = () => ext.evaluate(async () =>
    (await chrome.windows.getAll({ populate: true })).some((w) => (w.tabs || []).some((t) => (t.url || t.pendingUrl || '').includes('narration.html'))));
  assert(await panelOpen(), 'the Narration window opens while recording');
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
    return { audio: s.audio, setup: s.narrationSetup, size: b ? b.size : 0, type: b ? b.type : '' };
  }, narSession);
  assert(aud.size > 1000 && /audio/.test(aud.type), `microphone audio stored (${aud.size} bytes, ${aud.type})`);
  assert(aud.setup && aud.setup.micLabel && aud.setup.lang === 'es-ES' && aud.setup.live === true,
    'recording keeps the narration setup ' + JSON.stringify(aud.setup));
  assert(!(await panelOpen()), 'the Narration window closes when recording stops');
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

  // ---- a saved microphone that no longer exists falls back to the default one, with a warning
  await ext.evaluate(() => chrome.storage.local.set({ recMicId: 'no-such-device', recMicLabel: 'Old USB mic', recLive: false }));
  const rf = await ext.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'start', tabId, narration: true }), narTab);
  await sleep(800);
  await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
  await sleep(600);
  assert(!rf.error && rf.state.narration && rf.warnings.some((w) => /Old USB mic.*wasn't found/.test(w)),
    'missing microphone falls back to the default: ' + JSON.stringify(rf.error || rf.warnings));
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));

  // ---- import a shared .demo.html into the extension, re-export it and replay it
  const imp = await ctx.newPage();
  imp.on('pageerror', (e) => errors.push('import: ' + e.message));
  await imp.goto(`chrome-extension://${extId}/review.html`);
  await imp.setInputFiles('#import-file', file);
  await imp.waitForFunction(() => /Imported/.test(document.getElementById('import-msg').textContent), null, { timeout: 10000 });
  await imp.waitForSelector('#steps tr');
  const impId = await imp.evaluate(() => location.hash.slice(1));
  const impTitle = await imp.$eval('#title', (el) => el.value);
  const orig = parseDemo(fs.readFileSync(file, 'utf8'));
  const rowCount = await imp.$$eval('#steps tr', (r) => r.length);
  assert(/\(imported\)$/.test(impTitle) && rowCount === orig.manifest.steps.length,
    `imported recording opens with all ${rowCount} steps (“${impTitle}”)`);
  const re = await imp.evaluate(async (id) => {
    const { buildDemoHtml } = await import('./lib/build.js');
    const { html, data } = await buildDemoHtml(id, { inline: true });
    return { html, types: data.manifest.steps.map((s) => s.type), assets: Object.keys(data.assets).length, screens: Object.keys(data.screens).length };
  }, impId);
  assert(JSON.stringify(re.types) === JSON.stringify(orig.manifest.steps.map((s) => s.type)) &&
    re.screens === Object.keys(orig.screens).length && re.assets >= Object.keys(orig.assets).length,
    `re-export matches the original (${re.types.length} steps, ${re.screens} screens, ${re.assets} assets)`);
  const reFile = path.join(OUT, 'reimported.demo.html');
  fs.writeFileSync(reFile, re.html);
  const rp = await ctx.newPage();
  rp.on('pageerror', (e) => errors.push('reimported player: ' + e.message));
  await rp.goto('file://' + reFile + '?speed=4&autoplay=0&zoom=0');
  await rp.bringToFront();
  await rp.waitForFunction(() => window.demoPlayer);
  await rp.evaluate(() => { window.demoPlayer.play(); });
  await rp.waitForFunction(() => !window.demoPlayer.playing && window.demoPlayer.index >= window.demoPlayer.steps.length, null, { timeout: 60000 });
  assert(true, 're-exported demo replays to the end');
  await imp.bringToFront();
  await imp.setInputFiles('#import-file', path.join(ROOT, 'examples', 'northwind-pipeline.demo.html'));
  await imp.waitForFunction(() => /Imported “Pipeline · Northwind CRM/.test(document.getElementById('import-msg').textContent), null, { timeout: 10000 });
  assert(true, 'a demo personalized with the CLI imports too');
  await imp.setInputFiles('#import-file', { name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from('<html><body>hi</body></html>') });
  await imp.waitForFunction(() => document.getElementById('import-msg').className === 'bad', null, { timeout: 5000 });
  assert(/isn't a Demo Recorder export/.test(await imp.textContent('#import-msg')), 'a non-demo file is rejected with a clear message');
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));

  // ---- timing: "As recorded" pace + a per-step duration set on the review page; preview auto-refresh
  const pv = await ctx.newPage();
  pv.on('pageerror', (e) => errors.push('preview: ' + e.message));
  await pv.goto(`chrome-extension://${extId}/preview.html#${sessionId}`);
  await pv.waitForFunction(() => window.demoPlayer);
  await pv.evaluate(() => { window.__before = 1; });
  const rt = await ctx.newPage();
  await rt.goto(`chrome-extension://${extId}/review.html#${sessionId}`);
  await rt.waitForSelector('#steps td.d input');
  await rt.selectOption('[data-setting=timing]', 'recorded');
  // The page re-renders after the change: wait for the new rows (placeholder shows the recorded length).
  await rt.waitForFunction(() => { const el = document.querySelector('#steps tr:nth-child(2) td.d input'); return el && el.placeholder !== '⏱ auto'; });
  const ph = await rt.$eval('#steps tr:nth-child(2) td.d input', (el) => el.placeholder);
  await rt.fill('#steps tr:nth-child(2) td.d input', '4');
  await rt.press('#steps tr:nth-child(2) td.d input', 'Tab');
  await pv.waitForFunction(() => window.__before === undefined && window.demoPlayer, null, { timeout: 8000 });
  assert(/⏱ \d+\.\d/.test(ph), `the review page shows each step's recorded length (${ph}) and the preview reloads after an edit`);
  const tm = await rt.evaluate(async (id) => {
    const { buildDemoData } = await import('./lib/build.js');
    const d = await buildDemoData(id);
    return { timing: d.manifest.settings.timing, dur: d.manifest.steps[1].duration };
  }, sessionId);
  assert(tm.timing === 'recorded' && tm.dur === 4000, 'Pace and step duration are saved into the export ' + JSON.stringify(tm));
  await pv.close();
  await rt.close();

  // A sentence spoken over several steps stays as a subtitle until it ends; steps keep their recorded length.
  const base = parseDemo(fs.readFileSync(file, 'utf8'));
  const sid = base.manifest.steps[0].screen;
  const tman = { ...base.manifest, settings: { ...base.manifest.settings, timing: 'recorded', subtitles: true, autoStart: false, zoom: false },
    steps: [
      { id: 1, type: 'start', screen: sid, t: 0 },
      { id: 2, type: 'change', screen: sid, t: 3000, narration: 'A sentence that is spoken over two steps.', narrationEnd: 8000 },
      { id: 3, type: 'change', screen: sid, t: 3500 },
      { id: 4, type: 'end', screen: sid, t: 9000 },
    ] };
  const tfile = path.join(OUT, 'timing.demo.html');
  fs.writeFileSync(tfile, assembleDemo({ ...base, manifest: tman, playerJs: fs.readFileSync(path.join(EXT, 'player', 'player.js'), 'utf8'), playerCss: fs.readFileSync(path.join(EXT, 'player', 'player.css'), 'utf8') }));
  const tp = await ctx.newPage();
  tp.on('pageerror', (e) => errors.push('timing: ' + e.message));
  await tp.goto('file://' + tfile + '?speed=4');
  await tp.bringToFront();
  await tp.waitForFunction(() => window.demoPlayer);
  const tr = await tp.evaluate(() => new Promise((res) => {
    const sub = () => document.querySelector('.dp-hud').classList.contains('has-sub');
    const at = {}; const subAt = {}; let subOff = null; const t0 = performance.now();
    window.demoPlayer.play();
    (function tick() {
      const i = window.demoPlayer.index, now = performance.now() - t0;
      if (at[i] == null) { at[i] = now; subAt[i] = sub(); }
      if (i === 2 && !sub() && subOff == null) subOff = now;
      if (i >= 3 || now > 8000) return res({ at, subAt, subOff, pace: document.querySelector('[data-a=pace]').value });
      requestAnimationFrame(tick);
    })();
  }));
  const step3 = tr.at[3] - tr.at[2];
  assert(Math.abs(step3 - 1375) < 300, `"As recorded" keeps a step's original length (${Math.round(step3)} ms at 4×, expected ≈1375)`);
  assert(tr.subAt[2] === true && tr.subOff != null && tr.subOff < tr.at[3], 'the subtitle carries over to the next step and hides when the sentence ends');
  assert(tr.pace === 'recorded', 'the player\'s Pace selector reflects the export setting');
  await tp.close();
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));

  // ---- global Settings: the ElevenLabs key is set once and used by every recording
  const st = await ctx.newPage();
  st.on('pageerror', (e) => errors.push('settings: ' + e.message));
  await st.goto(`chrome-extension://${extId}/review.html#settings`);
  await st.waitForSelector('[data-pref=elKey]');
  await st.fill('[data-pref=elKey]', 'sk_global_test');
  await st.press('[data-pref=elKey]', 'Tab');
  await st.waitForFunction(() => /Saved/.test(document.getElementById('key-result').textContent));
  const savedKey = await st.evaluate(() => chrome.storage.local.get('elKey').then((r) => r.elKey));
  assert(savedKey === 'sk_global_test', 'the Settings page saves the ElevenLabs key once');
  // Test key: stub ElevenLabs (missing permission, a key ID instead of a key, then a working key)
  await st.evaluate(() => {
    window.__mode = 'perm';
    window.fetch = async (url) => {
      url = String(url);
      if (url.endsWith('/v1/voices')) return new Response('{"voices":[]}', { status: 200 });
      if (window.__mode === 'perm') return new Response('{"detail":{"status":"missing_permissions","message":"missing the permission speech_to_text"}}', { status: 401 });
      if (window.__mode === 'keyid') return new Response('{"detail":{"type":"authentication_error","code":"invalid_api_key","message":"API key ID used as API key - only valid API keys can be used."}}', { status: 400 });
      return new Response('{"detail":"invalid audio"}', { status: 400 });
    };
  });
  const keyResult = async (mode) => {
    await st.evaluate((m) => { window.__mode = m; document.getElementById('key-result').textContent = ''; }, mode);
    await st.click('#key-test');
    await st.waitForFunction(() => { const t = document.getElementById('key-result').textContent; return t && t !== 'Testing…'; });
    return st.evaluate(() => document.getElementById('key-result').textContent);
  };
  const kr1 = await keyResult('perm'), kr2 = await keyResult('keyid'), kr3 = await keyResult('ok');
  assert(/allowed to use Speech to Text/.test(kr1) && /isn't a valid ElevenLabs API key.*sk_/.test(kr2) && /✓ The key works: Speech to Text ✓ · Voices ✓/.test(kr3),
    'Test key explains a missing permission, rejects a key ID (400 invalid_api_key, no raw JSON), and confirms a working key: ' + JSON.stringify([kr1, kr2, kr3]));
  // Models are dropdowns that show the default by name; a key ID is flagged as you type.
  const models = await st.evaluate(() => ['elModel', 'elTtsModel', 'anModel'].map((k) => document.querySelector(`[data-pref=${k}]`).selectedOptions[0].textContent));
  await st.fill('[data-pref=elKey]', 'a1b2c3d4e5f6');
  const idWarn = await st.evaluate(() => !document.getElementById('el-missing').hidden && /start with sk_/.test(document.getElementById('el-missing').textContent));
  await st.fill('[data-pref=elKey]', 'sk_global_test');
  assert(models[0].includes('Scribe v2') && models[1].includes('Multilingual v2') && models[2].includes('Opus 5.5') && models.every((m) => /default/.test(m)) && idWarn,
    'Settings shows each model by name (defaults marked) and flags a pasted key ID: ' + models.join(' | '));
  await st.screenshot({ path: path.join(OUT, 'settings.png') });
  for (const sidN of [narSession, sessionId]) {
    await st.goto(`chrome-extension://${extId}/review.html#${sidN}`);
    await st.waitForSelector('#steps tr');
  }
  const perRec = await st.evaluate(() => ({ card: !!document.querySelector('details#settings'), sidebar: !!document.getElementById('top-settings') }));
  await st.goto(`chrome-extension://${extId}/review.html#${narSession}`);
  await st.waitForSelector('#narr:not([hidden])');
  await st.waitForFunction(() => /✓ set/.test(document.getElementById('narr-key').textContent));
  assert(!perRec.card && perRec.sidebar, 'recordings no longer have their own Settings card; the Narration card shows the shared key is set');
  await st.close();
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));
  // ---- click highlight: an orange box around the clicked element (or the card around it), rest dimmed
  const hlMeasure = async (q, label) => {
    const hp = await ctx.newPage();
    hp.on('pageerror', (e) => errors.push('highlight: ' + e.message));
    await hp.goto('file://' + file + q);
    await hp.waitForFunction(() => window.demoPlayer);
    const res = await hp.evaluate((label) => new Promise((done) => {
      const P = window.demoPlayer;
      const i = label ? P.steps.findIndex((s) => s.type === 'click' && s.label === label)
        : P.steps.findIndex((s) => s.type === 'click' && s.target && P.steps[P.steps.indexOf(s) + 1] && P.steps[P.steps.indexOf(s) + 1].type === 'change');
      P.jump(i, true);
      const t0 = performance.now();
      let box = null, rect = null, hidden = null, color = '';
      (function tick() {
        if (!box && P.index === i && P.highlight) {
          setTimeout(() => {
            box = P.highlight;
            const frame = document.querySelector('.dp-frame.on');
            const fr = frame.getBoundingClientRect(), k = fr.width / frame.contentWindow.innerWidth;
            const el = frame.contentDocument.querySelector(`[data-demo-target~="${P.steps[i].target}"]`);
            const r = el.getBoundingClientRect();
            rect = { left: fr.left + r.left * k, top: fr.top + r.top * k, right: fr.left + r.right * k, bottom: fr.top + r.bottom * k };
            color = getComputedStyle(document.querySelector('.dp-hl')).outlineColor;
          }, 150);
        }
        if (box && P.index === i + 1 && hidden == null) setTimeout(() => { hidden = P.highlight === null; }, 200);
        if (hidden != null || (label && rect) || performance.now() - t0 > 9000) {
          P.pause();
          return done({ box: box && { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, rect, hidden, color });
        }
        requestAnimationFrame(tick);
      })();
    }), label);
    if (q.includes('shot')) await hp.screenshot({ path: path.join(OUT, 'highlight.png') });
    await hp.close();
    return res;
  };
  const near = (a, b) => Math.abs(a - b) < 3;
  const hEl = await hlMeasure('?zoom=0&speed=2');
  assert(hEl.box && near(hEl.box.left, hEl.rect.left) && near(hEl.box.right, hEl.rect.right) && near(hEl.box.top, hEl.rect.top) && near(hEl.box.bottom, hEl.rect.bottom),
    'click highlight: the orange box surrounds the clicked element');
  assert(hEl.hidden === true && /250, 70, 22|rgb\(250, 70, 22\)/.test(hEl.color), 'the box is orange (#FA4616) and hides on the next page update ' + hEl.color);
  const hCard = await hlMeasure('?zoom=0&speed=2&highlight=card&hlcolor=00a3e0', 'Deal name');
  assert(hCard.box && hCard.box.left <= hCard.rect.left + 1 && hCard.box.right >= hCard.rect.right - 1 && hCard.box.top <= hCard.rect.top + 1 && hCard.box.bottom >= hCard.rect.bottom - 1 &&
    (hCard.box.right - hCard.box.left) * (hCard.box.bottom - hCard.box.top) > (hCard.rect.right - hCard.rect.left) * (hCard.rect.bottom - hCard.rect.top) * 1.3 && /0, 163, 224/.test(hCard.color),
    '?highlight=card boxes the card around the element (and ?hlcolor sets the color) ' + JSON.stringify(hCard));
  const hOff = await hlMeasure('?zoom=0&speed=2&highlight=0');
  assert(!hOff.box, '?highlight=0 shows no box');
  // Per-step override from the review page ends up in the export.
  const hr = await ctx.newPage();
  await hr.goto(`chrome-extension://${extId}/review.html#${sessionId}`);
  await hr.waitForSelector('#steps td.z select[title^="Highlight"]');
  await hr.selectOption('#steps td.z select[title^="Highlight"] >> nth=0', 'off');
  await hr.selectOption('[data-setting=highlight]', 'card');
  await sleep(300);
  const hx = await hr.evaluate(async (id) => {
    const { buildDemoData } = await import('./lib/build.js');
    const d = await buildDemoData(id);
    return { set: d.manifest.settings.highlight, off: d.manifest.steps.filter((x) => x.highlight === false).length };
  }, sessionId);
  await hr.close();
  assert(hx.set === 'card' && hx.off === 1, 'the review page saves the highlight setting and a per-step "Box: off"');
  await hlMeasure('?zoom=1&speed=2&shot=1', 'Deal name');
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));

  // ---- voice-over (ElevenLabs text-to-speech) and a translated version (Claude), both stubbed
  const mp3 = path.join(OUT, 'clip.mp3');
  const { spawnSync } = await import('node:child_process');
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050', '-t', '0.8', '-ac', '1', '-b:a', '32k', mp3]);
  const clipB64 = fs.readFileSync(mp3).toString('base64');
  const vp = await ctx.newPage();
  vp.on('pageerror', (e) => errors.push('voice: ' + e.message));
  vp.on('dialog', (d) => d.accept());
  await vp.goto(`chrome-extension://${extId}/review.html#${narSession}`);
  await vp.evaluate(() => chrome.storage.local.set({ elKey: 'el-test', anKey: 'sk-ant-test', anModel: '' }));
  await vp.reload();
  await vp.waitForSelector('#vo-gen');
  await vp.evaluate((clip) => {
    const orig = window.fetch;
    window.__calls = [];
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (url, init = {}) => {
      url = String(url);
      if (url.startsWith('https://api.elevenlabs.io/v1/voices')) return json({ voices: [{ voice_id: 'VOICEA0000000000000a', name: 'Aria', labels: { gender: 'female' } }, { voice_id: 'VOICEB0000000000000b', name: 'Biel', labels: { gender: 'male' } }] });
      if (url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
        window.__calls.push({ kind: 'tts', url, key: init.headers['xi-api-key'], body: JSON.parse(init.body) });
        return json({ audio_base64: clip, alignment: { character_end_times_seconds: [0.8] } });
      }
      if (url === 'https://api.anthropic.com/v1/messages') {
        const body = JSON.parse(init.body);
        window.__calls.push({ kind: 'claude', key: init.headers['x-api-key'], browser: init.headers['anthropic-dangerous-direct-browser-access'], model: body.model, system: body.system });
        const list = JSON.parse(body.messages[0].content.split('Items:\n')[1]);
        return json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ translations: list.map((x) => ({ id: x.id, text: '[ca] ' + x.text })) }) }] });
      }
      return orig(url, init);
    };
  }, clipB64);
  await vp.click('#vo-reload');
  await vp.waitForFunction(() => document.querySelectorAll('#vo-voice option').length === 2);
  await vp.selectOption('#vo-voice', 'VOICEB0000000000000b');
  await vp.click('#vo-gen');
  await vp.waitForFunction(() => document.querySelector('.vclip button') && /narrated steps voiced/.test(document.getElementById('vo-info').textContent), null, { timeout: 10000 });
  const vinfo = await vp.evaluate(async (id) => {
    const { db } = await import('./lib/db.js');
    const s = await db.getSession(id);
    const steps = await db.getSteps(id);
    return { vo: s.voiceover, n: Object.keys(s.voices || {}).length, voiced: steps.filter((x) => x.voice).map((x) => ({ ms: x.voiceMs, same: x.voiceText === x.narration })),
      narrated: steps.filter((x) => x.narration).length, calls: window.__calls, info: document.getElementById('vo-info').textContent };
  }, narSession);
  assert(vinfo.voiced.length === vinfo.narrated && vinfo.n === vinfo.narrated && vinfo.voiced.every((v) => v.ms === 950 && v.same),
    `Generate voice makes one clip per narrated step (${vinfo.voiced.length}/${vinfo.narrated}) · "${vinfo.info}"`);
  const tts = vinfo.calls.filter((c) => c.kind === 'tts');
  assert(tts[0].key === 'el-test' && /VOICEB0000000000000b\/with-timestamps/.test(tts[0].url) && tts[0].body.model_id === 'eleven_multilingual_v2' && vinfo.vo.name === 'Biel',
    'text-to-speech uses the shared key, the chosen voice and the multilingual model');
  await vp.screenshot({ path: path.join(OUT, 'voice.png'), fullPage: true });

  // Export → the clips are embedded and play with the steps (a real click = user gesture for sound).
  const voHtml = await vp.evaluate(async (id) => {
    const { buildDemoHtml } = await import('./lib/build.js');
    return (await buildDemoHtml(id, { inline: false })).html;
  }, narSession);
  const voParsed = parseDemo(voHtml);
  const voSteps = voParsed.manifest.steps.filter((x) => x.voice);
  assert(voSteps.length === vinfo.narrated && voSteps.every((x) => /^data:audio\/mpeg;base64,/.test(voParsed.assets[x.voice] || '')) && voParsed.manifest.voiceover.voiceId === 'VOICEB0000000000000b',
    'the export embeds the voice clips as assets referenced by step.voice');
  const file5 = path.join(OUT, 'voice.demo.html');
  fs.writeFileSync(file5, voHtml);
  const p5 = await ctx.newPage();
  p5.on('pageerror', (e) => errors.push('voice player: ' + e.message));
  await p5.goto('file://' + file5);
  await p5.bringToFront();
  await p5.waitForFunction(() => window.demoPlayer);
  await p5.click('.dp-cover button');
  await p5.waitForFunction(() => window.demoPlayer.voice && !window.demoPlayer.voice.paused, null, { timeout: 5000 });
  const spoke = await p5.evaluate(() => ({ v: window.demoPlayer.voice, sub: document.querySelector('.dp-subtitle').textContent }));
  await p5.evaluate(() => window.demoPlayer.pause());
  const afterPause = await p5.evaluate(() => window.demoPlayer.voice);
  assert(spoke.v && /^data:audio\/mpeg/.test(spoke.v.src) && spoke.sub.length > 0 && afterPause === null, 'the player speaks each clip with its subtitle, and pause stops it');
  await p5.close();

  // "As recorded" pace follows the voice: the stretch from one voiced step to the next lasts as long as its clip.
  const clipId = voSteps[0].voice;
  const fitMan = { ...voParsed.manifest, settings: { ...voParsed.manifest.settings, timing: 'recorded', autoStart: false, zoom: false },
    steps: [
      { id: 1, type: 'start', screen: voParsed.manifest.steps[0].screen, t: 0 },
      { id: 2, type: 'change', screen: voParsed.manifest.steps[0].screen, t: 1000, narration: 'One.', voice: clipId, voiceMs: 1600, voiceText: 'One.' },
      { id: 3, type: 'change', screen: voParsed.manifest.steps[0].screen, t: 3000 },
      { id: 4, type: 'change', screen: voParsed.manifest.steps[0].screen, t: 5000, narration: 'Two.', voice: clipId, voiceMs: 1600, voiceText: 'Two.' },
      { id: 5, type: 'end', screen: voParsed.manifest.steps[0].screen, t: 8000 },
    ] };
  const file6 = path.join(OUT, 'voice-fit.demo.html');
  fs.writeFileSync(file6, assembleDemo({ ...voParsed, manifest: fitMan, playerJs: fs.readFileSync(path.join(EXT, 'player', 'player.js'), 'utf8'), playerCss: fs.readFileSync(path.join(EXT, 'player', 'player.css'), 'utf8') }));
  const fitRun = async (q) => {
    const p6 = await ctx.newPage();
    p6.on('pageerror', (e) => errors.push('voice fit: ' + e.message));
    await p6.goto('file://' + file6 + q);
    await p6.waitForFunction(() => window.demoPlayer);
    const at = await p6.evaluate(() => new Promise((res) => {
      const at = {}; const t0 = performance.now();
      window.demoPlayer.play();
      (function tick() {
        const i = window.demoPlayer.index;
        if (at[i] == null) at[i] = performance.now() - t0;
        if (i >= 3 || performance.now() - t0 > 8000) return res(at);
        requestAnimationFrame(tick);
      })();
    }));
    await p6.close();
    return at[3] - at[1];
  };
  const fitted = await fitRun('?speed=2');
  const unfitted = await fitRun('?speed=2&voice=0');
  assert(Math.abs(fitted - 1000) < 250 && Math.abs(unfitted - 2000) < 300,
    `"As recorded" timing is fitted to the voice clips (${Math.round(fitted)} ms at 2×, expected ≈1000; ${Math.round(unfitted)} ms without voice, expected ≈2000)`);

  // Edit the narration → that clip is outdated (not exported) until regenerated.
  const firstNar = await vp.evaluate(() => [...document.querySelectorAll('textarea.nar')].findIndex((t) => t.value));
  await vp.fill(`#steps tr:nth-child(${firstNar + 1}) textarea.nar`, 'Welcome, everyone, to the new pipeline.');
  await vp.press(`#steps tr:nth-child(${firstNar + 1}) textarea.nar`, 'Tab');
  await vp.waitForFunction(() => document.querySelector('.vclip.stale'));
  const staleOut = await vp.evaluate(async (id) => {
    const { buildDemoData } = await import('./lib/build.js');
    return (await buildDemoData(id)).manifest.steps.filter((x) => x.voice).length;
  }, narSession);
  await vp.click('#vo-gen');
  await vp.waitForFunction(() => !document.querySelector('.vclip.stale') && document.querySelector('.vclip button'), null, { timeout: 10000 });
  const ttsAfter = await vp.evaluate(() => window.__calls.filter((c) => c.kind === 'tts').map((c) => c.body.text));
  assert(staleOut === vinfo.narrated - 1 && ttsAfter.length === tts.length + 1 && ttsAfter[ttsAfter.length - 1] === 'Welcome, everyone, to the new pipeline.',
    'editing the narration marks its clip outdated; Generate voice redoes only that step');

  // Language version: Claude translates screens, captions and narration into a new recording, then it is voiced.
  await vp.waitForFunction(() => /narrated steps voiced/.test((document.getElementById('vo-info') || {}).textContent || '')); // re-rendered
  await vp.selectOption('#lv-lang', 'ca');
  await vp.click('#lv-go');
  await vp.waitForFunction((id) => location.hash.slice(1) !== id && document.getElementById('title') && /Català/.test(document.getElementById('title').value), narSession, { timeout: 15000 });
  const ver = await vp.evaluate(async () => {
    const { db } = await import('./lib/db.js');
    const { buildDemoData } = await import('./lib/build.js');
    const id = location.hash.slice(1);
    const s = await db.getSession(id);
    const d = await buildDemoData(id);
    const html = Object.values(d.screens).join('');
    return { title: s.title, lang: d.manifest.lang, versionOf: s.versionOf,
      narr: d.manifest.steps.filter((x) => x.narration).map((x) => x.narration),
      voiced: d.manifest.steps.filter((x) => x.voice && d.assets[x.voice]).length,
      screensTranslated: (html.match(/\[ca\] /g) || []).length,
      claude: window.__calls.filter((c) => c.kind === 'claude'),
      lastTts: window.__calls.filter((c) => c.kind === 'tts').slice(-1)[0] };
  });
  assert(ver.versionOf && ver.versionOf.id === narSession && ver.lang === 'ca' && / · Català$/.test(ver.title), 'Create version makes a new recording in the chosen language: ' + ver.title);
  assert(ver.narr.length && ver.narr.every((t) => t.startsWith('[ca] ')) && ver.screensTranslated > 10, `narration and screen text are translated (${ver.screensTranslated} screen strings)`);
  assert(ver.claude.length >= 1 && ver.claude[0].key === 'sk-ant-test' && ver.claude[0].browser === 'true' && ver.claude[0].model === 'claude-opus-5-5' && /Catalan/.test(ver.claude[0].system),
    'translation calls Claude with the Anthropic key from Settings (claude-opus-5-5)');
  assert(ver.voiced === ver.narr.length && ver.lastTts.body.text.startsWith('[ca] ') && /VOICEB0000000000000b/.test(ver.lastTts.url), 'the version is voiced in the new language with the same voice');
  await vp.screenshot({ path: path.join(OUT, 'version.png'), fullPage: true });
  await vp.close();
  assert(errors.length === 0, 'no page errors ' + errors.join(' | '));

  console.log('\nAll good. Screenshots in', OUT);
} finally {
  await ctx.close();
  server.close();
}
