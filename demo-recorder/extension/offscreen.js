// Offscreen document: records the microphone for narration while a demo is being recorded.
// (Live transcription runs in the visible Narration panel, narration.js: Chrome's speech
// recognition doesn't work in hidden documents.)
import { db } from './lib/db.js';
import { openMic, micLabel } from './lib/miclevel.js';

let stream = null;
let rec = null;
let sessionId = null;
let n = 0;
const writes = new Set();

async function micStart(msg) {
  sessionId = msg.sessionId;
  n = 0;
  const opened = await openMic(msg.deviceId);
  stream = opened.stream;
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    const p = db.putAudioChunk(sessionId, n++, e.data).finally(() => writes.delete(p));
    writes.add(p);
  };
  rec.start(1000);
  return { ok: true, mime: rec.mimeType, startedAt: Date.now(), micLabel: micLabel(stream), fallback: opened.fallback };
}

async function micStop() {
  if (rec && rec.state !== 'inactive') await new Promise((r) => { rec.onstop = r; rec.stop(); });
  const stoppedAt = Date.now();
  await Promise.all([...writes]);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  rec = null;
  stream = null;
  return { ok: true, chunks: n, stoppedAt };
}

async function handle(msg) {
  switch (msg.type) {
    case 'mic-start': return micStart(msg);
    case 'mic-pause':
      if (rec && rec.state === 'recording') rec.pause();
      return { ok: true, at: Date.now() };
    case 'mic-resume':
      if (rec && rec.state === 'paused') rec.resume();
      return { ok: true, at: Date.now() };
    case 'mic-stop': return micStop();
    default: return { error: 'unknown offscreen message ' + msg.type };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;
  handle(msg).then(sendResponse, (e) => sendResponse({ error: (e && (e.name + ': ' + e.message)) || String(e) }));
  return true;
});
