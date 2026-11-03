// Translate a demo into another language: collect every visible string (screens, captions,
// narration, typed text), translate them, and put the translations back in place.
// Shared by the extension and tools/demo.mjs: no browser-only APIs (fetch is passed in or global).
import { decode, escText, escAttr, visitHtml } from './text.js';

// Attributes that are shown to the viewer (tooltips, placeholders, alt text, field values).
const TEXT_ATTRS = /^(placeholder|title|alt|value|label|aria-label|aria-placeholder|aria-description|aria-valuetext|data-tooltip|data-title|data-label|data-placeholder|tooltip)$/i;
const STEP_TEXT = ['label', 'note', 'text', 'from'];

const worth = (t) => /\p{L}/u.test(t) && !/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t) && !/^(https?:|www\.)\S+$/i.test(t);
const split = (s) => { const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/); return [m[1], m[2], m[3]]; };

function walkScreen(html, fn, cssAttrs) {
  // fn(text, kind) → replacement text or undefined (keep). Text nodes and visible attributes only.
  return visitHtml(html,
    (raw) => {
      const [lead, core, trail] = split(decode(raw));
      if (!core || !worth(core)) return raw;
      const t = fn(core, 'ui');
      return t == null || t === core ? raw : lead + escText(t) + trail;
    },
    (raw, name) => {
      if (!TEXT_ATTRS.test(name) && !cssAttrs.has(name.toLowerCase())) return raw;
      const v = decode(raw).trim();
      if (!v || !worth(v)) return raw;
      const t = fn(v, 'ui');
      return t == null || t === v ? raw : escAttr(t);
    });
}

// Visit every translatable string of a demo ({ manifest, screens }). fn(text, kind) may return a
// replacement; kind is 'ui' (screen text, captions, typed values) or 'voice' (narration).
export function mapDemoTexts(data, fn, { screens = true } = {}) {
  const m = data.manifest;
  const one = (v, kind) => {
    if (typeof v !== 'string') return v;
    const [lead, core, trail] = split(v);
    if (!core || !worth(core)) return v;
    const t = fn(core, kind);
    return t == null ? v : lead + t + trail;
  };
  if (m.title) m.title = one(m.title, 'ui');
  for (const meta of Object.values(m.screens || {})) if (meta && meta.title) meta.title = one(meta.title, 'ui');
  for (const s of m.steps || []) {
    for (const k of STEP_TEXT) if (typeof s[k] === 'string') s[k] = one(s[k], 'ui');
    if (typeof s.narration === 'string') s.narration = one(s.narration, 'voice');
  }
  if (screens) {
    // Attributes the CSS shows on screen with content: attr(x) (e.g. custom placeholders) are text too.
    const cssAttrs = new Set();
    for (const t of [...Object.values(data.css || {}), ...Object.values(data.screens || {})]) {
      for (const m of String(t).matchAll(/attr\(\s*([\w-]+)/g)) cssAttrs.add(m[1].toLowerCase());
    }
    for (const id of Object.keys(data.screens || {})) data.screens[id] = walkScreen(data.screens[id], fn, cssAttrs);
  }
  return data;
}

// Distinct strings to translate, in order of first appearance: [{ text, kind }].
export function collectTexts(data, opts) {
  const seen = new Map();
  const copy = { manifest: JSON.parse(JSON.stringify(data.manifest)), screens: { ...(data.screens || {}) }, css: data.css };
  mapDemoTexts(copy, (text, kind) => {
    const e = seen.get(text);
    if (!e) seen.set(text, { text, kind });
    else if (kind === 'voice') e.kind = 'voice';
    return undefined;
  }, opts);
  return [...seen.values()];
}

// Apply { original: translation } to a demo, in place. Returns how many strings changed.
export function applyTranslations(data, map, opts) {
  let n = 0;
  const get = (text) => {
    const t = map instanceof Map ? map.get(text) : map[text];
    if (typeof t === 'string' && t.trim() && t !== text) { n++; return t; }
    return undefined;
  };
  mapDemoTexts(data, get, opts);
  // Typed text: the player types "from" → "text"; keep that working when only one was translated.
  for (const s of data.manifest.steps || []) {
    if (s.type === 'type' && typeof s.from === 'string' && typeof s.text === 'string' && s.from && !s.text.startsWith(s.from)) s.from = '';
  }
  // Voices belong to the original language.
  for (const s of data.manifest.steps || []) { delete s.voice; delete s.voiceMs; }
  return n;
}

// ------------------------------------------------------------------ Claude (Anthropic API)
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
const API = 'https://api.anthropic.com/v1/messages';

const SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false },
    },
  },
  required: ['translations'],
  additionalProperties: false,
};

function systemPrompt(lang) {
  return `You translate the text of a recorded software product demo into ${lang}.

Items with kind "ui" are user-interface strings taken from the app's screens: buttons, menus, labels, headings, table cells, page titles, captions and values typed into fields. Items with kind "voice" are the presenter's voice-over, which a text-to-speech voice will read aloud while the demo plays.

Rules:
- Translate each item into natural ${lang}, as it would appear in a professionally localized version of the product.
- Keep unchanged: product, company and brand names, people's names, email addresses, URLs, file names, codes and IDs, and numbers. Don't convert currencies, dates or units.
- UI strings: keep them about as long as the original, with the same capitalization style and punctuation (a trailing colon or ellipsis stays). Use the same translation for the same term everywhere.
- Voice-over: natural spoken ${lang} with the same meaning and roughly the same length, so it still fits the screens it plays over.
- If an item is already in ${lang} or shouldn't be translated (a name, a code), return it unchanged.
- Return every id exactly once.`;
}

