// Demo Recorder — background service worker.
// Owns recording state and persists screens/steps into IndexedDB as they stream in.
import { db } from './lib/db.js';
import { assignPhrases, livePhrases } from './lib/narration.js';

let state = null; // { sessionId, tabId, paused }
const ready = chrome.storage.session.get('rec').then((r) => { state = r.rec || null; updateBadge(); });

async function setState(s) {
  state = s;
  await chrome.storage.session.set({ rec: s });
  updateBadge();
}

function updateBadge() {
  chrome.action.setBadgeText({ text: state ? (state.paused ? '❚❚' : 'REC') : '' });
  chrome.action.setBadgeBackgroundColor({ color: state && state.paused ? '#b45309' : '#dc2626' });
}

const isRecTab = (sender) => state && sender.tab && sender.tab.id === state.tabId && sender.frameId === 0;

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g;
function absUrls(css, base) {
  return css.replace(URL_RE, (m, a, b, c) => {
    const u = (a ?? b ?? c ?? '').trim();
    if (!u || /^(data:|blob:|#|about:)/i.test(u)) return m;
    try { return `url("${new URL(u, base).href}")`; } catch { return m; }
  });
}

async function sendToTab(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }); } catch { return null; }
}

// ---------- recording size ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function measureTab(tabId) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ w: window.innerWidth, h: window.innerHeight }),
  });
  return r.result;
}

// Resize the browser window so the page area (innerWidth × innerHeight) is exactly w × h.
async function resizeTabViewport(tabId, w, h) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  const before = { windowId: win.id, state: win.state, width: win.width, height: win.height, left: win.left, top: win.top };
  if (win.state !== 'normal') { await chrome.windows.update(win.id, { state: 'normal' }); await wait(300); }
  let m = await measureTab(tabId);
  let blocked = false;
  for (let i = 0; i < 4 && (m.w !== w || m.h !== h); i++) {
    const cur = await chrome.windows.get(win.id);
    try {
      await chrome.windows.update(win.id, { width: cur.width + (w - m.w), height: cur.height + (h - m.h) });
    } catch (e) {
      // Chrome rejects windows that would be mostly off-screen (size larger than the display).
      blocked = true;
      break;
    }
    await wait(250);
    const next = await measureTab(tabId);
    if (next.w === m.w && next.h === m.h) { m = next; break; } // window can't grow further
    m = next;
  }
  const zoom = await chrome.tabs.getZoom(tabId).catch(() => 1);
  const warnings = [];
  if (m.w !== w || m.h !== h) {
    warnings.push(blocked
      ? `${w}×${h} doesn't fit on this screen (got ${m.w}×${m.h}). Pick a smaller size or move the window to a bigger display.`
      : `Couldn't reach ${w}×${h} (got ${m.w}×${m.h}): the screen may be too small.`);
  }
  if (Math.abs(zoom - 1) > 0.001) warnings.push(`Page zoom is ${Math.round(zoom * 100)}%: set it to 100% for exact pixels.`);
  return { actual: m, warnings, before };
}

async function restoreWindow(b) {
  if (!b) return;
  try {
    if (b.state === 'maximized' || b.state === 'fullscreen') await chrome.windows.update(b.windowId, { state: b.state });
    else {
      try {
        await chrome.windows.update(b.windowId, { state: 'normal', width: b.width, height: b.height, left: b.left, top: b.top });
      } catch {
        // The display may have changed: restore the size only.
        await chrome.windows.update(b.windowId, { width: b.width, height: b.height });
      }
    }
  } catch { /* window closed, or the old size no longer fits the screen */ }
}

// ---------- narration (microphone, via an offscreen document) ----------
const toOffscreen = (msg) => chrome.runtime.sendMessage({ ...msg, target: 'offscreen' }).catch((e) => ({ error: String(e && e.message || e) }));

async function ensureOffscreen() {
  const existing = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    : [];
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record the narration from the microphone while a demo is being recorded.',
  });
}

async function closeOffscreen() {
  try { await chrome.offscreen.closeDocument(); } catch { /* not open */ }
}

// Session writes from several async sources (transcript, pause, stop) go through one queue.
let sessionQueue = Promise.resolve();
function updateSession(id, fn) {
  sessionQueue = sessionQueue.then(async () => {
    const s = await db.getSession(id);
    if (!s) return;
    fn(s);
    await db.putSession(s);
  }).catch((e) => console.warn('[demo-recorder] session update failed', e));
  return sessionQueue;
}

