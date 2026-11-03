// Microphone helpers shared by the popup (mic test), the narration panel and the offscreen
// recorder. Browser APIs are only touched inside functions, so the module also loads in Node
// (tests use the pure helpers).

// Languages offered for narration. Values are BCP-47 tags for Chrome's speech recognition;
// toIso639() turns them into the 2-letter codes ElevenLabs expects.
export const LANGUAGES = [
  ['', 'Browser default'],
  ['es-ES', 'Español'],
  ['ca-ES', 'Català'],
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch'],
  ['it-IT', 'Italiano'],
  ['pt-PT', 'Português'],
  ['nl-NL', 'Nederlands'],
];

export function toIso639(lang) {
  return lang ? String(lang).split(/[-_]/)[0].toLowerCase() : '';
}

export function languageName(lang) {
  const hit = LANGUAGES.find(([v]) => v === lang);
  return hit ? hit[1] : lang || 'Browser default';
}

export function fillLanguageSelect(select, value) {
  select.innerHTML = '';
  for (const [v, label] of LANGUAGES) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    select.appendChild(o);
  }
  select.value = LANGUAGES.some(([v]) => v === value) ? value : '';
}

// Open the chosen microphone; fall back to the default one if it is gone.
export async function openMic(deviceId, extra = {}) {
  const base = { echoCancellation: true, noiseSuppression: true, ...extra };
  if (deviceId && deviceId !== 'default') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } } });
      return { stream, fallback: false };
    } catch (e) {
      if (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError') throw e;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: base });
    return { stream, fallback: true };
  }
  return { stream: await navigator.mediaDevices.getUserMedia({ audio: base }), fallback: false };
}

export function micLabel(stream) {
  const t = stream && stream.getAudioTracks()[0];
  return (t && t.label) || 'Default microphone';
}

// Call onLevel(0..1) about 15 times a second with the input volume. Returns a stop function.
export function startLevel(stream, onLevel) {
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const timer = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    onLevel(Math.min(1, rms * 5));
  }, 66);
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return () => { clearInterval(timer); ctx.close().catch(() => {}); };
}

// Chrome's live speech recognition, restarted after silences.
// onText(text, isFinal, startedAtWall); onStatus('unavailable' | 'error', reason).
export function startRecognizer({ lang, onText, onStatus }) {
  const SR = self.webkitSpeechRecognition || self.SpeechRecognition;
  if (!SR) { onStatus && onStatus('unavailable', 'this browser has no speech recognition'); return { stop() {} }; }
  let wanted = true;
  let phraseStart = null;
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = lang || navigator.language || 'en-US';
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (phraseStart == null) phraseStart = Date.now() - 600; // first result lags the speech
      const text = ((res[0] && res[0].transcript) || '').trim();
      if (text) onText && onText(text, res.isFinal, phraseStart);
      if (res.isFinal) phraseStart = null;
    }
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return; // normal; onend restarts
    if (['not-allowed', 'service-not-allowed', 'language-not-supported', 'network', 'audio-capture'].includes(e.error)) {
      wanted = false;
      onStatus && onStatus('error', e.error);
    }
  };
  r.onend = () => { if (wanted) setTimeout(() => { try { r.start(); } catch {} }, 250); };
  try { r.start(); } catch (e) { onStatus && onStatus('error', e.message); }
  return {
    stop() { wanted = false; try { r.stop(); } catch {} },
    resume() { if (!wanted) { wanted = true; try { r.start(); } catch {} } },
  };
}
