import { db } from './lib/db.js';
import { buildDemoHtml, describeStep, DEFAULT_SETTINGS } from './lib/build.js';

const $ = (id) => document.getElementById(id);
let currentId = null;

const fmtDate = (t) => new Date(t).toLocaleString();
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
const slug = (s) => (s || 'demo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'demo';

async function renderSessions() {
  const list = (await db.listSessions()).sort((a, b) => b.createdAt - a.createdAt);
  const box = $('sessions');
  box.innerHTML = '';
  if (!list.length) box.innerHTML = '<div class="empty">No recordings yet.</div>';
  for (const s of list) {
    const d = document.createElement('div');
    d.className = 'sess' + (s.id === currentId ? ' on' : '');
    d.innerHTML = '<b></b><small></small>';
    d.querySelector('b').textContent = s.title;
    d.querySelector('small').textContent = fmtDate(s.createdAt);
    d.onclick = () => { location.hash = s.id; };
    box.appendChild(d);
  }
}

async function renderEditor(id) {
  currentId = id;
  await renderSessions();
  const main = $('main');
  const session = id && await db.getSession(id);
  if (!session) {
    main.innerHTML = '<div class="empty">Select a recording, or start one from the toolbar button.</div>';
    return;
  }
  main.innerHTML = '';
  main.appendChild($('editor').content.cloneNode(true));
  const settings = { ...DEFAULT_SETTINGS, ...(session.settings || {}) };

  $('title').value = session.title;
  $('title').onchange = async () => { session.title = $('title').value.trim() || 'Untitled demo'; await db.putSession(session); renderSessions(); };
  // Export options: every [data-setting] control maps to session.settings[key].
  for (const el of main.querySelectorAll('[data-setting]')) {
    const key = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = String(settings[key]);
    el.onchange = async () => {
      const def = DEFAULT_SETTINGS[key];
      settings[key] = el.type === 'checkbox' ? el.checked
        : typeof def === 'boolean' ? el.value === 'true'
        : typeof def === 'number' ? Number(el.value) : el.value;
      session.settings = { ...settings };
      await db.putSession(session);
    };
  }
  $('inline').checked = session.exportInline !== false;
  $('inline').onchange = async () => { session.exportInline = $('inline').checked; await db.putSession(session); };

  const [steps, screens] = await Promise.all([db.getSteps(id), db.getScreens(id)]);
  const bytes = screens.reduce((n, s) => n + s.html.length, 0);
  const first = steps.length && screens.find((x) => x.id === steps[0].screen);
  const vpText = first && first.viewport ? ` · ${first.viewport.w}×${first.viewport.h}` : '';
  $('meta').textContent = `${fmtDate(session.createdAt)} · ${steps.length} steps${vpText} · ${screens.length} raw snapshots (${fmtSize(bytes)}) · ${session.url}`;

  const tbody = $('steps');
  steps.forEach((st, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="n">${i + 1}</td><td class="t"><span class="tag ${st.type}">${st.type}</span></td>
      <td><div class="desc"></div></td><td class="note"><textarea placeholder="Caption (optional)"></textarea></td>
      <td class="z"></td><td class="x"><button title="Delete step">✕</button></td>`;
    if (st.type === 'click' || st.type === 'type') {
      // Per-step zoom: '' = follow the export setting, 'off' = never zoom this step, number = custom level.
      const sel = document.createElement('select');
      sel.title = 'Zoom for this step';
      sel.innerHTML = '<option value="">Zoom: default</option><option value="off">Zoom: off</option>' +
        '<option value="1.5">Zoom: 1.5×</option><option value="2">Zoom: 2×</option><option value="2.5">Zoom: 2.5×</option>';
      sel.value = st.zoom === false ? 'off' : typeof st.zoom === 'number' ? String(st.zoom) : '';
      sel.onchange = async () => {
        if (sel.value === '') delete st.zoom;
        else st.zoom = sel.value === 'off' ? false : Number(sel.value);
        await db.putStep(st);
      };
      tr.querySelector('td.z').appendChild(sel);
    }
    tr.querySelector('.desc').textContent = describeStep(st);
    tr.querySelector('.desc').title = describeStep(st);
    const ta = tr.querySelector('textarea');
    ta.value = st.note || '';
    ta.onchange = async () => { st.note = ta.value.trim() || undefined; await db.putStep(st); };
    tr.querySelector('button').onclick = async () => { await db.deleteStep(st.seq); tr.remove(); };
    tbody.appendChild(tr);
  });

  $('preview').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('preview.html#' + id) });

  $('export').onclick = async () => {
    const btn = $('export');
    btn.disabled = true;
    $('progress').textContent = 'Building…';
    try {
      const { html, stats } = await buildDemoHtml(id, {
        inline: $('inline').checked,
        onProgress: (d, t) => { $('progress').textContent = `Embedding assets ${d}/${t}…`; },
      });
      const blob = new Blob([html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = slug(session.title) + '.demo.html';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      $('progress').textContent = `Exported ${fmtSize(blob.size)}` +
        (stats ? ` · embedded ${stats.inlined}/${stats.total} assets` : '');
    } catch (e) {
      console.error(e);
      $('progress').textContent = 'Export failed: ' + (e.message || e);
    } finally {
      btn.disabled = false;
    }
  };

  $('delete').onclick = async () => {
    if (!confirm('Delete this recording permanently?')) return;
    await db.deleteSession(id);
    location.hash = '';
  };
}

window.addEventListener('hashchange', () => renderEditor(location.hash.slice(1)));
renderEditor(location.hash.slice(1));
