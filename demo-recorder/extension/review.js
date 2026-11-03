import { db } from './lib/db.js';
import { buildDemoHtml, describeStep, DEFAULT_SETTINGS } from './lib/build.js';
import { assignPhrases, livePhrases, wordsToPhrases, mergeNarration } from './lib/narration.js';
import { LANGUAGES, languageName, toIso639 } from './lib/miclevel.js';
import { importDemo } from './lib/import.js';

const $ = (id) => document.getElementById(id);
let currentId = null;

const fmtDate = (t) => new Date(t).toLocaleString();
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
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
  const rows = [];
  steps.forEach((st, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="n">${i + 1}</td><td class="t"><span class="tag ${st.type}">${st.type}</span></td>
      <td><div class="desc"></div></td><td class="note"><textarea class="cap" placeholder="Caption (optional)"></textarea><textarea class="nar" placeholder="🎙 Narration (spoken text)"></textarea></td>
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
    const ta = tr.querySelector('textarea.cap');
    ta.value = st.note || '';
    ta.onchange = async () => { st.note = ta.value.trim() || undefined; await db.putStep(st); };
    const nar = tr.querySelector('textarea.nar');
    nar.value = st.narration || '';
    nar.onchange = async () => { st.narration = nar.value.trim() || undefined; await db.putStep(st); };
    const row = { st, tr, nar };
    rows.push(row);
    tr.querySelector('td.x button').onclick = async () => {
      // Keep the words: a deleted step's narration moves to the previous step.
      const k = rows.indexOf(row);
      const prev = rows[k - 1];
      if (st.narration && prev) {
        prev.st.narration = mergeNarration(prev.st.narration, st.narration);
        prev.nar.value = prev.st.narration;
        await db.putStep(prev.st);
      }
      rows.splice(k, 1);
      await db.deleteStep(st.seq);
      tr.remove();
    };
    tbody.appendChild(tr);
  });

  // ---------- narration ----------
  await renderNarration(id, session);

  // ---------- settings (transcription) ----------
  const prefs = await chrome.storage.local.get(['elKey', 'elModel', 'elLang', 'narrationLang']);
  const liveLang = main.querySelector('[data-pref=narrationLang]');
  if (liveLang) liveLang.innerHTML = LANGUAGES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  for (const el of main.querySelectorAll('[data-pref]')) {
    const key = el.dataset.pref;
    el.value = prefs[key] || '';
    el.onchange = async () => {
      await chrome.storage.local.set({ [key]: el.value.trim() });
      if (key === 'elKey') renderNarration(id, await db.getSession(id));
    };
  }

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

async function renderNarration(id, session) {
  const box = $('narr');
  if (!box) return;
  const audio = session && session.audio;
  box.hidden = !audio;
  if (!audio) return;
  const blob = await db.getAudioBlob(id, audio.mime);
  const src = { chrome: 'live Chrome transcript', elevenlabs: 'ElevenLabs transcript' }[session.narrationSource] || 'not transcribed yet';
  $('narr-info').textContent = `${fmtDur(audio.duration)} recorded${blob ? ' · ' + fmtSize(blob.size) : ''} · ${src}`;
  const live = session.liveTranscript || [];
  const setup = session.narrationSetup || {};
  const status = [];
  if (setup.micLabel) status.push(`Microphone: ${setup.micLabel}.`);
  if (setup.lang !== undefined) status.push(`Language: ${languageName(setup.lang)}.`);
  if (live.length) status.push(`Live transcript: ${live.length} sentence${live.length === 1 ? '' : 's'}.`);
  else if (setup.live === false) status.push('Live transcript was off: use “Transcribe with ElevenLabs”.');
  else if (session.liveStatus) status.push(`Live transcript failed (${session.liveStatus}): use “Transcribe with ElevenLabs”.`);
  else status.push('No words came through the live transcript (was the Narration window closed?): use “Transcribe with ElevenLabs”.');
  for (const w of setup.warnings || []) status.push(w);
  $('narr-status').className = 'muted';
  $('narr-status').textContent = status.join(' ');
  if (blob) {
    const url = URL.createObjectURL(blob);
    $('narr-audio').src = url;
    $('narr-dl').href = url;
    $('narr-dl').download = slug(session.title) + '-narration.webm';
  }
  const { elKey } = await chrome.storage.local.get('elKey');
  $('transcribe').disabled = !elKey || !blob;
  $('transcribe').title = elKey ? 'Send the audio to ElevenLabs speech-to-text' : 'Add your ElevenLabs API key in Settings below';
  $('use-live').hidden = !live.length;
  $('use-live').onclick = () => applyPhrases(id, livePhrases(audio, live), 'chrome');
  $('transcribe').onclick = () => transcribe(id, blob);
}

