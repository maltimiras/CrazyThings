// Unit tests for extension/lib/translate.js, extension/lib/voice.js and the CLI's texts/translate/voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assembleDemo, parseDemo } from '../extension/lib/format.js';
import { collectTexts, applyTranslations, translateTexts, testClaudeKey } from '../extension/lib/translate.js';
import { speak, voiceSteps, nextAssetId } from '../extension/lib/voice.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'tools', 'demo.mjs');

const demo = () => ({
  manifest: {
    title: 'Pipeline · Acme',
    screens: { s1: { title: 'Pipeline', url: 'https://app.acme.com/' } },
    steps: [
      { id: 1, type: 'start', screen: 's1', narration: 'Welcome to the pipeline.', voice: 'a9', voiceMs: 900 },
      { id: 2, type: 'click', screen: 's1', target: 't1', label: 'New deal', note: 'Create a deal' },
      { id: 3, type: 'type', screen: 's1', target: 't2', from: 'Pil', text: 'Pilot plan', narration: 'Give it a name.' },
    ],
  },
  screens: {
    s1: '<html><head><title>Pipeline</title><style>.a{content:"New deal"}</style></head><body>' +
      '<button data-demo-target="t1" title="New deal" class="btn">  New deal </button>' +
      '<input data-demo-target="t2" placeholder="Deal name" value="">' +
      '<span>jane@acme.com</span><b>$1,200</b><p>Owner: <i>Jane Cooper</i></p></body></html>',
  },
});

test('collectTexts lists each visible string once, narration as voice', () => {
  const items = collectTexts(demo());
  const texts = items.map((i) => i.text);
  for (const t of ['Pipeline · Acme', 'Pipeline', 'New deal', 'Create a deal', 'Pilot plan', 'Pil', 'Deal name', 'Owner:', 'Jane Cooper']) assert.ok(texts.includes(t), t);
  assert.equal(texts.filter((t) => t === 'New deal').length, 1);
  assert.ok(!texts.includes('jane@acme.com') && !texts.includes('$1,200'), 'emails and numbers are not sent');
  assert.ok(!texts.some((t) => t.includes('content')), 'CSS is not text');
  assert.equal(items.find((i) => i.text === 'Give it a name.').kind, 'voice');
  assert.ok(!collectTexts(demo(), { screens: false }).some((i) => i.text === 'Owner:'));
});

test('applyTranslations puts translations in place and keeps structure', () => {
  const d = demo();
  const n = applyTranslations(d, {
    'New deal': 'Nou acord', Pipeline: 'Embut', 'Deal name': 'Nom de l\'acord', 'Owner:': 'Responsable:',
    'Welcome to the pipeline.': 'Benvinguts a l\'embut.', 'Pilot plan': 'Pla pilot', 'Create a deal': 'Crea un acord',
  });
  assert.ok(n >= 7);
  const h = d.screens.s1;
  assert.match(h, /<button data-demo-target="t1" title="Nou acord" class="btn">  Nou acord <\/button>/);
  assert.match(h, /placeholder="Nom de l'acord"/);
  assert.match(h, /<title>Embut<\/title>/);
  assert.match(h, /content:"New deal"/, 'style untouched');
  assert.match(h, /Responsable: <i>Jane Cooper<\/i>/);
  const st = d.manifest.steps;
  assert.equal(st[0].narration, 'Benvinguts a l\'embut.');
  assert.equal(st[0].voice, undefined, 'old-language voice removed');
  assert.equal(st[1].label, 'Nou acord');
  assert.equal(st[2].text, 'Pla pilot');
  assert.equal(st[2].from, '', '"from" reset when it no longer prefixes the text');
  assert.equal(d.manifest.screens.s1.title, 'Embut');
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const { status = 200, json } = await handler(url, init, calls.length);
    return { ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
  };
  fn.calls = calls;
  return fn;
}

test('translateTexts calls Claude in batches with structured output', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ text: 'Item ' + i, kind: i === 4 ? 'voice' : 'ui' }));
  const f = fakeFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    const list = JSON.parse(body.messages[0].content.split('Items:\n')[1]);
    return { json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ translations: list.map((x) => ({ id: x.id, text: x.text.replace('Item', 'Element') })) }) }] } };
  });
  const map = await translateTexts(items, { key: 'sk-ant-x', lang: 'Catalan', title: 'Demo', fetchFn: f, maxItems: 2 });
  assert.equal(f.calls.length, 3);
  assert.equal(map.get('Item 3'), 'Element 3');
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.init.headers['x-api-key'], 'sk-ant-x');
  assert.equal(c.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(c.body.model, 'claude-opus-5-5');
  assert.equal(c.body.output_config.format.type, 'json_schema');
  assert.equal(c.body.temperature, undefined);
  assert.match(c.body.system, /Catalan/);
  assert.match(f.calls[2].body.messages[0].content, /"kind":"voice"/);
});

