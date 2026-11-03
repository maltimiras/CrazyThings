// Unit tests for extension/lib/narration.js  —  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { wallToAudio, assignPhrases, livePhrases, wordsToPhrases, mergeNarration } from '../extension/lib/narration.js';

// Recording started at wall 10_000, paused at 14_000 (4 s recorded), resumed at 20_000.
const audio = { segments: [{ wall: 10_000, at: 0 }, { wall: 20_000, at: 4_000 }] };

test('wallToAudio skips paused time', () => {
  assert.equal(wallToAudio(audio, 10_000), 0);
  assert.equal(wallToAudio(audio, 12_500), 2.5);
  assert.equal(wallToAudio(audio, 21_000), 5);
  assert.equal(wallToAudio(audio, 9_000), 0); // before the mic started
});

const steps = [{ t: 10_000 }, { t: 12_000 }, { t: 21_000 }];

test('assignPhrases puts each phrase on the step that was on screen', () => {
  const out = assignPhrases(steps, audio, [
    { start: 0.3, text: 'Welcome.' },
    { start: 1.2, text: 'This is the pipeline.' },
    { start: 2.4, text: 'Let me open a deal.' },
    { start: 5.5, text: 'And save it.' },
  ]);
  assert.deepEqual(out, ['Welcome. This is the pipeline.', 'Let me open a deal.', 'And save it.']);
});

test('livePhrases maps wall-clock phrases through pauses', () => {
  const out = assignPhrases(steps, audio, livePhrases(audio, [{ wall: 12_300, text: 'Opening' }, { wall: 21_500, text: 'Saving' }]));
  assert.deepEqual(out, ['', 'Opening', 'Saving']);
});

test('wordsToPhrases groups ElevenLabs words into sentences', () => {
  const words = [
    { text: 'Hello', start: 0.1, end: 0.4, type: 'word' }, { text: ' ', start: 0.4, end: 0.45, type: 'spacing' },
    { text: 'team.', start: 0.45, end: 0.8, type: 'word' },
    { text: 'Now', start: 1.0, end: 1.2, type: 'word' }, { text: 'we', start: 1.25, end: 1.4, type: 'word' },
    { text: 'save', start: 2.6, end: 2.9, type: 'word' }, // long pause → new phrase
    { text: '(laughs)', start: 3.0, end: 3.2, type: 'audio_event' },
  ];
  assert.deepEqual(wordsToPhrases(words), [
    { start: 0.1, end: 0.8, text: 'Hello team.' },
    { start: 1.0, end: 1.4, text: 'Now we' },
    { start: 2.6, end: 2.9, text: 'save' },
  ]);
});

test('mergeNarration keeps text from a deleted step', () => {
  assert.equal(mergeNarration('First part.', 'Second part.'), 'First part. Second part.');
  assert.equal(mergeNarration('', 'Only this.'), 'Only this.');
  assert.equal(mergeNarration('Kept.', undefined), 'Kept.');
});

test('toIso639 maps recording languages to ElevenLabs codes', async () => {
  const { toIso639, languageName } = await import('../extension/lib/miclevel.js');
  assert.equal(toIso639('es-ES'), 'es');
  assert.equal(toIso639('ca-ES'), 'ca');
  assert.equal(toIso639('en_GB'), 'en');
  assert.equal(toIso639(''), '');
  assert.equal(toIso639(undefined), '');
  assert.equal(languageName('ca-ES'), 'Català');
  assert.equal(languageName(''), 'Browser default');
});