function micErrorText(err) {
  const e = String(err || '');
  if (/NotAllowedError/.test(e)) return 'microphone access is blocked. Allow it for Demo Recorder (and, on a Mac, for Google Chrome in System Settings → Privacy & Security → Microphone).';
  if (/NotFoundError/.test(e)) return 'no microphone was found.';
  if (/NotReadableError/.test(e)) return 'the microphone is in use by another app or not readable.';
  return e || 'the microphone recorder did not respond.';
}

// Small window bottom-right of the recorded window: live transcript + volume bar.
async function openNarrationPanel(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const w = await chrome.windows.get(tab.windowId);
    const width = 380, height = 240;
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('narration.html'),
      type: 'popup', width, height, focused: false,
      left: Math.max(0, (w.left || 0) + (w.width || width) - width - 16),
      top: Math.max(0, (w.top || 0) + (w.height || height) - height - 16),
    });
    // Keep the recorded window in front.
    chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return win.id;
  } catch (e) {
    console.warn('[demo-recorder] narration panel not opened', e);
    return null;
  }
}

async function startNarration(sessionId, tabId) {
  const prefs = await chrome.storage.local.get(['narrationLang', 'recMicId', 'recMicLabel', 'recLive']);
  const live = prefs.recLive !== false;
  try { await ensureOffscreen(); } catch (e) { return { error: String(e && e.message || e) }; }
  const r = await toOffscreen({ type: 'mic-start', sessionId, deviceId: prefs.recMicId || '' });
  if (!r || r.error) { await closeOffscreen(); return { error: micErrorText(r && r.error) }; }
  const warnings = [];
  if (r.fallback) warnings.push(`The selected microphone (${prefs.recMicLabel || 'saved device'}) wasn't found: using ${r.micLabel}.`);
  const panelWindowId = live ? await openNarrationPanel(tabId) : null;
  await updateSession(sessionId, (s) => {
    s.audio = { mime: r.mime, segments: [{ wall: r.startedAt, at: 0 }], duration: 0, lastWall: r.startedAt };
    s.liveTranscript = [];
    s.narrationSetup = { lang: prefs.narrationLang || '', micLabel: r.micLabel, live, warnings };
  });
  return { ok: true, warnings, panelWindowId };
}

const toPanel = (type) => chrome.runtime.sendMessage({ target: 'narration', type }).catch(() => {});

async function pauseNarration(sessionId, paused) {
  toPanel(paused ? 'pause' : 'resume');
  const r = await toOffscreen({ type: paused ? 'mic-pause' : 'mic-resume' });
  if (!r || r.error) return;
  await updateSession(sessionId, (s) => {
    const a = s.audio;
    if (!a) return;
    if (paused && a.lastWall != null) { a.duration += r.at - a.lastWall; a.lastWall = null; }
    if (!paused && a.lastWall == null) { a.segments.push({ wall: r.at, at: a.duration }); a.lastWall = r.at; }
  });
}

async function stopNarration(sessionId, panelWindowId) {
  if (panelWindowId) await chrome.windows.remove(panelWindowId).catch(() => {});
  const r = await toOffscreen({ type: 'mic-stop' });
  await closeOffscreen();
  await updateSession(sessionId, (s) => {
    const a = s.audio;
    if (!a) return;
    if (a.lastWall != null && r && r.stoppedAt) a.duration += r.stoppedAt - a.lastWall;
    a.lastWall = null;
    a.chunks = r && r.chunks;
  });
  // Put the live (Chrome) transcript on the steps it was spoken over.
  const session = await db.getSession(sessionId);
  if (session && session.liveTranscript && session.liveTranscript.length) {
    const steps = await db.getSteps(sessionId);
    const texts = assignPhrases(steps, session.audio, livePhrases(session.audio, session.liveTranscript));
    for (let i = 0; i < steps.length; i++) {
      if (texts[i] && !steps[i].narration) { steps[i].narration = texts[i]; await db.putStep(steps[i]); }
    }
    await updateSession(sessionId, (s) => { s.narrationSource = 'chrome'; });
  }
}