test('translateTexts splits a batch that ran out of tokens and explains errors', async () => {
  const items = Array.from({ length: 4 }, (_, i) => ({ text: 'T' + i, kind: 'ui' }));
  const f = fakeFetch(async (url, init) => {
    const list = JSON.parse(JSON.parse(init.body).messages[0].content.split('Items:\n')[1]);
    if (list.length > 2) return { json: { stop_reason: 'max_tokens', content: [] } };
    return { json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ translations: list.map((x) => ({ id: x.id, text: x.text + '!' })) }) }] } };
  });
  const map = await translateTexts(items, { key: 'k', lang: 'French', fetchFn: f });
  assert.equal(map.size, 4);
  assert.equal(map.get('T3'), 'T3!');
  const bad = fakeFetch(async () => ({ status: 401, json: { error: { message: 'invalid x-api-key' } } }));
  await assert.rejects(translateTexts(items, { key: 'k', lang: 'French', fetchFn: bad }), /401 — the Anthropic API key was rejected/);
  const ok = await testClaudeKey('k', fakeFetch(async () => ({ json: { data: [] } })));
  assert.equal(ok.ok, true);
});

test('speak and voiceSteps voice each narrated step with context', async () => {
  const f = fakeFetch(async (url, init) => ({ json: { audio_base64: 'AAAA', alignment: { character_end_times_seconds: [0.2, 1.25] } } }));
  const clip = await speak({ key: 'el', voiceId: 'v1', text: 'Hello', fetchFn: f });
  assert.equal(clip.ms, 1400);
  assert.match(f.calls[0].url, /\/v1\/text-to-speech\/v1\/with-timestamps\?output_format=mp3_44100_64$/);
  assert.equal(f.calls[0].init.headers['xi-api-key'], 'el');
  assert.equal(f.calls[0].body.model_id, 'eleven_multilingual_v2');
  assert.equal(f.calls[0].body.language_code, undefined, 'multilingual v2 detects the language');
  const steps = [{ narration: 'One.' }, {}, { narration: 'Two.' }, { narration: 'Three.' }];
  const got = {};
  await voiceSteps(steps, { key: 'el', voiceId: 'v1', fetchFn: f, skip: (i) => i === 3, onClip: (i, c) => { got[i] = c.ms; } });
  assert.deepEqual(Object.keys(got), ['0', '2']);
  const two = f.calls.find((c) => c.body.text === 'Two.');
  assert.equal(two.body.previous_text, 'One.');
  assert.equal(two.body.next_text, 'Three.');
  assert.equal(nextAssetId({ a1: 1, a7: 1 }), 'a8');
  const denied = fakeFetch(async () => ({ status: 401, json: { detail: { status: 'missing_permissions', message: 'missing text_to_speech' } } }));
  await assert.rejects(speak({ key: 'el', voiceId: 'v', text: 'x', fetchFn: denied }), /not allowed to use Text to Speech/);
});

function run(args, env) {
  return new Promise((resolve) => {
    const e = { ...process.env, ...env };
    delete e.HTTPS_PROXY; delete e.https_proxy; delete e.HTTP_PROXY; delete e.http_proxy;
    const p = spawn(process.execPath, [CLI, ...args], { env: e });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

test('CLI: texts → translate → voice', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-voice-'));
  const d = demo();
  delete d.manifest.steps[0].voice;
  const src = path.join(dir, 'acme.demo.html');
  fs.writeFileSync(src, assembleDemo({ ...d, css: {}, assets: {}, playerJs: '', playerCss: '' }));

  const texts = path.join(dir, 'texts.json');
  let r = await run(['texts', src, texts]);
  assert.equal(r.code, 0, r.out);
  const items = JSON.parse(fs.readFileSync(texts, 'utf8'));
  for (const it of items) it.to = it.text === 'Jane Cooper' ? '' : 'CA:' + it.text;
  fs.writeFileSync(texts, JSON.stringify(items));
  const out = path.join(dir, 'acme-ca.demo.html');
  r = await run(['translate', src, texts, out, '--lang', 'ca']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 string\(s\) had no translation/);
  let p = parseDemo(fs.readFileSync(out, 'utf8'));
  assert.equal(p.manifest.lang, 'ca');
  assert.equal(p.manifest.steps[0].narration, 'CA:Welcome to the pipeline.');
  assert.match(p.screens.s1, /CA:New deal/);

  // Voice it against a local stand-in for ElevenLabs.
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['xi-api-key'], body: body && JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/voices') return res.end(JSON.stringify({ voices: [{ voice_id: 'VOICEID1234567890ab', name: 'Laura', labels: { gender: 'female' } }] }));
      res.end(JSON.stringify({ audio_base64: Buffer.from('fake-mp3').toString('base64'), alignment: { character_end_times_seconds: [1.0] } }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const env = { ELEVENLABS_API_BASE: `http://127.0.0.1:${server.address().port}`, ELEVENLABS_API_KEY: 'test-key' };
  try {
    r = await run(['voice', out, '--voice', 'laura'], env);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Voiced 2 step\(s\)/);
    p = parseDemo(fs.readFileSync(out, 'utf8'));
    const v = p.manifest.steps.filter((s) => s.voice);
    assert.equal(v.length, 2);
    assert.equal(v[0].voiceMs, 1150);
    assert.match(p.assets[v[0].voice], /^data:audio\/mpeg;base64,/);
    assert.deepEqual(p.manifest.voiceover, { voiceId: 'VOICEID1234567890ab', name: 'Laura', model: 'eleven_multilingual_v2' });
    assert.ok(seen.every((s) => s.key === 'test-key'));
    // Running again only voices what changed.
    const n0 = seen.length;
    r = await run(['voice', out], env);
    assert.match(r.out, /Voiced 0 step\(s\) \(2 with voice/);
    assert.equal(seen.length, n0);
  } finally {
    server.close();
  }
});
