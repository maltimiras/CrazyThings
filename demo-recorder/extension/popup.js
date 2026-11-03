import { fillLanguageSelect, openMic, startLevel, startRecognizer } from './lib/miclevel.js';

const $ = (id) => document.getElementById(id);
const call = (msg) => chrome.runtime.sendMessage(msg);

async function refresh() {
  const { state, steps } = await call({ type: 'getState' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('idle').hidden = !!state;
  $('active').hidden = !state;
  $('hdr').className = state ? (state.paused ? 'paused' : 'rec') : '';
  $('status').textContent = state ? (state.paused ? 'paused' : 'recording') : '';
  if (state) {
    $('pause').textContent = state.paused ? '▶ Resume' : '❚❚ Pause';
    const other = tab && tab.id !== state.tabId ? ' (in another tab)' : '';
    $('counter').textContent = `${steps} step${steps === 1 ? '' : 's'} captured${other}`;
  }
  return { state, tab };
}

// ---------- recording size ----------
async function prefs() {
  const p = await chrome.storage.local.get(['recSize', 'recCustom', 'recRestore', 'recNarration', 'narrationLang', 'recMicId', 'recLive']);
  return {
    size: p.recSize || 'current', custom: p.recCustom || { w: 1440, h: 900 }, restore: p.recRestore !== false,
    narration: !!p.recNarration, lang: p.narrationLang || '', micId: p.recMicId || '', live: p.recLive !== false,
  };
}

function chosenSize() {
  const v = $('size').value;
  if (v === 'current') return null;
  if (v === 'custom') {
    const w = parseInt($('cw').value, 10), h = parseInt($('ch').value, 10);
    if (!(w >= 320 && h >= 240)) throw new Error('Enter a custom size of at least 320 × 240.');
    return { w, h };
  }
  const [w, h] = v.split('x').map(Number);
  return { w, h };
}

async function savePrefs() {
  await chrome.storage.local.set({
    recSize: $('size').value,
    recCustom: { w: parseInt($('cw').value, 10) || 1440, h: parseInt($('ch').value, 10) || 900 },
    recRestore: $('restore').checked,
    recNarration: $('narration').checked,
    narrationLang: $('lang').value,
    recLive: $('live').checked,
    ...($('mic').value || !$('mic').hidden ? {
      recMicId: $('mic').value,
      recMicLabel: $('mic').selectedOptions[0] ? $('mic').selectedOptions[0].textContent : '',
    } : {}),
  });
}

async function showCurrentSize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = tab && await call({ type: 'measure', tabId: tab.id }).catch(() => null);
  const ok = m && m.w;
  $('cursize').textContent = ok ? `Now: ${m.w} × ${m.h}` : '';
  $('size').options[0].textContent = ok ? `Current window (${m.w} × ${m.h})` : 'Current window';
}

async function micAllowed() {
  try { return (await navigator.permissions.query({ name: 'microphone' })).state === 'granted'; } catch { return false; }
}

function showWarnings(r) {
  const w = (r && r.warnings) || [];
  $('warn').textContent = w.join(' ');
  return w.length;
}

// ---------- narration: microphone choice and test ----------
async function renderMics(selected) {
  const allowed = await micAllowed();
  $('allowmic').hidden = allowed;
  $('mic').hidden = !allowed;
  $('testmic').disabled = !allowed;
  if (!allowed) { $('micstatus').textContent = 'Allow the microphone first.'; return; }
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const keep = selected != null ? selected : $('mic').value;
  $('mic').innerHTML = '';
  for (const d of devices) {
    const o = document.createElement('option');
    o.value = d.deviceId === 'default' ? '' : d.deviceId;
    o.textContent = d.label || (d.deviceId === 'default' ? 'Default microphone' : 'Microphone');
    $('mic').appendChild(o);
  }
  if (!devices.length) { $('micstatus').textContent = 'No microphone found.'; $('testmic').disabled = true; return; }
  $('mic').value = [...$('mic').options].some((o) => o.value === keep) ? keep : $('mic').options[0].value;
  if ($('micstatus').textContent === 'Allow the microphone first.') $('micstatus').textContent = '';
}

let test = null; // { stream, stopLevel, recognizer, timer }
function stopTest() {
  if (!test) return;
  test.stopLevel();
  test.recognizer.stop();
  clearTimeout(test.timer);
  test.stream.getTracks().forEach((t) => t.stop());
  test = null;
  $('testmic').textContent = '🎙 Test mic';
  $('level').style.width = '0';
}

async function startTest() {
  stopTest();
  $('heard').className = 'heard';
  $('heard').textContent = 'Say something…';
  $('micstatus').className = 'muted';
  $('micstatus').textContent = 'Listening…';
  const { stream, fallback } = await openMic($('mic').value);
  let heardSound = false;
  const stopLevel = startLevel(stream, (v) => {
    $('level').style.width = Math.round(v * 100) + '%';
    if (v > 0.08 && !heardSound) {
      heardSound = true;
      $('micstatus').className = 'ok';
      $('micstatus').textContent = '✓ Hearing you' + (fallback ? ' (default mic: the selected one was not found)' : '');
    }
  });
  const timer = setTimeout(() => {
    if (!heardSound) { $('micstatus').className = 'warn'; $('micstatus').textContent = 'No sound: check the selected microphone.'; }
  }, 4000);
  const recognizer = startRecognizer({
    lang: $('lang').value,
    onText: (text) => { $('heard').className = 'heard'; $('heard').textContent = '“' + text + '”'; },
    onStatus: (status, reason) => {
      $('heard').className = 'heard bad';
      $('heard').textContent = `Live transcript not available (${reason}). Record anyway and use "Transcribe with ElevenLabs" afterwards.`;
    },
  });
  test = { stream, stopLevel, recognizer, timer };
  $('testmic').textContent = '■ Stop test';
}

function showNarrationBox() {
  $('narrbox').hidden = !$('narration').checked;
  if ($('narrbox').hidden) stopTest();
}

function guard(fn) {
  return async () => {
    $('err').textContent = '';
    try {
      const r = await fn();
      if (r && r.error) throw new Error(r.error);
    } catch (e) {
      $('err').textContent = e.message || String(e);
    }
    refresh();
  };
}

$('start').onclick = guard(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  stopTest();
  await savePrefs();
  const narration = $('narration').checked;
  if (narration && !(await micAllowed())) {
    // The recorder runs in a hidden page that can't show Chrome's permission prompt: ask once in a tab.
    await chrome.tabs.create({ url: chrome.runtime.getURL('mic-setup.html') });
    throw new Error('Allow the microphone in the tab that just opened, then press Start again.');
  }
  const r = await call({ type: 'start', tabId: tab.id, size: chosenSize(), restore: $('restore').checked, narration });
  if (!r.error && !showWarnings(r)) window.close();
  return r;
});
$('pause').onclick = guard(async () => {
  const { state } = await call({ type: 'getState' });
  return call({ type: state && state.paused ? 'resume' : 'pause' });
});
$('stop').onclick = guard(() => call({ type: 'stop' }));
$('library').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
$('importdemo').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('review.html#import') });
$('settings').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('review.html#settings') });

