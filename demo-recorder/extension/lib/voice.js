// ElevenLabs text-to-speech: turn each step's narration into a voice clip.
// Shared by the extension and tools/voice.mjs: no browser-only APIs (fetch is passed in or global).

export const EL_API = (typeof process !== 'undefined' && process.env && process.env.ELEVENLABS_API_BASE) || 'https://api.elevenlabs.io';
export const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
export const TTS_FORMAT = 'mp3_44100_64'; // ~8 KB per second of speech, plenty for a voice-over

function elError(status, text, permission) {
  let hint = '';
  if (status === 401 && new RegExp(permission).test(text)) {
    hint = `the key is not allowed to use ${permission === 'voices_read' ? 'Voices (read)' : 'Text to Speech'}: enable that permission on the key in ElevenLabs (Developers → API keys)`;
  } else if (status === 401) hint = 'check the ElevenLabs API key';
  else if (status === 402 || /quota/i.test(text)) hint = 'not enough ElevenLabs credits for this';
  else if (status === 429) hint = 'rate limit reached; try again shortly';
  else if (status === 404) hint = 'voice not found; pick another voice';
  const e = new Error(`ElevenLabs ${status}${hint ? ' — ' + hint : ''}: ${String(text).slice(0, 200)}`);
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
