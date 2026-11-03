// Demo Recorder — background service worker.
// Owns recording state and persists screens/steps into IndexedDB as they stream in.
import { db } from './lib/db.js';

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

async function start(tabId, { size = null, restore = true } = {}) {
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
  await setState({ sessionId: session.id, tabId, paused: false, restoreWin: resized && restore ? resized.before : null });
  const r = await sendToTab(tabId, { type: 'rec-state', recording: true, paused: false, reason: 'start' });
  if (!r) {
    // Tab was open before the extension was installed/reloaded: inject now.
    // The injected script asks for state via 'hello' and starts recording itself.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
  return { state, resized };
}

async function stop({ openReview = true } = {}) {
  if (!state) return { state };
  const { sessionId, tabId, restoreWin } = state;
  await sendToTab(tabId, { type: 'finish' });
  // Let the final screen/step messages land before we stop accepting them.
  await new Promise((r) => setTimeout(r, 400));
  await setState(null);
  await restoreWindow(restoreWin);
  if (openReview) await chrome.tabs.create({ url: chrome.runtime.getURL('review.html#' + sessionId) });
  return { state };
}

async function setPaused(paused) {
  if (!state) return { state };
  await setState({ ...state, paused });
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
    case 'getState': {
      const steps = state ? await db.countSteps(state.sessionId) : 0;
      return { state, steps };
    }
    case 'start': return start(msg.tabId, { size: msg.size, restore: msg.restore !== false });
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
  if (state && state.tabId === tabId) await setState(null);
});
