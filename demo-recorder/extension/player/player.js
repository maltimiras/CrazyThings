/* Demo Recorder player — replays a recorded demo inside sandboxed iframes.
 * Data comes either from window.DEMO_SOURCE (extension preview) or from the
 * <script> blocks of an exported demo file. */
(function () {
  'use strict';

  var ABORT = { abort: true };
  var unescapeRaw = function (s) { return s.replace(/<\\\/(script)/gi, '<' + '/$1').replace(/<\\!--/g, '<!--'); };

  function fromDom() {
    var manifest = JSON.parse(document.getElementById('demo-data').textContent);
    var assetsEl = document.getElementById('demo-assets');
    var assets = assetsEl ? JSON.parse(assetsEl.textContent || '{}') : {};
    return {
      manifest: manifest,
      assets: assets,
      screen: function (id) {
        var el = document.getElementById('screen-' + id);
        return el ? unescapeRaw(el.textContent).replace(/^\n/, '') : '<p style="font:16px sans-serif;padding:40px">Missing screen ' + id + '</p>';
      },
      css: function (key) {
        var el = document.getElementById('css-' + key);
        return el ? unescapeRaw(el.textContent) : '';
      },
    };
  }

  var src = window.DEMO_SOURCE || fromDom();
  var M = src.manifest;
  var steps = M.steps || [];
  var params = new URLSearchParams(location.search);
  var settings = Object.assign({ mode: 'autoplay', speed: 1, browserFrame: true, cursor: true, showKeys: true, subtitles: true, timing: 'auto', zoom: false, zoomLevel: 1.8, captions: true, controls: true, autoStart: false, background: 'dark', loop: false }, M.settings || {});
  if (params.get('mode')) settings.mode = params.get('mode');
  if (params.get('speed')) settings.speed = +params.get('speed') || 1;
  function flag(name, key) {
    var v = params.get(name);
    if (v === '0' || v === 'false') settings[key] = false;
    else if (v === '1' || v === 'true') settings[key] = true;
  }
  flag('autoplay', 'autoStart');
  flag('loop', 'loop');
  flag('controls', 'controls');
  flag('frame', 'browserFrame');
  flag('cursor', 'cursor');
  flag('keys', 'showKeys');
  flag('zoom', 'zoom');
  flag('subs', 'subtitles');
  if (params.get('timing') === 'recorded' || params.get('timing') === 'auto') settings.timing = params.get('timing');
  flag('captions', 'captions');
  if (params.get('bg')) settings.background = params.get('bg');
  if (settings.captions === false) steps.forEach(function (s) { delete s.note; });

  // ---------------------------------------------------------------- DOM
  var root = document.getElementById('demo-root');
  root.innerHTML =
    '<div class="dp-stage">' +
      '<div class="dp-window">' +
        '<div class="dp-bar"><div class="dp-dots"><i></i><i></i><i></i></div><div class="dp-url"></div></div>' +
        '<div class="dp-viewport">' +
          // .dp-zoom is the "camera": a CSS transform over the live HTML (nothing is rasterized).
          '<div class="dp-zoom">' +
            '<iframe class="dp-frame on" sandbox="allow-same-origin" title="demo"></iframe>' +
            '<iframe class="dp-frame" sandbox="allow-same-origin" title="demo"></iframe>' +
            '<div class="dp-overlay">' +
              '<div class="dp-cursor"><svg viewBox="0 0 24 24"><path d="M4 2.5l15.5 9.2-6.9 1.4 4 7.3-3 1.6-4-7.4L4.5 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>' +
            '</div>' +
          '</div>' +
          '<div class="dp-hud">' +
            '<div class="dp-callout"></div>' +
            '<div class="dp-keycap"></div>' +
            '<div class="dp-subtitle"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dp-cover"><button type="button"></button></div>' +
    '</div>' +
    '<div class="dp-controls">' +
      '<button type="button" data-a="play" title="Play / pause (space)">▶</button>' +
      '<button type="button" data-a="restart" title="Restart">⟲</button>' +
      '<button type="button" data-a="prev" title="Previous step (←)">‹</button>' +
      '<button type="button" data-a="next" title="Next step (→)">›</button>' +
      '<div class="dp-progress"><div class="dp-track"></div></div>' +
      '<span class="dp-count"></span>' +
      '<select data-a="mode" title="Mode"><option value="autoplay">Autoplay</option><option value="guided">Guided</option></select>' +
      '<select data-a="pace" title="Pace"><option value="auto">Natural pace</option><option value="recorded">As recorded</option></select>' +
      '<select data-a="speed" title="Speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>' +
      '<button type="button" data-a="fs" title="Fullscreen">⛶</button>' +
    '</div>';

  var $ = function (sel) { return root.querySelector(sel); };
  var stage = $('.dp-stage'), win = $('.dp-window'), viewport = $('.dp-viewport'), urlEl = $('.dp-url');
  var frames = root.querySelectorAll('.dp-frame');
  var zoomEl = $('.dp-zoom');
  var hud = $('.dp-hud'), subtitle = $('.dp-subtitle');
  var overlay = $('.dp-overlay'), cursorEl = $('.dp-cursor'), callout = $('.dp-callout'), keycap = $('.dp-keycap');
  var cover = $('.dp-cover'), coverBtn = $('.dp-cover button');
  var track = $('.dp-track'), countEl = $('.dp-count'), playBtn = root.querySelector('[data-a=play]');
  var modeSel = root.querySelector('[data-a=mode]'), speedSel = root.querySelector('[data-a=speed]'), paceSel = root.querySelector('[data-a=pace]');

  document.title = M.title || document.title;
  if (!settings.browserFrame) win.classList.add('dp-noframe');
  if (!settings.cursor) cursorEl.classList.add('hidden');
  if (settings.controls === false) root.classList.add('dp-nocontrols');
  document.documentElement.classList.add('dp-bg-' + (settings.background || 'dark'));
  modeSel.value = settings.mode;
  paceSel.value = settings.timing === 'recorded' ? 'recorded' : 'auto';
  speedSel.value = String(settings.speed);
  if (!speedSel.value) { speedSel.value = '1'; }

  // ---------------------------------------------------------------- state
  var vp = Object.assign({ w: 1280, h: 800 }, M.viewport || {});
  var scale = 1;
  var cur = 0;            // index of the visible frame
  var shownId = null;     // screen shown in the visible frame
  var pristine = false;   // visible frame untouched since load
  var preload = null;     // { id, p } loading into the hidden frame
  var htmlCache = {};
  var idx = 0;
  var playing = false;
  var runId = 0;
  var pending = [];
  var waiter = null;
  var cursor = { x: vp.w / 2, y: vp.h / 2 };
  var zoom = { z: 1, tx: 0, ty: 0 };

  // ---------------------------------------------------------------- helpers
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function sleep(ms) {
    var my = runId;
    return new Promise(function (res, rej) {
      var entry = { rej: rej };
      entry.t = setTimeout(function () {
        pending.splice(pending.indexOf(entry), 1);
        if (my === runId) res(); else rej(ABORT);
      }, ms / settings.speed);
      pending.push(entry);
    });
  }

  function abortAll() {
    runId++;
    pending.splice(0).forEach(function (e) { clearTimeout(e.t); e.rej(ABORT); });
    if (waiter) { var w = waiter; waiter = null; w.rej(ABORT); }
    hideHotspot();
  }

  function check(my) { if (my !== runId) throw ABORT; }

  function buildHtml(id) {
    if (htmlCache[id]) return htmlCache[id];
    var html = src.screen(id);
    html = html.replace(/<style data-demo-css="([^"]+)"([^>]*)><\/style>/g, function (m, key, rest) {
      return '<style data-demo-css="' + key + '"' + rest + '>' + src.css(key).replace(/<\/style/gi, '<\\/style') + '</style>';
    });
    html = html.replace(/demo-asset:(a\d+)/g, function (m, id) { return src.assets[id] || m; });
    htmlCache[id] = html;
    return html;
  }

  function deepAll(rootNode, sel, out) {
    out = out || [];
    rootNode.querySelectorAll(sel).forEach(function (e) { out.push(e); });
    rootNode.querySelectorAll('*').forEach(function (e) { if (e.shadowRoot) deepAll(e.shadowRoot, sel, out); });
    return out;
  }

  function findTarget(doc, id) {
    if (!doc) return null;
    var sel = '[data-demo-target~="' + id + '"]';
    return doc.querySelector(sel) || deepAll(doc, sel)[0] || null;
  }

  // ---------------------------------------------------------------- layout
  function fit() {
    var barH = settings.browserFrame ? 40 : 0;
    var W = stage.clientWidth, H = stage.clientHeight;
    var pad = W < 700 ? 8 : 32;
    scale = Math.max(0.05, Math.min((W - pad * 2) / vp.w, (H - pad * 2) / (vp.h + barH)));
    win.style.width = vp.w + 'px';
    win.style.height = (vp.h + barH) + 'px';
    viewport.style.width = vp.w + 'px';
    viewport.style.height = vp.h + 'px';
    var x = (W - vp.w * scale) / 2, y = (H - (vp.h + barH) * scale) / 2;
    win.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
    win.style.setProperty('--dp-scale', scale);
    zoomEl.style.setProperty('--dp-scale', scale * zoom.z);
  }
  window.addEventListener('resize', fit);

  // ---------------------------------------------------------------- screens
  function prepareDoc(frame) {
    var doc = frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    var st = doc.createElement('style');
    // Snapshots are static: jump finished entrance animations to their end state.
    st.textContent = 'html,*{scroll-behavior:auto!important}*,*::before,*::after{animation-delay:-60s!important;caret-color:auto}';
    (doc.head || doc.documentElement).appendChild(st);
    deepAll(doc, '[data-demo-scroll]').forEach(function (el) {
      var v = el.getAttribute('data-demo-scroll').split(',').map(Number);
      if (el === doc.documentElement) doc.defaultView.scrollTo(v[1] || 0, v[0] || 0);
      else { el.scrollTop = v[0] || 0; el.scrollLeft = v[1] || 0; }
    });
    if (!doc.__dp) {
      doc.__dp = true;
      doc.addEventListener('click', onFrameClick, true);
      doc.addEventListener('submit', function (e) { e.preventDefault(); }, true);
      doc.addEventListener('keydown', function (e) { e.preventDefault(); onKey(e); }, true);
    }
  }

  function loadInto(frame, id) {
    return new Promise(function (res) {
      var done = false;
      var fin = function () { if (done) return; done = true; prepareDoc(frame); res(); };
      frame.onload = fin;
      setTimeout(fin, 6000);
      frame.srcdoc = buildHtml(id);
    });
  }

  function showScreen(id, force) {
    if (!id) return Promise.resolve();
    if (shownId === id && !force) return Promise.resolve();
    var back = frames[1 - cur];
    var p = preload && preload.id === id ? preload.p : loadInto(back, id);
    preload = null;
    return p.then(function () {
      back.classList.add('on');
      frames[cur].classList.remove('on');
      cur = 1 - cur;
      shownId = id;
      pristine = true;
      var meta = (M.screens || {})[id] || {};
      urlEl.textContent = meta.url || '';
      if (meta.viewport && (meta.viewport.w !== vp.w || meta.viewport.h !== vp.h)) {
        vp = { w: meta.viewport.w, h: meta.viewport.h };
        fit();
      }
    });
  }

  function preloadNext(i) {
    for (var j = i + 1; j < steps.length; j++) {
      var id = steps[j].screen;
      if (id && id !== shownId) {
        if (!preload || preload.id !== id) preload = { id: id, p: loadInto(frames[1 - cur], id) };
        return;
      }
    }
  }

  var curDoc = function () { return frames[cur].contentDocument; };

  // ---------------------------------------------------------------- effects
  function targetPoint(el, fx, fy) {
    var r = el.getBoundingClientRect();
    var w = el.ownerDocument.defaultView;
    if (r.bottom < 0 || r.top > w.innerHeight || r.right < 0 || r.left > w.innerWidth) {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      r = el.getBoundingClientRect();
    }
    return { x: r.left + r.width * (fx == null ? 0.5 : fx), y: r.top + r.height * (fy == null ? 0.5 : fy), rect: r };
  }

  var moveCap = null; // max cursor travel time in a timed step
  function moveCursor(x, y) {
    var dist = Math.hypot(x - cursor.x, y - cursor.y);
    var ms = clamp(250 + dist * 0.6, 300, 1100);
    if (moveCap != null) ms = Math.max(150, Math.min(ms, moveCap));
    cursorEl.style.transitionDuration = (ms / settings.speed) + 'ms';
    cursorEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    cursor.x = x; cursor.y = y;
    return dist < 2 ? Promise.resolve() : sleep(ms);
  }

  function placeCursor(x, y) {
    cursorEl.style.transitionDuration = '0ms';
    cursorEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    cursor.x = x; cursor.y = y;
  }

  function clickFx() {
    if (!settings.cursor) return;
    var r = document.createElement('div');
    r.className = 'dp-ripple';
    r.style.left = cursor.x + 'px';
    r.style.top = cursor.y + 'px';
    overlay.appendChild(r);
    setTimeout(function () { r.remove(); }, 700);
    cursorEl.classList.add('down');
    setTimeout(function () { cursorEl.classList.remove('down'); }, 160);
  }

  var hotspot = null;
  function showHotspot(el) {
    hideHotspot();
    var r = el.getBoundingClientRect();
    hotspot = document.createElement('div');
    hotspot.className = 'dp-hotspot';
    var pad = 4;
    hotspot.style.left = (r.left - pad) + 'px';
    hotspot.style.top = (r.top - pad) + 'px';
    hotspot.style.width = (r.width + pad * 2) + 'px';
    hotspot.style.height = (r.height + pad * 2) + 'px';
    hotspot.onclick = advanceWaiter;
    overlay.appendChild(hotspot);
  }
  function hideHotspot() { if (hotspot) { hotspot.remove(); hotspot = null; } }

  // ---------------------------------------------------------------- zoom
  // Zoom level for a step: step.zoom === false turns it off for that step, a number overrides
  // the level, true forces it on; otherwise the global settings.zoom / settings.zoomLevel apply.
  function zoomLevel(s) {
    var def = +settings.zoomLevel || 1.8;
    if (s.zoom === false) return 1;
    if (typeof s.zoom === 'number') return Math.max(1, s.zoom);
    if (s.zoom === true) return def;
    return settings.zoom ? def : 1;
  }

  // Center (x, y) (iframe coordinates) at zoom z, clamped to the page edges. Returns true if the camera moved.
  function setZoom(z, x, y, animate) {
    z = Math.max(1, z || 1);
    var tx = 0, ty = 0;
    if (z > 1) {
      tx = clamp(vp.w / 2 - x * z, vp.w - vp.w * z, 0);
      ty = clamp(vp.h / 2 - y * z, vp.h - vp.h * z, 0);
    }
    // An animated call can be skipped when the camera is already there; a snap always applies,
    // because a previous zoom animation may still be running on screen.
    if (animate && Math.abs(z - zoom.z) < 1e-3 && Math.abs(tx - zoom.tx) < 0.5 && Math.abs(ty - zoom.ty) < 0.5) return false;
    var t = z === 1 ? '' : 'translate(' + tx + 'px,' + ty + 'px) scale(' + z + ')';
    if (animate) {
      zoomEl.style.transition = '';
      zoomEl.style.transitionDuration = (750 / settings.speed) + 'ms';
      zoomEl.style.transform = t;
    } else {
      // Snap: cancel any running zoom animation and apply immediately.
      zoomEl.style.transition = 'none';
      if (zoomEl.getAnimations) zoomEl.getAnimations().forEach(function (a) { a.cancel(); });
      zoomEl.style.transform = t;
      void zoomEl.offsetWidth;
    }
    zoomEl.style.setProperty('--dp-scale', scale * z);
    zoom = { z: z, tx: tx, ty: ty };
    return !!animate;
  }

  // Map a rect from iframe coordinates to (unzoomed) viewport coordinates.
  function toView(r) {
    return {
      left: r.left * zoom.z + zoom.tx, right: r.right * zoom.z + zoom.tx,
      top: r.top * zoom.z + zoom.ty, bottom: r.bottom * zoom.z + zoom.ty,
      width: r.width * zoom.z, height: r.height * zoom.z,
    };
  }

  function showCallout(text, el, withNext) {
    callout.textContent = text;
    if (withNext) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Next →';
      b.onclick = advanceWaiter;
      callout.appendChild(b);
    }
    callout.style.left = '0px';
    callout.style.top = '0px';
    var cw = callout.offsetWidth, ch = callout.offsetHeight, gap = 14 / scale, x, y;
    if (el) {
      var r = toView(el.getBoundingClientRect());
      y = r.bottom + gap;
      if (y + ch > vp.h - 8) y = r.top - gap - ch;
      if (y < 8) y = clamp(r.top + r.height / 2 - ch / 2, 8, vp.h - ch - 8);
      x = clamp(r.left + r.width / 2 - cw / 2, 8, Math.max(8, vp.w - cw - 8));
    } else {
      x = (vp.w - cw) / 2;
      y = 28 / scale;
    }
    callout.style.left = x + 'px';
    callout.style.top = y + 'px';
    callout.classList.add('on');
  }
  function hideCallout() { callout.classList.remove('on'); }

  function showKey(combo) {
    keycap.innerHTML = '';
    String(combo).split('+').forEach(function (k) {
      var kbd = document.createElement('kbd');
      kbd.textContent = k;
      keycap.appendChild(kbd);
    });
    keycap.classList.add('on');
  }
  function hideKey() { keycap.classList.remove('on'); }

  // Narration subtitles (until real voice clips exist, the spoken text is shown at the bottom).
  // A subtitle stays until its sentence has been said (subUntil), also over the following steps
  // that have no narration of their own; a step with its own narration replaces it.
  var subUntil = 0, subTimer = null;
  function showSubtitle(text, ms) {
    subtitle.textContent = text;
    hud.classList.add('has-sub');
    subUntil = Date.now() + ms;
    clearTimeout(subTimer);
    subTimer = setTimeout(function () { if (Date.now() >= subUntil - 30) hud.classList.remove('has-sub'); }, ms);
  }
  function hideSubtitle() { clearTimeout(subTimer); subUntil = 0; hud.classList.remove('has-sub'); }
  function keepOrHideSubtitle() { if (Date.now() >= subUntil) hideSubtitle(); }

  // How long a step lasts (video/recording ms), or null for the natural, animation-driven pace.
  // step.duration overrides; in "recorded" timing it's the gap to the next step's original time.
  function stepDuration(i) {
    var s = steps[i];
    if (typeof s.duration === 'number' && s.duration > 0) return s.duration;
    if (settings.timing === 'recorded') {
      var n = steps[i + 1];
      if (n && typeof n.t === 'number' && typeof s.t === 'number') return Math.max(250, n.t - s.t);
      return s.hold || 2000;
    }
    return null;
  }
  var typingBudget = null; // ms available for typing in a timed step
  // Roughly how long the narration takes to say (~15 characters per second).
  function speakTime(text) { return clamp(text.length * 65, 1500, 20000); }

  function readTime(text) { return clamp(1200 + text.length * 45, 1800, 9000); }

  async function typeText(el, from, to) {
    if (!el) { await sleep(400); return; }
    var isField = el.localName === 'input' || el.localName === 'textarea';
    var set = function (v) {
      if (isField) {
        el.value = v;
        try { el.setSelectionRange(v.length, v.length); } catch (e) {}
        el.scrollLeft = el.scrollWidth;
        el.scrollTop = el.scrollHeight;
      } else {
        el.textContent = v;
      }
    };
    set(from);
    var common = 0;
    while (common < from.length && common < to.length && from[common] === to[common]) common++;
    var dels = from.length - common;
    var delStep = Math.max(1, Math.ceil(dels / 25));
    for (var v = from; v.length > common;) {
      v = v.slice(0, Math.max(common, v.length - delStep));
      set(v);
      await sleep(35);
    }
    var count = to.length - common;
    var per = count > 80 ? 15 : count > 30 ? 35 : 60;
    // In a timed step, finish typing within the step's budget (average delay ≈ 1.4 × per).
    if (typingBudget != null && count > 0) per = clamp(typingBudget / count / 1.4, 6, per);
    for (var k = common; k < to.length; k++) {
      set(to.slice(0, k + 1));
      await sleep(per + Math.random() * per * 0.8);
    }
  }

  function animateScroll(doc, el, top, left) {
    var w = doc.defaultView;
    var t0 = el ? el.scrollTop : w.scrollY;
    var l0 = el ? el.scrollLeft : w.scrollX;
    var dist = Math.abs(top - t0) + Math.abs(left - l0);
    var dur = clamp(300 + dist * 0.5, 400, 1400) / settings.speed;
    var my = runId;
    return new Promise(function (res, rej) {
      var startT = performance.now();
      function frame(now) {
        if (my !== runId) return rej(ABORT);
        var p = Math.min(1, (now - startT) / dur);
        var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        var y = t0 + (top - t0) * e, x = l0 + (left - l0) * e;
        if (el) { el.scrollTop = y; el.scrollLeft = x; } else w.scrollTo(x, y);
        if (p < 1) requestAnimationFrame(frame); else res();
      }
      requestAnimationFrame(frame);
    });
  }

  function waitForUser(el) {
    return new Promise(function (res, rej) {
      waiter = { res: res, rej: rej, el: el };
      if (el) showHotspot(el);
    });
  }
  function advanceWaiter() {
    if (!waiter) return false;
    var w = waiter;
    waiter = null;
    hideHotspot();
    w.res();
    return true;
  }

  // ---------------------------------------------------------------- steps
  async function noteGate(s, el, defaultMs) {
    var guided = settings.mode === 'guided';
    if (s.note) {
      showCallout(s.note, el, guided);
      if (guided) await waitForUser(null);
      else await sleep(s.hold || readTime(s.note));
      hideCallout();
    } else {
      await sleep(s.hold || defaultMs);
    }
  }

  async function runStep(i, force) {
    var my = runId;
    var s = steps[i];
    hideCallout();
    hideKey();
    hideHotspot();
    await showScreen(s.screen, force);
    check(my);
    pristine = false;
    preloadNext(i);
    var doc = curDoc();
    var el = s.target ? findTarget(doc, s.target) : null;
    var guided = settings.mode === 'guided';
    // Keep the camera during key presses (they continue the typing); zoom out for everything else.
    var zoomOut = s.type !== 'click' && s.type !== 'type' && s.type !== 'key' && setZoom(1, 0, 0, true);
    var stepStart = Date.now();
    var target = guided ? null : stepDuration(i);
    var fit = target != null;
    moveCap = fit ? target * 0.4 : null;
    typingBudget = null;
    var narr = settings.subtitles !== false && s.narration ? String(s.narration) : '';
    if (narr) {
      // Real spoken length when known (narrationEnd from the transcript), else an estimate.
      var spoken = typeof s.narrationEnd === 'number' && typeof s.t === 'number' && s.narrationEnd > s.t
        ? s.narrationEnd - s.t : speakTime(narr);
      showSubtitle(narr, spoken / settings.speed);
    } else {
      keepOrHideSubtitle();
    }
    var g = function (ms) { return fit ? 0 : ms; }; // default pauses are absorbed by the step's duration

    switch (s.type) {
      case 'click': {
        if (el) {
          var p = targetPoint(el, s.x, s.y);
          var zc = setZoom(zoomLevel(s), p.x, p.y, true);
          await Promise.all([moveCursor(p.x, p.y), zc ? sleep(750) : null]);
        } else {
          setZoom(1, 0, 0, true);
        }
        if (guided) {
          if (s.note) showCallout(s.note, el, false);
          await waitForUser(el);
        } else if (s.note) {
          showCallout(s.note, el, false);
          await sleep(readTime(s.note));
        } else {
          await sleep(g(200));
        }
        clickFx();
        await sleep(fit ? 250 : (s.hold || 280));
        break;
      }
      case 'type': {
        if (el) {
          var c = targetPoint(el, 0.5, 0.5);
          var zt = setZoom(zoomLevel(s), c.x, c.y, true);
          var r = el.getBoundingClientRect();
          if (cursor.x < r.left || cursor.x > r.right || cursor.y < r.top || cursor.y > r.bottom) {
            var q = targetPoint(el, 0.15, 0.5);
            await Promise.all([moveCursor(q.x, q.y), zt ? sleep(750) : null]);
            clickFx();
          } else if (zt) {
            await sleep(750);
          }
          try { el.focus({ preventScroll: true }); } catch (e) {}
        }
        if (s.note) showCallout(s.note, el, false);
        var t0 = Date.now();
        if (fit) typingBudget = Math.max(300, target * 0.8 - (Date.now() - stepStart) * settings.speed);
        await typeText(el, s.from || '', s.text || '');
        typingBudget = null;
        if (s.note) {
          if (guided) { showCallout(s.note, el, true); await waitForUser(null); }
          else await sleep(Math.max(500, readTime(s.note) - (Date.now() - t0)));
        } else {
          await sleep(g(s.hold || 450));
        }
        break;
      }
      case 'key': {
        if (settings.showKeys === false) { await noteGate(s, el, g(150)); break; }
        showKey(s.key);
        await noteGate(s, el, fit ? Math.min(1000, target * 0.8) : 1000);
        hideKey();
        break;
      }
      case 'scroll': {
        await animateScroll(doc, el, s.top || 0, s.left || 0);
        await noteGate(s, el, g(200));
        break;
      }
      case 'start':
      case 'navigate':
        await noteGate(s, el, g(900));
        break;
      case 'end':
        await noteGate(s, el, fit ? target : 1500);
        break;
      default: // change
        await noteGate(s, el, g(450));
    }
    moveCap = null;
    if (fit) {
      // Timed step: last exactly as long as in the original (animations ran inside that time).
      var rest = target - (Date.now() - stepStart) * settings.speed;
      if (rest > 0) await sleep(rest);
      check(my);
      return;
    }
    // Let a zoom-out finish before the next step, so the full page is actually seen,
    // and give narration time to be read (autoplay; guided mode waits for the viewer anyway).
    var minMs = Math.max(zoomOut ? 750 : 0, narr && !guided ? speakTime(narr) : 0);
    var left = minMs - (Date.now() - stepStart) * settings.speed;
    if (left > 0) await sleep(left);
    check(my);
  }

  // ---------------------------------------------------------------- transport
  async function play() {
    if (playing || !steps.length) return;
    if (idx >= steps.length) { idx = 0; pristine = false; placeCursor(vp.w / 2, vp.h / 2); setZoom(1, 0, 0, false); }
    playing = true;
    cover.hidden = true;
    updateUI();
    var my = runId;
    var first = true;
    try {
      while (idx < steps.length) {
        await runStep(idx, first && !pristine);
        first = false;
        if (my !== runId) return;
        if (idx < steps.length - 1) idx++; else { idx = steps.length; break; }
        updateUI();
      }
      playing = false;
      updateUI();
      if (settings.loop) {
        await sleep(1500);
        idx = 0;
        play();
      } else {
        showCover('↻  Replay');
      }
    } catch (e) {
      if (e !== ABORT) console.error(e);
    } finally {
      if (my === runId && playing) { playing = false; updateUI(); }
    }
  }

  function pause() {
    if (!playing) return;
    playing = false;
    abortAll();
    hideSubtitle();
    hideCallout();
    hideKey();
    updateUI();
  }

  async function jump(i, keepPlaying) {
    var resume = keepPlaying != null ? keepPlaying : playing;
    playing = false;
    abortAll();
    hideCallout();
    hideKey();
    hideSubtitle();
    idx = clamp(i, 0, steps.length - 1);
    cover.hidden = true;
    updateUI();
    var my = runId;
    setZoom(1, 0, 0, false);
    await showScreen(steps[idx].screen, true);
    if (my !== runId) return;
    if (resume) play();
  }

  function showCover(label) {
    coverBtn.textContent = label;
    cover.hidden = false;
  }

  function updateUI() {
    var n = steps.length;
    playBtn.textContent = playing ? '❚❚' : '▶';
    countEl.textContent = (n ? Math.min(idx + 1, n) : 0) + ' / ' + n;
    var segs = track.children;
    for (var i = 0; i < segs.length; i++) {
      segs[i].className = 'dp-seg' + (i < idx ? ' done' : i === idx ? ' cur' : '');
    }
  }

  function onFrameClick(e) {
    e.preventDefault();
    if (waiter) {
      var w = waiter;
      var path = e.composedPath ? e.composedPath() : [e.target];
      if (!w.el || path.indexOf(w.el) >= 0) advanceWaiter();
      else if (hotspot) { hotspot.classList.remove('hint'); void hotspot.offsetWidth; hotspot.classList.add('hint'); }
      return;
    }
    if (settings.mode !== 'guided') { if (playing) pause(); else play(); }
  }

  function onKey(e) {
    if (e.target && /^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.ownerDocument === document) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (waiter) advanceWaiter(); else if (playing) pause(); else play(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (!advanceWaiter()) jump(idx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); jump(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); jump(0, false); }
  }
  document.addEventListener('keydown', onKey);

  root.querySelector('.dp-controls').addEventListener('click', function (e) {
    var a = e.target.closest('[data-a]');
    if (!a) return;
    var act = a.getAttribute('data-a');
    if (act === 'play') { if (playing) pause(); else play(); }
    else if (act === 'restart') { jump(0, true); }
    else if (act === 'prev') jump(idx - 1);
    else if (act === 'next') { if (!advanceWaiter()) jump(idx + 1); }
    else if (act === 'fs') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(function () {}); }
  });
  modeSel.addEventListener('change', function () { settings.mode = modeSel.value; if (playing) jump(idx, true); modeSel.blur(); });
  speedSel.addEventListener('change', function () { settings.speed = +speedSel.value || 1; speedSel.blur(); });
  paceSel.addEventListener('change', function () { settings.timing = paceSel.value; if (playing) jump(idx, true); paceSel.blur(); });
  $('.dp-progress').addEventListener('click', function (e) {
    var r = track.getBoundingClientRect();
    var i = Math.floor(clamp((e.clientX - r.left) / r.width, 0, 0.9999) * steps.length);
    jump(i);
  });
  coverBtn.addEventListener('click', function () {
    if (idx >= steps.length) { jump(0, true); } else play();
  });

  // ---------------------------------------------------------------- boot
  for (var s = 0; s < steps.length; s++) {
    var seg = document.createElement('div');
    seg.className = 'dp-seg';
    seg.title = (s + 1) + '. ' + steps[s].type + (steps[s].label ? ' · ' + steps[s].label : '');
    track.appendChild(seg);
  }
  fit();
  placeCursor(vp.w / 2, vp.h / 2);
  updateUI();
  if (!steps.length) {
    showCover('This demo has no steps');
  } else {
    // Start at a given step (the extension preview reopens where it was after an edit).
    var startAt = clamp(parseInt(window.DEMO_START_STEP || params.get('step') || 0, 10) || 0, 0, steps.length - 1);
    idx = startAt;
    updateUI();
    showScreen(steps[startAt].screen).then(function () {
      preloadNext(startAt);
      if (settings.autoStart) play();
      else if (startAt > 0) showCover('▶  Continue from step ' + (startAt + 1));
      else showCover(settings.mode === 'guided' ? '▶  Start interactive tour' : '▶  Play demo');
    });
  }

  // Small API for automation / embedding.
  window.demoPlayer = {
    play: play, pause: pause, jump: jump,
    get index() { return idx; }, get playing() { return playing; }, steps: steps,
  };
})();