async function applyPhrases(id, phrases, source) {
  const session = await db.getSession(id);
  const steps = await db.getSteps(id);
  const texts = assignPhrases(steps, session.audio, phrases);
  if (steps.some((s) => s.narration) &&
      !confirm('Replace the narration text on all steps with this transcript?')) return;
  for (let i = 0; i < steps.length; i++) {
    if (texts[i]) steps[i].narration = texts[i]; else delete steps[i].narration;
    await db.putStep(steps[i]);
  }
  session.narrationSource = source;
  await db.putSession(session);
  await renderEditor(id);
}

async function transcribe(id, blob) {
  const btn = $('transcribe');
  const { elKey, elModel, elLang } = await chrome.storage.local.get(['elKey', 'elModel', 'elLang']);
  const recorded = ((await db.getSession(id)) || {}).narrationSetup || {};
  // Language: the ElevenLabs setting, else the language chosen when recording (es-ES → es).
  const langCode = elLang || toIso639(recorded.lang);
  btn.disabled = true;
  $('narr-status').className = 'muted';
  $('narr-status').textContent = 'Transcribing with ElevenLabs…';
  try {
    const fd = new FormData();
    fd.append('file', blob, 'narration.webm');
    fd.append('model_id', elModel || 'scribe_v2');
    fd.append('timestamps_granularity', 'word');
    if (langCode) fd.append('language_code', langCode);
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': elKey }, body: fd });
    if (!res.ok) {
      const hint = { 401: 'check the API key', 422: 'the request was rejected (model or language?)', 429: 'rate limit or quota reached' }[res.status] || '';
      throw new Error(`ElevenLabs ${res.status}${hint ? ' — ' + hint : ''}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = await res.json();
    let phrases = wordsToPhrases(json.words || []);
    if (!phrases.length && json.text) phrases = [{ start: 0, text: json.text }];
    const session = await db.getSession(id);
    session.transcript = json.text || '';
    await db.putSession(session);
    await applyPhrases(id, phrases, 'elevenlabs');
  } catch (e) {
    $('narr-status').className = 'bad';
    $('narr-status').textContent = e.message || String(e);
    btn.disabled = false;
  }
}

// ---------- import a shared .demo.html ----------
async function importFile(file) {
  const msg = $('import-msg');
  msg.className = '';
  msg.textContent = `Importing ${file.name}…`;
  try {
    const id = crypto.randomUUID();
    const { session, screens, steps, css, warnings } = await importDemo(await file.text(), {
      sessionId: id,
      existingCss: (key) => db.getCss(key),
    });
    for (const [k, text] of Object.entries(css)) await db.putCss(k, text);
    for (const s of screens) await db.putScreen(s);
    for (const st of steps) await db.addStep(st); // in order: keys follow the demo's step order
    await db.putSession(session);
    msg.className = warnings.length ? 'warn' : '';
    msg.textContent = warnings.length ? warnings.join(' ') : `Imported “${session.title}” (${steps.length} steps).`;
    location.hash = id;
  } catch (e) {
    msg.className = 'bad';
    msg.textContent = e.message || String(e);
  }
}

$('import-btn').onclick = () => $('import-file').click();
$('import-file').onchange = () => {
  const f = $('import-file').files[0];
  $('import-file').value = '';
  if (f) importFile(f);
};
const aside = $('aside');
aside.addEventListener('dragover', (e) => { e.preventDefault(); aside.classList.add('drop'); });
aside.addEventListener('dragleave', () => aside.classList.remove('drop'));
aside.addEventListener('drop', (e) => {
  e.preventDefault();
  aside.classList.remove('drop');
  const f = e.dataTransfer.files[0];
  if (f) importFile(f);
});

function route() {
  const h = location.hash.slice(1);
  if (h === 'import') {
    // Opened from the popup's "Import demo…": open the file picker (may need a click if the browser blocks it).
    $('import-msg').textContent = 'Choose a .demo.html file to import.';
    try { $('import-file').showPicker(); } catch { /* needs a user click: the button is right there */ }
    return renderEditor('');
  }
  return renderEditor(h);
}
window.addEventListener('hashchange', route);
route();
