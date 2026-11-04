// ElevenLabs text-to-speech: turn each step's narration into a voice clip.
// Shared by the extension and tools/voice.mjs: no browser-only APIs (fetch is passed in or global).

export const EL_API = (typeof process !== 'undefined' && process.env && process.env.ELEVENLABS_API_BASE) || 'https://api.elevenlabs.io';
export const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
export const TTS_FORMAT = 'mp3_44100_64'; // ~8 KB per second of speech, plenty for a voice-over

// A readable explanation of an ElevenLabs error (their bodies are JSON like {"detail":{"code","message"}}).
export function elErrorMessage(status, text, permission = '') {
  let detail = {};
  try { const j = JSON.parse(text); detail = typeof j.detail === 'object' && j.detail ? j.detail : { message: String(j.detail || j.message || '') }; } catch { detail = { message: String(text || '') }; }
  const code = String(detail.code || detail.status || '');
  const raw = String(detail.message || '');
  if (/invalid_api_key|authentication/i.test(code + ' ' + (detail.type || '')) || /key id used as api key/i.test(raw)) {
    return 'This isn\'t a valid ElevenLabs API key. Copy the key itself (it starts with sk_), not its ID: ElevenLabs → Developers → API keys → Create key.';
  }
  if (status === 401 && permission && new RegExp(permission).test(text)) {
    const name = { voices_read: 'Voices (read)', text_to_speech: 'Text to Speech', speech_to_text: 'Speech to Text' }[permission] || permission;
    return `The key works but isn't allowed to use ${name}: edit the key in ElevenLabs (Developers → API keys) and enable that permission.`;
  }
  if (status === 401) return 'ElevenLabs rejected the key. Check it was copied completely in ⚙ Settings.';
  if (status === 402 || /quota|credits/i.test(code + raw)) return 'Not enough ElevenLabs credits for this.';
  if (status === 429) return 'ElevenLabs rate limit reached: try again in a moment.';
  if (status === 404) return 'Voice not found: pick another voice.';
  return `ElevenLabs error ${status}${raw ? ': ' + raw.slice(0, 160) : ''}`;
}

function elError(status, text, permission) {
  const e = new Error(elErrorMessage(status, text, permission));
  e.status = status;
  return e;
}

// [{ id, name, description }] of the voices this account can use.
export async function listVoices(key, fetchFn = globalThis.fetch.bind(globalThis)) {
  const res = await fetchFn(`${EL_API}/v1/voices`, { headers: { 'xi-api-key': key } });
  if (!res.ok) throw elError(res.status, await res.text(), 'voices_read');
  const json = await res.json();
  return (json.voices || []).map((v) => {
    const l = v.labels || {};
    const desc = [l.gender, l.age, l.accent, l.description || l.descriptive, l.use_case].filter(Boolean).join(', ');
    return { id: v.voice_id, name: v.name, description: desc, category: v.category || '', preview: v.preview_url || '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Models that accept language_code (multilingual v2 detects the language from the text).
const LANG_MODELS = /flash_v2_5|turbo_v2_5|eleven_v3/;

// One clip: { base64, mime, ms } where ms is when the speech ends.
export async function speak({ key, voiceId, text, model = DEFAULT_TTS_MODEL, previousText, nextText, languageCode, fetchFn = globalThis.fetch.bind(globalThis) }) {
  const body = { text, model_id: model };
  // Neighbouring sentences keep the intonation continuous from one step to the next.
  if (previousText) body.previous_text = previousText;
  if (nextText) body.next_text = nextText;
  if (languageCode && LANG_MODELS.test(model)) body.language_code = languageCode;
  const url = `${EL_API}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${TTS_FORMAT}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const json = await res.json();
      const ends = (json.alignment && json.alignment.character_end_times_seconds) || [];
      const bytes = Math.floor((json.audio_base64 || '').length * 3 / 4);
      const fromBytes = Math.round(bytes * 8 / 64); // 64 kbps
      const ms = ends.length ? Math.round(ends[ends.length - 1] * 1000) + 150 : fromBytes;
      return { base64: json.audio_base64, mime: 'audio/mpeg', ms };
    }
    if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); continue; }
    throw elError(res.status, await res.text(), 'text_to_speech');
  }
}

// Voice every narrated step of a step list. steps[i].narration → onClip(i, clip).
// Steps for which skip(i) returns true are left alone (e.g. already voiced).
export async function voiceSteps(steps, { key, voiceId, model, languageCode, onClip, onProgress, skip = () => false, fetchFn, concurrency = 2 }) {
  const todo = steps.map((s, i) => i).filter((i) => steps[i].narration && String(steps[i].narration).trim() && !skip(i));
  const narrated = steps.map((s, i) => i).filter((i) => steps[i].narration && String(steps[i].narration).trim());
  const neighbour = (i, d) => { const k = narrated.indexOf(i) + d; return k >= 0 && k < narrated.length ? steps[narrated[k]].narration : undefined; };
  let next = 0, done = 0;
  async function worker() {
    while (next < todo.length) {
      const i = todo[next++];
      const clip = await speak({ key, voiceId, model, languageCode, text: String(steps[i].narration).trim(), previousText: neighbour(i, -1), nextText: neighbour(i, 1), fetchFn });
      await onClip(i, clip);
      done++;
      if (onProgress) onProgress(done, todo.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return { voiced: todo.length };
}

// Next free asset id (aN) in an asset table.
export function nextAssetId(assets) {
  return 'a' + (1 + Math.max(0, ...Object.keys(assets || {}).map((k) => parseInt(k.slice(1), 10) || 0)));
}
