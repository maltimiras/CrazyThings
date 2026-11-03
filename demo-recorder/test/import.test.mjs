// Unit tests for extension/lib/import.js  —  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleDemo } from '../extension/lib/format.js';
import { importDemo } from '../extension/lib/import.js';

const manifest = {
  format: 'demo-recorder', version: 1, title: 'Pipeline · Acme', createdAt: '2026-11-01T10:00:00.000Z',
  viewport: { w: 1280, h: 800 },
  settings: { mode: 'guided', zoom: true, zoomLevel: 2.2 },
  screens: {
    s1: { url: 'https://app.acme.com/', title: 'Pipeline', viewport: { w: 1280, h: 800 } },
    s2: { url: 'https://app.acme.com/new', title: 'New deal', viewport: { w: 1280, h: 800 } },
  },
  steps: [
    { id: 1, type: 'start', screen: 's1', url: 'https://app.acme.com/', t: 0, narration: 'Welcome.' },
    { id: 2, type: 'click', screen: 's1', target: 't1', x: 0.5, y: 0.4, label: '+ New deal', zoom: false, t: 1500 },
    { id: 3, type: 'type', screen: 's2', target: 't2', from: '', text: 'Pilot', note: 'Name it', t: 3200 },
  ],
};
const screens = {
  s1: '<!DOCTYPE html><html><head><style data-demo-css="c1"></style></head><body><button data-demo-target="t1">+ New deal</button><img src="demo-asset:a1"></body></html>',
  s2: '<!DOCTYPE html><html><head><style data-demo-css="c1"></style></head><body><input data-demo-target="t2"></body></html>',
};
const file = assembleDemo({ manifest, screens, css: { c1: 'button{color:red}' }, assets: { a1: 'data:image/png;base64,AAAA' }, playerJs: '/*p*/', playerCss: '' });

test('importDemo rebuilds a recording from an exported file', async () => {
  const r = await importDemo(file, { sessionId: 'abcdef1234', now: 1_000_000 });
  assert.equal(r.session.title, 'Pipeline · Acme (imported)');
  assert.deepEqual(r.session.settings, manifest.settings);
  assert.deepEqual(r.session.assets, { a1: 'data:image/png;base64,AAAA' });
  assert.deepEqual(r.screens.map((s) => s.id), ['abcdef12-s1', 'abcdef12-s2']);
  assert.equal(r.screens[0].url, 'https://app.acme.com/');
  assert.deepEqual(r.steps.map((s) => [s.type, s.screen, s.t]), [
    ['start', 'abcdef12-s1', 1_000_000], ['click', 'abcdef12-s1', 1_001_500], ['type', 'abcdef12-s2', 1_003_200],
  ]);
  assert.equal(r.steps[0].narration, 'Welcome.');
  assert.equal(r.steps[1].zoom, false);
  assert.equal(r.steps[1].target, 't1');
  assert.equal(r.steps[2].note, 'Name it');
  assert.equal(r.steps[2].text, 'Pilot');
  assert.deepEqual(r.css, { c1: 'button{color:red}' });
  assert.deepEqual(r.warnings, []);
});

test('a different stylesheet under the same key is renamed, not overwritten', async () => {
  const r = await importDemo(file, { sessionId: 'abcdef1234', existingCss: async (k) => (k === 'c1' ? 'body{}' : undefined) });
  const [key] = Object.keys(r.css);
  assert.notEqual(key, 'c1');
  assert.ok(key.startsWith('c1i'));
  assert.ok(r.screens.every((s) => s.html.includes(`data-demo-css="${key}"`)));
  const same = await importDemo(file, { sessionId: 'abcdef1234', existingCss: async () => 'button{color:red}' });
  assert.deepEqual(Object.keys(same.css), ['c1']);
});

test('non-demo files and newer versions are reported clearly', async () => {
  await assert.rejects(importDemo('<html><body>hello</body></html>', { sessionId: 'x1234567' }), /isn't a Demo Recorder export/);
  const newer = file.replace('"version": 1', '"version": 99');
  const r = await importDemo(newer, { sessionId: 'x1234567' });
  assert.match(r.warnings[0], /newer version/);
});
