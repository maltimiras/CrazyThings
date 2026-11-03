// Narration helpers: map spoken phrases (live Chrome transcript or ElevenLabs word timings)
// onto demo steps. Pure functions, shared by the extension and the tests.
//
// session.audio = { mime, segments: [{ wall, at }], duration }
//   segments: one entry per recording start/resume; `wall` is Date.now() when the mic
//   (re)started, `at` the position in the audio (ms) at that moment. Pauses are not recorded,
//   so wall-clock step times map to audio time through the last segment before them.

export function wallToAudio(audio, wall) {
  const segs = (audio && audio.segments) || [];
  if (!segs.length) return 0;
  let seg = segs[0];
  for (const s of segs) if (s.wall <= wall) seg = s;
  return Math.max(0, seg.at + (wall - seg.wall)) / 1000; // seconds
}

// Audio time (s) at which each step starts.
export function stepStarts(steps, audio) {
  return steps.map((s) => wallToAudio(audio, s.t));
}

// Join phrases into per-step text: a phrase belongs to the last step that started before it.
// phrases: [{ start: seconds, text }] → array (same length as steps) of strings ('' = none).
export function assignPhrases(steps, audio, phrases) {
  const starts = stepStarts(steps, audio);
  const out = steps.map(() => []);
  for (const p of phrases) {
    const text = (p.text || '').trim();
    if (!text) continue;
    let k = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= p.start + 0.05) k = i;
    out[k].push(text);
  }
  return out.map((parts) => parts.join(' ').replace(/\s+/g, ' ').trim());
}

// Live Chrome transcript entries [{ wall, text }] → phrases.
export function livePhrases(audio, live) {
  return (live || []).map((p) => ({ start: wallToAudio(audio, p.wall), text: p.text }));
}

// ElevenLabs words [{ text, start, end, type }] → sentence phrases. A new phrase starts after
// sentence punctuation or a pause longer than `gap` seconds.
export function wordsToPhrases(words, gap = 0.7) {
  const phrases = [];
  let cur = null;
  let prev = null;
  for (const w of words || []) {
    if (w.type && w.type !== 'word') continue;
    const text = String(w.text || '').trim();
    if (!text) continue;
    const brk = !cur || (prev && (/[.?!…]$/.test(prev.text.trim()) || (w.start - prev.end) > gap));
    if (brk) {
      cur = { start: w.start, text };
      phrases.push(cur);
    } else {
      cur.text += /^[,.;:!?…)]/.test(text) ? text : ' ' + text;
    }
    prev = w;
  }
  return phrases;
}

// Text kept when a step is deleted: appended to the previous step's narration.
export function mergeNarration(prev, removed) {
  return [prev, removed].map((s) => (s || '').trim()).filter(Boolean).join(' ');
}