function claudeError(status, body) {
  const msg = (body && body.error && body.error.message) || '';
  const hint = {
    401: 'the Anthropic API key was rejected; check it in ⚙ Settings',
    403: 'this API key is not allowed to use that model',
    404: 'unknown model; check the Claude model in ⚙ Settings',
    429: 'rate limit reached; try again in a minute',
    529: 'Claude is overloaded right now; try again shortly',
  }[status] || '';
  const e = new Error(`Claude API ${status}${hint ? ' — ' + hint : ''}${msg ? ': ' + msg : ''}`);
  e.status = status;
  return e;
}

async function callClaude(items, { key, model, lang, title, fetchFn, fallback = true }) {
  const useFallback = fallback && /^claude-opus-5-5/.test(model);
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2026-10-21',
    // Needed for calls from a browser (here: the extension page). The key never leaves this browser otherwise.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (useFallback) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  const body = {
    model,
    max_tokens: 16000,
    system: systemPrompt(lang),
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: `Demo: ${title || 'product demo'}\nTarget language: ${lang}\n\nItems:\n` +
        JSON.stringify(items.map((it, i) => ({ id: i + 1, kind: it.kind, text: it.text }))),
    }],
  };
  if (useFallback) body.fallbacks = 'default';
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(API, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      if (json.stop_reason === 'refusal') throw new Error('Claude declined to translate part of this demo.');
      if (json.stop_reason === 'max_tokens') { const e = new Error('too long'); e.tooLong = true; throw e; }
      const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const out = JSON.parse(text).translations || [];
      const result = new Array(items.length).fill(null);
      for (const t of out) if (t && t.id >= 1 && t.id <= items.length && typeof t.text === 'string') result[t.id - 1] = t.text;
      return result;
    }
    // Retry without the refusal fallback if this account/model doesn't accept it.
    if (res.status === 400 && useFallback && /fallback/i.test(JSON.stringify(json))) {
      return callClaude(items, { key, model, lang, title, fetchFn, fallback: false });
    }
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw claudeError(res.status, json);
  }
}

// Translate [{ text, kind }] with Claude. Returns a Map original → translation (missing = keep).
export async function translateTexts(items, { key, model = DEFAULT_CLAUDE_MODEL, lang, title = '', onProgress, fetchFn = globalThis.fetch.bind(globalThis), concurrency = 3, maxChars = 3500, maxItems = 80 } = {}) {
  if (!key) throw new Error('Add your Anthropic API key in ⚙ Settings to translate.');
  const batches = [];
  let cur = [], chars = 0;
  for (const it of items) {
    if (cur.length && (chars + it.text.length > maxChars || cur.length >= maxItems)) { batches.push(cur); cur = []; chars = 0; }
    cur.push(it); chars += it.text.length;
  }
  if (cur.length) batches.push(cur);
  const map = new Map();
  let done = 0, next = 0;
  async function run(batch) {
    try {
      const out = await callClaude(batch, { key, model, lang, title, fetchFn });
      batch.forEach((it, i) => { if (out[i] != null) map.set(it.text, out[i]); });
    } catch (e) {
      if (!e.tooLong || batch.length < 2) throw e;
      const h = Math.ceil(batch.length / 2);
      await run(batch.slice(0, h));
      await run(batch.slice(h));
      return;
    }
  }
  async function worker() {
    while (next < batches.length) {
      const b = batches[next++];
      await run(b);
      done += b.length;
      if (onProgress) onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return map;
}

// Check an Anthropic key without spending tokens (lists models).
export async function testClaudeKey(key, fetchFn = globalThis.fetch.bind(globalThis)) {
  const res = await fetchFn('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' },
  });
  if (res.ok) return { ok: true };
  const json = await res.json().catch(() => ({}));
  return { ok: false, status: res.status, message: claudeError(res.status, json).message };
}

// Languages offered for versions: [ISO 639-1 code, name for the prompt, label in the menu].
// All are spoken by ElevenLabs' multilingual voices.
export const TRANSLATION_LANGUAGES = [
  ['en', 'English', 'English'], ['es', 'Spanish (Spain)', 'Español'], ['ca', 'Catalan', 'Català'],
  ['fr', 'French', 'Français'], ['de', 'German', 'Deutsch'], ['it', 'Italian', 'Italiano'],
  ['pt', 'Portuguese (Portugal)', 'Português'], ['pt-BR', 'Brazilian Portuguese', 'Português (Brasil)'],
  ['es-419', 'Latin American Spanish', 'Español (Latinoamérica)'], ['nl', 'Dutch', 'Nederlands'],
  ['pl', 'Polish', 'Polski'], ['sv', 'Swedish', 'Svenska'], ['da', 'Danish', 'Dansk'], ['no', 'Norwegian', 'Norsk'],
  ['fi', 'Finnish', 'Suomi'], ['cs', 'Czech', 'Čeština'], ['ro', 'Romanian', 'Română'], ['hu', 'Hungarian', 'Magyar'],
  ['el', 'Greek', 'Ελληνικά'], ['tr', 'Turkish', 'Türkçe'], ['uk', 'Ukrainian', 'Українська'], ['ru', 'Russian', 'Русский'],
  ['ar', 'Arabic', 'العربية'], ['hi', 'Hindi', 'हिन्दी'], ['id', 'Indonesian', 'Bahasa Indonesia'],
  ['ja', 'Japanese', '日本語'], ['ko', 'Korean', '한국어'], ['zh', 'Simplified Chinese', '中文（简体）'],
];
export const translationLanguage = (code) => TRANSLATION_LANGUAGES.find(([c]) => c === code) || [code, code, code];
