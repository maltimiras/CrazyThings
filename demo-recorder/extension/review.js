import { db } from './lib/db.js';
import { buildDemoHtml, buildDemoData, describeStep, DEFAULT_SETTINGS } from './lib/build.js';
import { assembleDemo } from './lib/format.js';
import { collectTexts, applyTranslations, translateTexts, testClaudeKey, TRANSLATION_LANGUAGES, translationLanguage, DEFAULT_CLAUDE_MODEL } from './lib/translate.js';
import { listVoices, voiceSteps, nextAssetId, DEFAULT_TTS_MODEL } from './lib/voice.js';
import { assignPhrases, livePhrases, wordsToPhrases, mergeNarration } from './lib/narration.js';
import { LANGUAGES, languageName, toIso639 } from './lib/miclevel.js';
import { importDemo } from './lib/import.js';

const $ = (id) => document.getElementById(id);
let currentId = null;

// Tell an open Preview tab of this recording to reload with the change.
const refreshPreview = (id) => chrome.runtime.sendMessage({ type: 'preview-refresh', id }).catch(() => {});
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
      refreshPreview(id);
      if (key === 'timing') renderEditor(id); // duration placeholders depend on the pace
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
      <td class="z"></td><td class="d"></td><td class="x"><button title="Delete step">✕</button></td>`;
    // Per-step duration (seconds). Empty = automatic: the recorded gap in "As recorded" pace, else natural.
    const next = steps[i + 1];
    const gap = next && typeof next.t === 'number' && typeof st.t === 'number' ? (next.t - st.t) / 1000 : null;
    const dur = document.createElement('input');
    dur.type = 'number'; dur.min = '0.2'; dur.step = '0.1';
    dur.title = 'How long this step lasts, in seconds (empty = automatic)';
    dur.placeholder = settings.timing === 'recorded' && gap != null ? '⏱ ' + gap.toFixed(1) : '⏱ auto';
    dur.value = typeof st.duration === 'number' ? (st.duration / 1000).toFixed(1) : '';
    dur.onchange = async () => {
      const v = parseFloat(dur.value);
      if (v > 0) st.duration = Math.round(v * 1000); else { delete st.duration; dur.value = ''; }
      await db.putStep(st);
      refreshPreview(id);
    };
    tr.querySelector('td.d').appendChild(dur);
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
        refreshPreview(id);
      };
      tr.querySelector('td.z').appendChild(sel);
    }
    tr.querySelector('.desc').textContent = describeStep(st);
    tr.querySelector('.desc').title = describeStep(st);
    const ta = tr.querySelector('textarea.cap');
    ta.value = st.note || '';
    ta.onchange = async () => { st.note = ta.value.trim() || undefined; await db.putStep(st); refreshPreview(id); };
    const nar = tr.querySelector('textarea.nar');
    nar.value = st.narration || '';
    const clip = document.createElement('div');
    clip.className = 'vclip';
    nar.after(clip);
    const showClip = () => {
      const url = st.voice && ((session.voices || {})[st.voice] || (session.assets || {})[st.voice]);
      clip.innerHTML = '';
      clip.className = 'vclip';
      if (!url) return;
      if ((st.voiceText || st.narration) !== st.narration) {
        clip.classList.add('stale');
        clip.textContent = '🔊 voice outdated: the text changed (Generate voice updates it)';
        return;
      }
      const b = document.createElement('button');
      b.textContent = '▶';
      b.title = 'Listen to this step';
      b.onclick = () => new Audio(url).play();
      clip.append(b, `🔊 ${((st.voiceMs || 0) / 1000).toFixed(1)} s`);
    };
    showClip();
    nar.onchange = async () => { st.narration = nar.value.trim() || undefined; await db.putStep(st); showClip(); renderVoiceInfo(id); refreshPreview(id); };
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
      refreshPreview(id);
    };
    tbody.appendChild(tr);
  });

  // ---------- narration ----------
  await renderNarration(id, session);
  await renderVoice(id, session);
  renderVersions(id, session);


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
  $('transcribe').title = elKey ? 'Send the audio to ElevenLabs speech-to-text' : 'Add your ElevenLabs API key in ⚙ Settings';
  $('narr-key').innerHTML = elKey
    ? 'ElevenLabs key: ✓ set (shared by all recordings · <a href="#settings">⚙ Settings</a>)'
    : 'ElevenLabs key: not set · <a href="#settings">add it in ⚙ Settings</a> to transcribe';
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

// ---------- voice-over (ElevenLabs text-to-speech) ----------
async function cachedVoices(refresh) {
  const { elKey, elVoices } = await chrome.storage.local.get(['elKey', 'elVoices']);
  if (!elKey) return { voices: [], key: '' };
  if (!refresh && Array.isArray(elVoices) && elVoices.length) return { voices: elVoices, key: elKey };
  const voices = (await listVoices(elKey)).map(({ id, name, description }) => ({ id, name, description }));
  await chrome.storage.local.set({ elVoices: voices });
  return { voices, key: elKey };
}

function fillVoices(select, voices, value) {
  select.innerHTML = '';
  for (const v of voices) {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.name + (v.description ? ' · ' + v.description : '');
    select.appendChild(o);
  }
  if (value && !voices.some((v) => v.id === value)) {
    const o = document.createElement('option');
    o.value = value; o.textContent = 'Voice ' + value.slice(0, 8);
    select.appendChild(o);
  }
  if (value) select.value = value;
}

async function renderVoiceInfo(id) {
  const info = $('vo-info');
  if (!info) return;
  const [session, steps] = await Promise.all([db.getSession(id), db.getSteps(id)]);
  const narrated = steps.filter((s) => s.narration);
  const ok = (s) => s.voice && ((session.voices || {})[s.voice] || (session.assets || {})[s.voice]) && (s.voiceText || s.narration) === s.narration;
  const voiced = narrated.filter(ok);
  const secs = voiced.reduce((n, s) => n + (s.voiceMs || 0), 0) / 1000;
  const vo = session.voiceover;
  info.textContent = !narrated.length ? 'no narration text yet: write it on the steps below, or transcribe a recording'
    : `${voiced.length}/${narrated.length} narrated steps voiced` + (voiced.length ? ` · ${Math.round(secs)} s` : '') + (vo && vo.name && voiced.length ? ` · ${vo.name}` : '');
  $('vo-gen').disabled = !narrated.length;
  $('vo-gen').textContent = voiced.length && voiced.length < narrated.length ? 'Voice the rest' : voiced.length ? 'Regenerate voice' : 'Generate voice';
  $('vo-clear').hidden = !steps.some((s) => s.voice);
}

async function renderVoice(id, session) {
  const sel = $('vo-voice');
  const status = $('vo-status');
  const prefs = await chrome.storage.local.get(['elKey', 'elVoice']);
  const current = (session.voiceover && session.voiceover.voiceId) || prefs.elVoice || '';
  await renderVoiceInfo(id);
  const load = async (refresh) => {
    status.className = 'muted';
    try {
      const { voices } = await cachedVoices(refresh);
      fillVoices(sel, voices, sel.value || current);
      status.textContent = voices.length ? '' : '';
    } catch (e) {
      status.className = 'bad';
      status.textContent = e.message || String(e);
      fillVoices(sel, [], current);
    }
  };
  if (!prefs.elKey) {
    sel.hidden = true; $('vo-reload').hidden = true; $('vo-gen').disabled = true;
    status.innerHTML = 'Add your ElevenLabs API key in <a href="#settings">⚙ Settings</a> to generate the voice from the narration text.';
    return;
  }
  await load(false);
  $('vo-reload').onclick = () => load(true);
  $('vo-gen').onclick = async () => {
    const all = $('vo-gen').textContent === 'Regenerate voice';
    if (all && !confirm('Generate the voice again for every narrated step? This uses ElevenLabs credits.')) return;
    await generateVoice(id, { voiceId: sel.value, voiceName: sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.split(' · ')[0] : '', all });
    renderEditor(id);
  };
  $('vo-clear').onclick = async () => {
    if (!confirm('Remove the voice clips? The narration text stays.')) return;
    const s = await db.getSession(id);
    for (const st of await db.getSteps(id)) {
      if (!st.voice) continue;
      if (s.assets) delete s.assets[st.voice];
      delete st.voice; delete st.voiceMs; delete st.voiceText;
      await db.putStep(st);
    }
    s.voices = {};
    await db.putSession(s);
    refreshPreview(id);
    renderEditor(id);
  };
}

// Voice the narrated steps of a recording. Only steps without an up-to-date clip, unless `all`
// or another voice/model was chosen. Clips are stored in session.voices (asset id → data URL).
async function generateVoice(id, { voiceId, voiceName, all = false, statusEl } = {}) {
  const status = statusEl || $('vo-status');
  const btn = $('vo-gen');
  const prefs = await chrome.storage.local.get(['elKey', 'elVoice', 'elTtsModel']);
  const session = await db.getSession(id);
  const steps = await db.getSteps(id);
  voiceId = voiceId || (session.voiceover && session.voiceover.voiceId) || prefs.elVoice;
  if (!voiceId) {
    const { voices } = await cachedVoices(false);
    if (voices[0]) { voiceId = voices[0].id; voiceName = voices[0].name; }
  }
  if (!prefs.elKey || !voiceId) throw new Error('Add your ElevenLabs key and pick a voice in ⚙ Settings.');
  const model = prefs.elTtsModel || DEFAULT_TTS_MODEL;
  const vo = session.voiceover || {};
  const same = vo.voiceId === voiceId && (vo.model || DEFAULT_TTS_MODEL) === model;
  session.voices = session.voices || {};
  const has = (st) => st.voice && (session.voices[st.voice] || (session.assets || {})[st.voice]) && (st.voiceText || st.narration) === st.narration;
  if (btn && !statusEl) btn.disabled = true;
  status.className = 'muted';
  status.textContent = 'Generating the voice with ElevenLabs…';
  try {
    const { voiced } = await voiceSteps(steps, {
      key: prefs.elKey, voiceId, model, languageCode: toIso639(session.lang),
      skip: (i) => !all && same && has(steps[i]),
      onClip: async (i, clip) => {
        const st = steps[i];
        if (st.voice) { delete session.voices[st.voice]; if (session.assets) delete session.assets[st.voice]; }
        const aid = nextAssetId({ ...(session.assets || {}), ...session.voices });
        session.voices[aid] = `data:${clip.mime};base64,${clip.base64}`;
        st.voice = aid; st.voiceMs = clip.ms; st.voiceText = st.narration;
        await db.putStep(st);
      },
      onProgress: (d, t) => { status.textContent = `Generating the voice with ElevenLabs… ${d}/${t}`; },
    });
    for (const st of steps) {
      if (st.voice && !st.narration) { delete session.voices[st.voice]; delete st.voice; delete st.voiceMs; delete st.voiceText; await db.putStep(st); }
    }
    session.voiceover = { voiceId, name: voiceName || (same ? vo.name : '') || '', model };
    status.className = 'ok';
    status.textContent = voiced ? `✓ Voiced ${voiced} step${voiced === 1 ? '' : 's'}. Preview or export to hear it.` : 'Every narrated step already has an up-to-date voice clip.';
    return voiced;
  } catch (e) {
    status.className = 'bad';
    status.textContent = e.message || String(e);
    throw e;
  } finally {
    await db.putSession(session);
    refreshPreview(id);
    if (btn && !statusEl) btn.disabled = false;
  }
}

// ---------- language versions (Claude translates; ElevenLabs voices) ----------
function renderVersions(id, session) {
  const sel = $('lv-lang');
  sel.innerHTML = TRANSLATION_LANGUAGES.map(([c, , label]) => `<option value="${c}">${label}</option>`).join('');
  chrome.storage.local.get(['lvLang', 'lvScreens', 'lvVoice']).then((p) => {
    sel.value = p.lvLang || (toIso639(session.lang) === 'en' ? 'es' : 'en');
    if (p.lvScreens === false) $('lv-screens').checked = false;
    if (p.lvVoice === false) $('lv-voice').checked = false;
  });
  sel.onchange = () => chrome.storage.local.set({ lvLang: sel.value });
  $('lv-screens').onchange = () => chrome.storage.local.set({ lvScreens: $('lv-screens').checked });
  $('lv-voice').onchange = () => chrome.storage.local.set({ lvVoice: $('lv-voice').checked });
  $('lv-go').onclick = () => createVersion(id, sel.value, { screens: $('lv-screens').checked, voice: $('lv-voice').checked });
}

async function storeImported({ session, screens, steps, css }) {
  for (const [k, text] of Object.entries(css)) await db.putCss(k, text);
  for (const s of screens) await db.putScreen(s);
  for (const st of steps) await db.addStep(st); // in order: keys follow the demo's step order
  await db.putSession(session);
}

async function createVersion(id, code, { screens = true, voice = true } = {}) {
  const status = $('lv-status');
  const btn = $('lv-go');
  const [, langName, label] = translationLanguage(code);
  const { anKey, anModel, elKey } = await chrome.storage.local.get(['anKey', 'anModel', 'elKey']);
  status.className = 'muted';
  if (!anKey) { status.innerHTML = 'Add your Anthropic API key in <a href="#settings">⚙ Settings</a> to translate with Claude.'; return; }
  const original = await db.getSession(id);
  const data = await buildDemoData(id);
  const items = collectTexts(data, { screens });
  const chars = items.reduce((n, it) => n + it.text.length, 0);
  if (!items.length) { status.textContent = 'Nothing to translate.'; return; }
  if (!confirm(`Translate ${items.length} strings (${chars.toLocaleString()} characters) into ${langName} with Claude${voice ? ', then generate the voice with ElevenLabs' : ''}?`)) return;
  btn.disabled = true;
  try {
    status.textContent = `Translating into ${langName} with Claude… 0/${items.length}`;
    const map = await translateTexts(items, {
      key: anKey, model: anModel || DEFAULT_CLAUDE_MODEL, lang: langName, title: data.manifest.title,
      onProgress: (d, t) => { status.textContent = `Translating into ${langName} with Claude… ${d}/${t}`; },
    });
    const voiceIds = data.manifest.steps.map((s) => s.voice).filter(Boolean);
    const changed = applyTranslations(data, map, { screens });
    for (const v of voiceIds) delete data.assets[v];
    data.manifest.lang = code;
    const newId = crypto.randomUUID();
    const rec = await importDemo(assembleDemo({ ...data, playerJs: '', playerCss: '' }), { sessionId: newId, existingCss: (k) => db.getCss(k) });
    Object.assign(rec.session, {
      title: `${original.title} · ${label}`, url: original.url, createdAt: Date.now(),
      versionOf: { id, lang: code }, exportInline: original.exportInline,
    });
    delete rec.session.imported;
    await storeImported(rec);
    status.className = 'ok';
    status.textContent = `✓ Translated ${changed} strings.`;
    if (voice && rec.steps.some((s) => s.narration)) {
      if (!elKey) status.textContent += ' Add an ElevenLabs key in ⚙ Settings to generate the voice.';
      else {
        try { await generateVoice(newId, { statusEl: status }); } catch { /* message shown in status */ }
      }
    }
    await renderSessions();
    location.hash = newId;
  } catch (e) {
    status.className = 'bad';
    status.textContent = e.message || String(e);
  } finally {
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
    await storeImported({ session, screens, steps, css });
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

// ---------- global settings (shared by all recordings) ----------
async function renderSettings() {
  currentId = null;
  await renderSessions();
  const main = $('main');
  main.innerHTML = '';
  main.appendChild($('settings-view').content.cloneNode(true));
  const liveLang = main.querySelector('[data-pref=narrationLang]');
  liveLang.innerHTML = LANGUAGES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const prefs = await chrome.storage.local.get(['elKey', 'elModel', 'elLang', 'narrationLang', 'elTtsModel', 'anKey', 'anModel', 'elVoice']);
  for (const el of main.querySelectorAll('[data-pref]')) {
    const key = el.dataset.pref;
    el.value = prefs[key] || '';
    el.onchange = async () => {
      await chrome.storage.local.set({ [key]: el.value.trim() });
      if (key === 'elKey') { $('key-result').className = 'muted'; $('key-result').textContent = el.value.trim() ? 'Saved.' : 'Removed.'; chrome.storage.local.remove('elVoices'); }
      if (key === 'anKey') { $('an-result').className = 'muted'; $('an-result').textContent = el.value.trim() ? 'Saved.' : 'Removed.'; }
    };
  }
  const keyInput = main.querySelector('[data-pref=elKey]');
  $('key-show').onclick = () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; };
  $('key-test').onclick = () => testKey(keyInput.value.trim());
  const anInput = main.querySelector('[data-pref=anKey]');
  $('an-show').onclick = () => { anInput.type = anInput.type === 'password' ? 'text' : 'password'; };
  $('an-test').onclick = async () => {
    const out = $('an-result');
    out.className = 'muted';
    if (!anInput.value.trim()) { out.textContent = 'Enter a key first.'; return; }
    out.textContent = 'Testing…';
    try {
      const r = await testClaudeKey(anInput.value.trim());
      out.className = r.ok ? 'ok' : 'bad';
      out.textContent = r.ok ? '✓ The key works.' : r.message;
    } catch (e) { out.className = 'bad'; out.textContent = 'Could not reach Anthropic: ' + (e.message || e); }
  };
  // Default voice
  const pick = $('voice-pick');
  const vres = $('voice-result');
  let voices = [];
  const loadVoices = async (refresh) => {
    try {
      voices = (await cachedVoices(refresh)).voices;
      fillVoices(pick, voices, prefs.elVoice || '');
      if (!voices.length) vres.textContent = 'Add the ElevenLabs key above, then ↻ to load the voices.';
    } catch (e) { vres.className = 'bad'; vres.textContent = e.message || String(e); }
  };
  await loadVoices(false);
  $('voice-load').onclick = () => loadVoices(true);
  pick.onchange = () => { prefs.elVoice = pick.value; chrome.storage.local.set({ elVoice: pick.value }); };
  $('voice-play').onclick = async () => {
    // Preview clips come from ElevenLabs' voice list (not cached): fetch the list once.
    try {
      const { elKey } = await chrome.storage.local.get('elKey');
      const v = (await listVoices(elKey)).find((x) => x.id === pick.value);
      if (v && v.preview) new Audio(v.preview).play();
    } catch (e) { vres.className = 'bad'; vres.textContent = e.message || String(e); }
  };
}

// Check the key can use Speech to Text, without transcribing anything: a tiny non-audio file is
// rejected as bad input (400/422) when the key is fine, and with 401 when it isn't allowed.
async function testKey(key) {
  const out = $('key-result');
  out.className = 'muted';
  if (!key) { out.textContent = 'Enter a key first.'; return; }
  out.textContent = 'Testing…';
  try {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(32)], { type: 'audio/mpeg' }), 'test.mp3');
    fd.append('model_id', 'scribe_v2');
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
    const body = await res.text();
    if (res.status === 401 && /speech_to_text/.test(body)) {
      out.className = 'bad';
      out.textContent = 'The key works but is not allowed to use Speech to Text: edit it in ElevenLabs (Developers → API keys) and enable that permission.';
    } else if (res.status === 401 || res.status === 403) {
      out.className = 'bad';
      out.textContent = 'ElevenLabs rejected the key (' + res.status + '). Check that it was copied completely.';
    } else if (res.status === 429) {
      out.className = 'bad';
      out.textContent = 'Rate limit or quota reached on this ElevenLabs account.';
    } else {
      out.className = 'ok';
      out.textContent = '✓ The key works for Speech to Text.';
    }
  } catch (e) {
    out.className = 'bad';
    out.textContent = 'Could not reach ElevenLabs: ' + (e.message || e);
  }
}

function route() {
  const h = location.hash.slice(1);
  if (h === 'settings') return renderSettings();
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
