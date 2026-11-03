// Offscreen document: records the microphone for narration while a demo is being recorded,
// and (in Google Chrome) transcribes it live with the built-in speech recognition.
import { db } from './lib/db.js';

let stream = null;
let rec = null;
let sessionId = null;
let n = 0;
const writes = new Set();
let recog = null;
let recogWanted = false;
let lang = '';

function send(msg) {
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch {}
}

// ---------- live speech recognition (Google Chrome only) ----------
function startRecognition() {
  const SR = self.webkitSpeechRecognition || self.SpeechRecognition;
  if (!SR) { send({ type: 'transcript-status', status: 'unsupported' }); return; }
  recogWanted = true;
  if (recog) { try { recog.start(); } catch {} return; }
  recog = new SR();
  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = lang || navigator.language || 'en-US';
  let phraseStart = null;
  recog.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      // First (interim) result arrives a moment after speech starts.
      if (phraseStart == null) phraseStart = Date.now() - 600;
      if (r.isFinal) {
        const text = (r[0] && r[0].transcript || '').trim();
        if (text) send({ type: 'transcript', wall: phraseStart, text });
        phraseStart = null;
      }
    }
  };
  recog.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') {
      recogWanted = false;
      send({ type: 'transcript-status', status: 'error', error: e.error });
    }
  };
  // Recognition stops by itself after silences: keep it going while recording.
  recog.onend = () => { if (recogWanted) setTimeout(() => { try { recog.start(); } catch {} }, 250); };
  try { recog.start(); } catch {}
}

function stopRecognition() {
  recogWanted = false;
  if (recog) { try { recog.stop(); } catch {} }
}

// ---------- recording ----------
async function micStart(msg) {
  sessionId = msg.sessionId;
  lang = msg.lang || '';
  n = 0;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    const p = db.putAudioChunk(sessionId, n++, e.data).finally(() => writes.delete(p));
    writes.add(p);
  };
  rec.start(1000);
  const startedAt = Date.now();
  if (msg.live !== false) startRecognition();
  return { ok: true, mime: rec.mimeType, startedAt };
}

async function micStop() {
  stopRecognition();
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
      stopRecognition();
      return { ok: true, at: Date.now() };
    case 'mic-resume':
      if (rec && rec.state === 'paused') rec.resume();
      startRecognition();
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
