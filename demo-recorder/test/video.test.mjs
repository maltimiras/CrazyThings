// Unit tests for tools/videolib.mjs  —  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShowinfo, selectFrames, guessViewport, frameName, buildScaffold, resolveScreen } from '../tools/videolib.mjs';

test('parseShowinfo reads frame times from ffmpeg output', () => {
  const log = '[Parsed_showinfo_1 @ 0x1] n:   0 pts:  51200 pts_time:4       duration...\n[Parsed_showinfo_1 @ 0x1] n:   1 pts: 102400 pts_time:8.533   ...';
  assert.deepEqual(parseShowinfo(log), [4, 8.533]);
  assert.deepEqual(parseShowinfo('nothing here'), []);
});

test('selectFrames keeps start/end, settles after changes, drops near-duplicates and fills long gaps', () => {
  assert.deepEqual(selectFrames([4, 4.2, 8], 12), [0, 4.4, 8.4, 11.95]);
  const long = selectFrames([], 31);
  assert.equal(long[0], 0);
  assert.equal(long[long.length - 1], 30.95);
  assert.ok(long.length >= 4, 'static 31 s gets in-between frames');
  for (let i = 1; i < long.length; i++) assert.ok(long[i] - long[i - 1] <= 10.01);
});

test('guessViewport assumes 2× for retina-sized recordings', () => {
  assert.deepEqual(guessViewport(2880, 1800), { w: 1440, h: 900, dpr: 2 });
  assert.deepEqual(guessViewport(1920, 1080), { w: 1920, h: 1080, dpr: 1 });
  assert.deepEqual(guessViewport(2560, 1600, 1), { w: 2560, h: 1600, dpr: 1 });
  assert.equal(frameName(2, 12.34), 'f003_012.3s.png');
});

test('buildScaffold makes one step per frame with narration from the transcript', () => {
  const video = {
    source: '/x/demo.mp4', duration: 12, width: 1280, height: 800, viewport: { w: 1280, h: 800, dpr: 1 },
    frames: [{ file: 'f001.png', t: 0 }, { file: 'f002.png', t: 4.4 }, { file: 'f003.png', t: 11.95 }],
  };
  const w = (text, start) => ({ text, start, end: start + 0.3, type: 'word' });
  const words = [w('Hola', 0.5), w('equipo.', 0.9), w('Abrimos', 4.8), w('el', 5.1), w('formulario.', 5.3)];
  const { manifest, screens, notes } = buildScaffold({ title: 'Demo', video, words, frameAssets: ['a1', 'a2', 'a3'] });
  assert.deepEqual(manifest.steps.map((s) => [s.type, s.screen, s.t]), [['start', 's1', 0], ['change', 's2', 4400], ['end', 's3', 11950]]);
  assert.deepEqual(manifest.steps.map((s) => s.narration || ''), ['Hola equipo.', 'Abrimos el formulario.', '']);
  assert.equal(manifest.screens.s2.frame, 'f002.png');
  assert.ok(screens.s1.includes('demo-asset:a1') && screens.s1.includes('data-demo-css="app"') && screens.s1.includes('data-demo-placeholder'));
  assert.match(notes, /\| 2 \| change \| 4\.4 s \| s2 \|/);
  assert.equal(resolveScreen('<style data-demo-css="app"></style><img src="demo-asset:a1">', { app: 'b{}' }, { a1: 'data:x' }), '<style>b{}</style><img src="data:x">');
});
