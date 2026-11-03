// Narration panel: a small visible window open while recording with narration.
// Runs Chrome's live speech recognition (it doesn't work in the hidden offscreen document)
// and shows a volume bar, so the presenter can see the microphone is live.
// The demo records the page's HTML, not the screen, so this window is never in the demo.
import { openMic, startLevel, startRecognizer, languageName } from './lib/miclevel.js';

const $ = (id) => document.getElementById(id);
let recognizer = null;
let lang = '';

function send(msg) {
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch {}
}

function startRecognition() {
  recognizer = startRecognizer({
    lang,
    onText: (text, isFinal, wall) => {
      $('text').className = '';
      $('text').innerHTML = '';
      const span = document.createElement('span');
      span.textContent = text;
      if (!isFinal) span.className = 'interim';
      $('text').appendChild(span);
      if (isFinal) send({ type: 'transcript', wall, text });
    },
    onStatus: (status, reason) => {
      $('status').className = 'warn';
      $('status').textContent = `Live transcript not available (${reason}). The audio is still recorded: use "Transcribe with ElevenLabs" in the review page.`;
      send({ type: 'transcript-status', status, error: reason });
    },
  });
}

async function init() {
  const prefs = await chrome.storage.local.get(['narrationLang', 'recMicId']);
  lang = prefs.narrationLang || '';
  $('lang').textContent = '· ' + languageName(lang);
  try {
    const { stream } = await openMic(prefs.recMicId);
    startLevel(stream, (v) => { $('level').style.width = Math.round(v * 100) + '%'; });
  } catch (e) {
    $('status').className = 'warn';
    $('status').textContent = 'Microphone not available here: ' + (e.message || e.name);
  }
  startRecognition();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'narration') return false;
  if (msg.type === 'pause') {
    if (recognizer) recognizer.stop();
    $('hdr').classList.add('paused');
    $('title').textContent = 'Narration · paused';
  } else if (msg.type === 'resume') {
    startRecognition();
    $('hdr').classList.remove('paused');
    $('title').textContent = 'Narration · recording';
  }
  return false;
});

init();