async function start(tabId, { size = null, restore = true, narration = false } = {}) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || /^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(tab.url) ||
      /chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(tab.url)) {
    throw new Error('Chrome does not allow extensions to record this page. Open your web app in a normal tab.');
  }
  if (state) await stop({ openReview: false });
  let resized = null;
  if (size && size.w && size.h) resized = await resizeTabViewport(tabId, size.w, size.h);
  const session = { id: crypto.randomUUID(), title: tab.title || 'Untitled demo', url: tab.url, createdAt: Date.now() };
  await db.putSession(session);
  let mic = null;
  if (narration) mic = await startNarration(session.id, tabId);
  await setState({
    sessionId: session.id, tabId, paused: false,
    restoreWin: resized && restore ? resized.before : null,
    narration: !!(mic && mic.ok),
    panelWindowId: (mic && mic.panelWindowId) || null,
  });
  const r = await sendToTab(tabId, { type: 'rec-state', recording: true, paused: false, reason: 'start' });
  if (!r) {
    // Tab was open before the extension was installed/reloaded: inject now.
    // The injected script asks for state via 'hello' and starts recording itself.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
  const warnings = [...((resized && resized.warnings) || [])];
  if (mic && mic.error) warnings.push('Narration not recorded: ' + mic.error);
  if (mic && mic.warnings) warnings.push(...mic.warnings);
  return { state, resized, warnings };
}

async function stop({ openReview = true } = {}) {
  if (!state) return { state };
  const { sessionId, tabId, restoreWin, narration, panelWindowId } = state;
  await sendToTab(tabId, { type: 'finish' });
  // Let the final screen/step messages land before we stop accepting them.
  await new Promise((r) => setTimeout(r, 400));
  await setState(null);
  if (narration) await stopNarration(sessionId, panelWindowId);
  await restoreWindow(restoreWin);
  if (openReview) await chrome.tabs.create({ url: chrome.runtime.getURL('review.html#' + sessionId) });
  return { state };
}

async function setPaused(paused) {
  if (!state) return { state };
  await setState({ ...state, paused });
  if (state.narration) await pauseNarration(state.sessionId, paused);
  await sendToTab(state.tabId, { type: 'rec-state', recording: true, paused, reason: 'resume' });
  return { state };
}

async function fetchCss(key, href) {
  if (await db.hasCss(key)) return;
  try {
    const res = await fetch(href, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await db.putCss(key, absUrls(await res.text(), href));
  } catch (e) {
    console.warn('[demo-recorder] could not fetch stylesheet', href, e);
  }
}

async function handle(msg, sender) {
  await ready;
  switch (msg.type) {
    case 'preview-refresh': return { ok: true }; // for preview tabs, nothing to do here
    case 'getState': {
      const steps = state ? await db.countSteps(state.sessionId) : 0;
      return { state, steps };
    }
    case 'start': return start(msg.tabId, { size: msg.size, restore: msg.restore !== false, narration: !!msg.narration });
    case 'transcript':
      if (state && state.narration) {
        const id = state.sessionId;
        updateSession(id, (s) => { (s.liveTranscript = s.liveTranscript || []).push({ wall: msg.wall, text: msg.text }); });
      }
      return { ok: true };
    case 'transcript-status':
      if (state && state.narration) updateSession(state.sessionId, (s) => { s.liveStatus = msg.status + (msg.error ? ': ' + msg.error : ''); });
      return { ok: true };
    case 'resize': return resizeTabViewport(msg.tabId, msg.w, msg.h);
    case 'measure': return measureTab(msg.tabId);
    case 'stop': return stop();
    case 'pause': return setPaused(true);
    case 'resume': return setPaused(false);
    case 'hello':
      if (isRecTab(sender)) return { recording: true, paused: state.paused, reason: 'navigate' };
      return { recording: false };
    case 'screen': {
      if (!isRecTab(sender)) return { ignored: true };
      const sessionId = state.sessionId;
      await db.putScreen({ ...msg.screen, sessionId });
      for (const [k, text] of Object.entries(msg.css || {})) await db.putCss(k, text);
      return { ok: true };
    }
    case 'step': {
      if (!isRecTab(sender)) return { ignored: true };
      await db.addStep({ ...msg.step, sessionId: state.sessionId });
      return { ok: true };
    }
    case 'needCss':
      await fetchCss(msg.key, msg.href);
      return { ok: true };
    default:
      return { error: 'unknown message ' + msg.type };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e && e.message || e) }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  if (state && state.tabId === tabId) {
    const { sessionId, narration, panelWindowId } = state;
    await setState(null);
    if (narration) await stopNarration(sessionId, panelWindowId);
  }
});
