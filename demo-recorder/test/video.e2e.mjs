// Integration test for tools/video.mjs: a generated video with a sine-tone "voice", a stub
// ElevenLabs server, then prepare → transcribe → scaffold → crop → pack → compare → replay.
// Skips when ffmpeg isn't installed.   node test/video.e2e.mjs [outDir]
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'video-e2e-')));
const assert = (c, msg) => { if (!c) throw new Error('Assertion failed: ' + msg); console.log('  ✓ ' + msg); };

if (spawnSync('ffmpeg', ['-version']).error) { console.log('ffmpeg not installed: skipping video test'); process.exit(0); }
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const sh = (bin, args, env = {}) => {
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
const tool = (args, env) => sh('node', ['tools/video.mjs', ...args], env);

// 12 s, three UI-like "screens" (sidebar + content, a panel appears at 4 s, colors change at 8 s).
const video = path.join(OUT, 'walkthrough.mp4');
const scr = (bg, extra = '') => `color=c=${bg}:s=1280x800:d=4,drawbox=x=0:y=0:w=220:h=800:color=0x0f172a:t=fill${extra}`;
sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', scr('0xf1f5f9'),
  '-f', 'lavfi', '-i', scr('0xf1f5f9', ',drawbox=x=440:y=200:w=400:h=380:color=white:t=fill'),
  '-f', 'lavfi', '-i', scr('0xecfdf5'),
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
  '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);

const work = path.join(OUT, 'work');
tool(['prepare', video, work]);
const vj = JSON.parse(fs.readFileSync(path.join(work, 'video.json'), 'utf8'));
assert(vj.frames.length === 4 && Math.abs(vj.frames[1].t - 4.4) < 0.3 && Math.abs(vj.frames[2].t - 8.4) < 0.3,
  'prepare finds the key frames at the screen changes: ' + vj.frames.map((f) => f.t).join(', '));
assert(fs.existsSync(path.join(work, 'audio.mp3')) && fs.existsSync(path.join(work, 'frames', 'sheet-01.png')), 'audio track and contact sheet extracted');

// Stub ElevenLabs speech-to-text.
const w = (text, start) => ({ text, start, end: start + 0.3, type: 'word' });
const words = [w('Bienvenidos', 0.5), w('al', 0.9), w('pipeline.', 1.1), w('Abrimos', 4.8), w('una', 5.1), w('oportunidad.', 5.3), w('Y', 9.0), w('guardamos.', 9.2)];
let got = null;
const server = http.createServer((req, res) => {
  let n = 0;
  req.on('data', (c) => (n += c.length));
  req.on('end', () => {
    got = { url: req.url, key: req.headers['xi-api-key'], bytes: n };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ text: 'Bienvenidos al pipeline. Abrimos una oportunidad. Y guardamos.', language_code: 'es', words }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
try {
  await new Promise((resolve, reject) => {
    const p = spawn('node', ['tools/video.mjs', 'transcribe', work, '--lang', 'es'], {
      cwd: ROOT, env: { ...process.env, ELEVENLABS_API_KEY: 'test-key', ELEVENLABS_BASE_URL: `http://127.0.0.1:${server.address().port}` },
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
} finally {
  server.close();
}
assert(got && got.url === '/v1/speech-to-text' && got.key === 'test-key' && got.bytes > 5000, 'transcribe posts the audio to ElevenLabs speech-to-text');

const demoDir = path.join(OUT, 'demo', 'work');
tool(['scaffold', work, '--slug', 'walkthrough', '--title', 'Walkthrough', '--out', demoDir]);
const m = JSON.parse(fs.readFileSync(path.join(demoDir, 'demo.json'), 'utf8'));
assert(m.steps.length === 4 && m.steps[0].narration === 'Bienvenidos al pipeline.' && m.steps[1].narration === 'Abrimos una oportunidad.' && m.steps[2].narration === 'Y guardamos.',
  'scaffold puts each sentence on the screen it was spoken over');
assert(fs.existsSync(path.join(demoDir, 'NOTES.md')) && fs.existsSync(path.join(demoDir, 'css', 'app.css')), 'scaffold writes NOTES.md and the shared css');

const cropOut = tool(['crop', work, vj.frames[1].file, '440', '200', '400', '380', 'panel']);
const cropId = (cropOut.match(/^(a\d+) →/m) || [])[1];
assert(cropId && fs.existsSync(path.join(demoDir, 'assets', JSON.parse(fs.readFileSync(path.join(demoDir, 'assets', 'assets.json'), 'utf8'))[cropId])), 'crop stores a region of a frame as an asset');

// Rebuild screen 2 as HTML (what Claude does), using the crop and the shared css.
fs.writeFileSync(path.join(demoDir, 'css', 'app.css'), 'body{margin:0;background:#f1f5f9;display:grid;grid-template-columns:220px 1fr;height:100vh}nav{background:#0f172a}main{position:relative}.panel{position:absolute;left:220px;top:200px}');
fs.writeFileSync(path.join(demoDir, 'screens', 's2.html'),
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style data-demo-css="app"></style></head><body><nav></nav><main><img class="panel" data-demo-target="t1" src="demo-asset:${cropId}" width="400" height="380" alt=""></main></body></html>`);
m.steps[1] = { ...m.steps[1], type: 'click', target: 't1', x: 0.5, y: 0.5, label: 'Panel' };
fs.writeFileSync(path.join(demoDir, 'demo.json'), JSON.stringify(m, null, 2));

const packed = path.join(OUT, 'demo', 'walkthrough.demo.html');
const packOut = sh('node', ['tools/demo.mjs', 'pack', demoDir, packed]);
assert(/left out 1 unused asset/.test(packOut), 'pack leaves out the replaced placeholder frame');

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* optional */ }
if (!chromium) { console.log('Playwright not installed: skipping compare and replay'); process.exit(0); }
tool(['compare', work]);
assert(fs.readdirSync(path.join(work, 'compare')).filter((f) => f.endsWith('.png')).length === 4, 'compare writes a side-by-side image per screen');

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + packed + '?speed=4&autoplay=0');
await page.waitForFunction(() => window.demoPlayer);
await page.evaluate(() => { window.demoPlayer.play(); });
await page.waitForFunction(() => !window.demoPlayer.playing && window.demoPlayer.index >= window.demoPlayer.steps.length, null, { timeout: 30000 });
await b.close();
assert(errors.length === 0, 'the video-based demo replays to the end in the player');
console.log('\nVideo pipeline OK →', OUT);
