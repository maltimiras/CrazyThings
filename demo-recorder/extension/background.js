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

async function start(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || /^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(tab.url) ||
      /chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(tab.url)) {
    throw new Error('Chrome does not allow extensions to record this page. Open your web app in a normal tab.');
  }
  if (state) await stop({ openReview: false });
  const session = { id: crypto.randomUUID(), title: tab.title || 'Untitled demo', url: tab.url, createdAt: Date.now() };
  await db.putSession(session);
  await setState({ sessionId: session.id, tabId, paused: false });
  const r = await sendToTab(tabId, { type: 'rec-state', recording: true, paused: false, reason: 'start' });
  if (!r) {
    // Tab was open before the extension was installed/reloaded: inject now.
    // The injected script asks for state via 'hello' and starts recording itself.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
  return { state };
}

async function stop({ openReview = true } = {}) {
  if (!state) return { state };
  const { sessionId, tabId } = state;
  await sendToTab(tabId, { type: 'finish' });
  // Let the final screen/step messages land before we stop accepting them.
  await new Promise((r) => setTimeout(r, 400));
  await setState(null);
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
    case 'start': return start(msg.tabId);
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
