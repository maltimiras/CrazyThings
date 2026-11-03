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
  const p = await chrome.storage.local.get(['recSize', 'recCustom', 'recRestore']);
  return { size: p.recSize || 'current', custom: p.recCustom || { w: 1440, h: 900 }, restore: p.recRestore !== false };
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
  });
}

async function showCurrentSize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = tab && await call({ type: 'measure', tabId: tab.id }).catch(() => null);
  const ok = m && m.w;
  $('cursize').textContent = ok ? `Now: ${m.w} × ${m.h}` : '';
  $('size').options[0].textContent = ok ? `Current window (${m.w} × ${m.h})` : 'Current window';
}

function showWarnings(r) {
  const w = (r && r.resized && r.resized.warnings) || (r && r.warnings) || [];
  $('warn').textContent = w.join(' ');
  return w.length;
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
  await savePrefs();
  const r = await call({ type: 'start', tabId: tab.id, size: chosenSize(), restore: $('restore').checked });
  if (!r.error && !showWarnings(r)) window.close();
  return r;
});
$('pause').onclick = guard(async () => {
  const { state } = await call({ type: 'getState' });
  return call({ type: state && state.paused ? 'resume' : 'pause' });
});
$('stop').onclick = guard(() => call({ type: 'stop' }));
$('library').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });

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
$('cw').onchange = $('ch').onchange = $('restore').onchange = savePrefs;

(async () => {
  const p = await prefs();
  $('size').value = p.size;
  $('cw').value = p.custom.w;
  $('ch').value = p.custom.h;
  $('restore').checked = p.restore;
  $('custom').hidden = p.size !== 'custom';
  showCurrentSize();
})();

refresh();
setInterval(refresh, 1000);