$('resize').onclick = guard(async () => {
  const size = chosenSize();
  if (!size) return;
  await savePrefs();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = await call({ type: 'resize', tabId: tab.id, w: size.w, h: size.h });
  showWarnings(r);
  await showCurrentSize();
  return r;
});
$('size').onchange = () => { $('custom').hidden = $('size').value !== 'custom'; savePrefs(); };
$('cw').onchange = $('ch').onchange = $('restore').onchange = $('live').onchange = savePrefs;
$('narration').onchange = () => { showNarrationBox(); savePrefs(); };
$('mic').onchange = () => { savePrefs(); if (test) startTest().catch((e) => { $('micstatus').textContent = e.message; }); };
$('lang').onchange = () => { savePrefs(); if (test) startTest().catch((e) => { $('micstatus').textContent = e.message; }); };
$('testmic').onclick = guard(async () => { if (test) stopTest(); else await startTest(); });
$('allowmic').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('mic-setup.html') });
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => renderMics());
window.addEventListener('pagehide', stopTest);

(async () => {
  const p = await prefs();
  $('size').value = p.size;
  $('cw').value = p.custom.w;
  $('ch').value = p.custom.h;
  $('restore').checked = p.restore;
  $('narration').checked = p.narration;
  $('custom').hidden = p.size !== 'custom';
  fillLanguageSelect($('lang'), p.lang);
  $('live').checked = p.live;
  await renderMics(p.micId);
  showNarrationBox();
  showCurrentSize();
})();

refresh();
setInterval(refresh, 1000);
