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
  const r = await call({ type: 'start', tabId: tab.id });
  if (!r.error) window.close();
  return r;
});
$('pause').onclick = guard(async () => {
  const { state } = await call({ type: 'getState' });
  return call({ type: state && state.paused ? 'resume' : 'pause' });
});
$('stop').onclick = guard(() => call({ type: 'stop' }));
$('library').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });

refresh();
setInterval(refresh, 1000);
