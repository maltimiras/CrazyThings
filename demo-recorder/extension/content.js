// Demo Recorder — content script.
// Captures "screens" (full, script-free HTML snapshots of the page) and "steps"
// (click / type / key / scroll / change) and streams them to the background worker.
(() => {
  if (window.__demoRecorderLoaded) return;
  window.__demoRecorderLoaded = true;

  const T_ATTR = 'data-demo-target';
  const BADGE_ID = '__demo_recorder_badge__';
  const nonce = Math.random().toString(36).slice(2, 7);

  let recording = false;
  let paused = false;
  let observer = null;
  let dirty = false;
  let lastHash = null;
  let lastScreenId = null;
  let screenN = 0;
  let targetN = 0;
  let typing = null; // { el, screenId, targetId, before, after, timer }
  let scrollSess = null; // { el, screenId, targetId, timer }
  let idleTimer = null;
  let maxTimer = null;
  let lastChangeAt = 0;
  let lastUserInputAt = 0;
  let pendingCss = {};
  const sentCss = new Set();
  const cssCache = new WeakMap();
  const requestedCross = new Set();
  const observedRoots = new WeakSet();
  let badgeRoot = null;

  const active = () => recording && !paused;

  function send(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      return p && p.catch ? p.catch(() => null) : Promise.resolve(null);
    } catch (e) {
      // Extension was reloaded; this content script is orphaned.
      recording = false;
      return Promise.resolve(null);
    }
  }

  // ---------- utils ----------
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g;
  function absUrls(css, base) {
    return css.replace(URL_RE, (m, a, b, c) => {
      const u = (a ?? b ?? c ?? '').trim();
      if (!u || /^(data:|blob:|#|about:)/i.test(u)) return m;
      try { return `url("${new URL(u, base).href}")`; } catch { return m; }
    });
  }

  // ---------- CSS ----------
  function sheetText(sheet) {
    let rules;
    try { rules = sheet.cssRules; } catch { return null; }
    if (!rules) return null;
    const base = sheet.href || document.baseURI;
    let out = '';
    for (const r of rules) {
      if (r.type === CSSRule.IMPORT_RULE) {
        const inner = r.styleSheet ? sheetText(r.styleSheet) : null;
        if (inner != null) {
          const m = r.media && r.media.mediaText;
          out += (m ? `@media ${m}{\n${inner}}\n` : inner + '\n');
        } else {
          out += absUrls(r.cssText, base) + '\n';
        }
      } else {
        out += absUrls(r.cssText, base) + '\n';
      }
    }
    return out;
  }

  // Returns a key that identifies the sheet's contents. The text is sent to the
  // background once per page (deduped across screens and sessions).
  function cssKeyFor(sheet) {
    let len = -1;
    try { len = sheet.cssRules.length; } catch {}
    if (len < 0) {
      if (!sheet.href) return null;
      const key = 'x' + hash(sheet.href);
      if (!requestedCross.has(key)) {
        requestedCross.add(key);
        send({ type: 'needCss', key, href: sheet.href });
      }
      return key;
    }
    const owner = sheet.ownerNode;
    const sig = len + ':' + (owner && owner.textContent ? owner.textContent.length : 0) + ':' + (sheet.href || '');
    const cached = cssCache.get(sheet);
    if (cached && cached.sig === sig) return cached.key;
    const text = sheetText(sheet) || '';
    const key = 'c' + hash(text) + text.length.toString(36);
    cssCache.set(sheet, { sig, key });
    if (!sentCss.has(key)) pendingCss[key] = text;
    return key;
  }

  function cssPlaceholder(ctx, sheet) {
    const media = sheet.media && sheet.media.mediaText;
    if (ctx.nested) {
      const st = ctx.inert.createElement('style');
      if (media) st.setAttribute('media', media);
      st.textContent = sheetText(sheet) || (sheet.href ? `@import url("${sheet.href}");` : '');
      return st;
    }
    const key = cssKeyFor(sheet);
    if (!key) return null;
    const st = ctx.inert.createElement('style');
    st.setAttribute('data-demo-css', key);
    if (media) st.setAttribute('media', media);
    return st;
  }

  // ---------- serialization ----------
  function imgToDataUrl(img) {
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL();
    } catch { return null; }
  }

  function observeRoot(root) {
    if (!observer || observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  }

  function fixElement(el, c, ctx) {
    if (el.id === BADGE_ID) { ctx.remove.push(c); return; }
    if (ctx.target && el === ctx.target) c.setAttribute(T_ATTR, ctx.targetId);

    if (ctx.owners && ctx.owners.has(el)) {
      const sheet = ctx.owners.get(el);
      const ph = sheet ? cssPlaceholder(ctx, sheet) : null;
      if (ph) ctx.replace.push([c, ph]); else ctx.remove.push(c);
    } else if (ctx.owners && el.localName === 'link' && /(^|\s)stylesheet(\s|$)/i.test(el.rel || '')) {
      ctx.remove.push(c); // stylesheet that never loaded
    }

    if (el.hasAttributes()) {
      for (const name of c.getAttributeNames()) {
        if (name.length > 2 && name[0] === 'o' && name[1] === 'n') c.removeAttribute(name);
      }
    }

    switch (el.localName) {
      case 'input': {
        const type = (el.type || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
          if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked');
        } else if (type === 'password') {
          if (el.value) c.setAttribute('value', '•'.repeat(Math.min(el.value.length, 12)));
          else c.removeAttribute('value');
        } else if (type !== 'file') {
          c.setAttribute('value', el.value);
        }
        break;
      }
      case 'textarea':
        c.textContent = el.value;
        break;
      case 'option':
        if (el.selected) c.setAttribute('selected', ''); else c.removeAttribute('selected');
        break;
      case 'img': {
        let src = el.currentSrc || el.src;
        if (src) {
          if (src.startsWith('blob:')) src = imgToDataUrl(el) || src;
          c.setAttribute('src', src);
          c.removeAttribute('srcset');
          c.removeAttribute('sizes');
        }
        c.removeAttribute('loading');
        break;
      }
      case 'source':
        if (el.parentElement && el.parentElement.localName === 'picture') ctx.remove.push(c);
        break;
      case 'canvas': {
        try {
          const img = ctx.inert.createElement('img');
          for (const a of ['id', 'class', 'style']) if (el.hasAttribute(a)) img.setAttribute(a, el.getAttribute(a));
          const r = el.getBoundingClientRect();
          img.style.width = r.width + 'px';
          img.style.height = r.height + 'px';
          img.setAttribute('src', el.toDataURL());
          ctx.replace.push([c, img]);
        } catch {}
        break;
      }
      case 'video': {
        c.removeAttribute('autoplay');
        try {
          if (el.videoWidth) {
            const cv = document.createElement('canvas');
            cv.width = el.videoWidth; cv.height = el.videoHeight;
            cv.getContext('2d').drawImage(el, 0, 0);
            c.setAttribute('poster', cv.toDataURL('image/jpeg', 0.8));
          }
        } catch {}
        if ((el.currentSrc || '').startsWith('blob:')) c.removeAttribute('src');
        break;
      }
      case 'iframe':
      case 'frame': {
        let html = null;
        try {
          const d = el.contentDocument;
          if (d && d.documentElement) html = serializeDoc(d, null, null, true);
        } catch {}
        if (html != null) {
          c.setAttribute('srcdoc', html);
          c.removeAttribute('src');
        } else {
          const r = el.getBoundingClientRect();
          const ph = ctx.inert.createElement('div');
          for (const a of ['id', 'class', 'style']) if (el.hasAttribute(a)) ph.setAttribute(a, el.getAttribute(a));
          ph.setAttribute('data-demo-iframe', el.src || '');
          ph.style.width = r.width + 'px';
          ph.style.height = r.height + 'px';
          ph.style.background = 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 10px,#e5e7eb 10px,#e5e7eb 20px)';
          ctx.replace.push([c, ph]);
        }
        break;
      }
    }

    if (el.scrollTop || el.scrollLeft) {
      c.setAttribute('data-demo-scroll', `${Math.round(el.scrollTop)},${Math.round(el.scrollLeft)}`);
    }

    if (el.shadowRoot) {
      const sr = el.shadowRoot;
      observeRoot(sr);
      const holder = ctx.inert.createElement('div');
      for (const n of sr.childNodes) holder.appendChild(ctx.inert.importNode(n, true));
      processTree(sr, holder, { ...ctx, owners: null });
      const t = ctx.inert.createElement('template');
      t.setAttribute('shadowrootmode', 'open');
      for (const s of sr.adoptedStyleSheets || []) {
        const ph = cssPlaceholder(ctx, s);
        if (ph) t.content.appendChild(ph);
      }
      while (holder.firstChild) t.content.appendChild(holder.firstChild);
      c.insertBefore(t, c.firstChild);
    }
  }

  function processTree(liveRoot, cloneRoot, ctx) {
    const liveAll = liveRoot.querySelectorAll('*');
    const cloneAll = cloneRoot.querySelectorAll('*');
    if (liveAll.length !== cloneAll.length) {
      console.warn('[demo-recorder] tree mismatch, skipping state fixups');
      return;
    }
    for (let i = 0; i < liveAll.length; i++) fixElement(liveAll[i], cloneAll[i], ctx);
  }

  function serializeDoc(doc, target, targetId, nested) {
    const inert = document.implementation.createHTMLDocument('');
    const root = doc.documentElement;
    // importNode into an inert document: custom elements are not upgraded and
    // nothing loads, so cloning has no side effects on the live app.
    const clone = inert.importNode(root, true);
    const owners = new Map();
    for (const sheet of doc.styleSheets) {
      if (sheet.ownerNode) owners.set(sheet.ownerNode, sheet.disabled ? null : sheet);
    }
    const ctx = { inert, target, targetId, nested, owners, remove: [], replace: [] };
    processTree(root, clone, ctx);
    for (const [a, b] of ctx.replace) a.replaceWith(b);
    for (const n of ctx.remove) n.remove();

    clone.querySelectorAll(
      'script,noscript,base,meta[http-equiv],link[rel~="preload"],link[rel~="modulepreload"],' +
      'link[rel~="prefetch"],link[rel~="preconnect"],link[rel~="dns-prefetch"],link[rel~="manifest"]'
    ).forEach((n) => n.remove());

    // Strip comments.
    const tw = inert.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (tw.nextNode()) comments.push(tw.currentNode);
    comments.forEach((n) => n.remove());

    let head = clone.querySelector('head');
    if (!head) { head = inert.createElement('head'); clone.insertBefore(head, clone.firstChild); }
    const base = inert.createElement('base');
    base.setAttribute('href', doc.baseURI);
    head.insertBefore(base, head.firstChild);
    if (!head.querySelector('meta[charset]')) {
      const meta = inert.createElement('meta');
      meta.setAttribute('charset', 'utf-8');
      head.insertBefore(meta, head.firstChild);
    }
    for (const s of doc.adoptedStyleSheets || []) {
      const ph = cssPlaceholder(ctx, s);
      if (ph) head.appendChild(ph);
    }

    const win = doc.defaultView;
    if (win && (win.scrollY || win.scrollX)) {
      clone.setAttribute('data-demo-scroll', `${Math.round(win.scrollY)},${Math.round(win.scrollX)}`);
    }
    const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '';
    return doctype + clone.outerHTML;
  }

  // ---------- screens & steps ----------
  function takeScreen(target, dedupe) {
    const targetId = target ? 't' + (++targetN) : null;
    let html;
    try {
      html = serializeDoc(document, target, targetId, false);
    } catch (e) {
      console.warn('[demo-recorder] snapshot failed', e);
      return null;
    }
    dirty = false;
    const norm = targetId ? html.replace(` ${T_ATTR}="${targetId}"`, '') : html;
    const h = hash(norm) + norm.length;
    if (dedupe && h === lastHash) return null;
    lastHash = h;
    const id = nonce + '-' + (++screenN);
    const css = pendingCss;
    pendingCss = {};
    Object.keys(css).forEach((k) => sentCss.add(k));
    send({
      type: 'screen',
      css,
      screen: {
        id,
        html,
        url: location.href,
        title: document.title,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        t: Date.now(),
      },
    });
    lastScreenId = id;
    return { screenId: id, targetId };
  }

  function currentScreen() {
    if (dirty || !lastScreenId) {
      const s = takeScreen(null, false);
      if (s) return s.screenId;
    }
    return lastScreenId;
  }

  function step(s) {
    send({ type: 'step', step: { ...s, t: Date.now() } });
  }

  function describe(el) {
    if (!el) return '';
    const isField = /^(input|textarea|select)$/.test(el.localName);
    const labelText = isField && el.labels && el.labels[0] ? el.labels[0].innerText : '';
    const raw = el.getAttribute('aria-label') || (isField ? labelText || el.getAttribute('placeholder') || el.name : el.innerText) ||
      el.value || el.getAttribute('placeholder') ||
      el.getAttribute('title') || el.getAttribute('alt') || '';
    const t = String(raw).trim().replace(/\s+/g, ' ');
    return t.slice(0, 60) || el.localName;
  }

  const INTERACTIVE = 'button,a,[role=button],[role=menuitem],[role=tab],[role=option],[role=checkbox],' +
    '[role=switch],[role=link],label,input,select,textarea,summary';

  function deepTarget(e) {
    const p = e.composedPath && e.composedPath();
    const t = (p && p[0]) || e.target;
    if (t instanceof Element) return t;
    return t && t.parentElement ? t.parentElement : null;
  }

  function editableRoot(t) {
    if (!(t instanceof Element)) return null;
    if (t.localName === 'textarea') return t;
    if (t.localName === 'input') {
      const type = (t.type || 'text').toLowerCase();
      return /^(checkbox|radio|button|submit|reset|file|range|color|image|hidden)$/.test(type) ? null : t;
    }
    if (t.isContentEditable) {
      let r = t;
      while (r.parentElement && r.parentElement.isContentEditable) r = r.parentElement;
      return r;
    }
    return null;
  }

  const getVal = (el) => (el.isContentEditable ? el.innerText : el.value) || '';

  function flushTyping() {
    if (!typing) return;
    const t = typing;
    typing = null;
    clearTimeout(t.timer);
    const after = t.after != null ? t.after : getVal(t.el);
    if (after === t.before) return;
    const isPwd = t.el.localName === 'input' && (t.el.type || '').toLowerCase() === 'password';
    step({
      type: 'type',
      screen: t.screenId,
      target: t.targetId,
      from: isPwd ? '' : t.before,
      text: isPwd ? '•'.repeat(Math.min(after.length, 12)) : after,
      label: describe(t.el),
    });
    dirty = true;
    scheduleIdle();
  }

  function flushScroll() {
    if (!scrollSess) return;
    const s = scrollSess;
    scrollSess = null;
    clearTimeout(s.timer);
    const el = s.el;
    const top = Math.round(el ? el.scrollTop : window.scrollY);
    const left = Math.round(el ? el.scrollLeft : window.scrollX);
    step({ type: 'scroll', screen: s.screenId, target: s.targetId, top, left });
  }

  // ---------- event capture ----------
  function onPointerDown(e) {
    lastUserInputAt = Date.now();
    if (!active() || !e.isTrusted || e.button !== 0) return;
    const raw = deepTarget(e);
    if (!raw || raw.id === BADGE_ID) return;
    flushTyping();
    flushScroll();
    const el = raw.closest(INTERACTIVE) || raw;
    const r = el.getBoundingClientRect();
    const s = takeScreen(el, false);
    if (!s) return;
    step({
      type: 'click',
      screen: s.screenId,
      target: s.targetId,
      x: r.width ? +((e.clientX - r.left) / r.width).toFixed(3) : 0.5,
      y: r.height ? +((e.clientY - r.top) / r.height).toFixed(3) : 0.5,
      label: describe(el),
    });
  }

  function onBeforeInput(e) {
    lastUserInputAt = Date.now();
    if (!active() || !e.isTrusted) return;
    const el = editableRoot(deepTarget(e));
    if (!el) return;
    if (typing && typing.el === el) return;
    flushTyping();
    flushScroll();
    const s = takeScreen(el, false);
    if (!s) return;
    typing = { el, screenId: s.screenId, targetId: s.targetId, before: getVal(el), after: null, timer: null };
  }

  function onInput(e) {
    if (!typing) return;
    const el = editableRoot(deepTarget(e));
    if (el !== typing.el) return;
    typing.after = getVal(el);
    clearTimeout(typing.timer);
    typing.timer = setTimeout(flushTyping, 2500);
  }

  const SPECIAL_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Delete']);
  function onKeyDown(e) {
    lastUserInputAt = Date.now();
    if (!active() || !e.isTrusted || e.repeat) return;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    const k = e.key;
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(k)) return;
    const isSpecial = SPECIAL_KEYS.has(k);
    if (!isSpecial && !mod) return;
    if (mod && /^[cvxazy]$/i.test(k)) return; // clipboard/undo: shows up as typing instead
    const el = editableRoot(deepTarget(e));
    // Plain arrows/Home/End inside a text field are caret movement, Enter in a textarea is a newline.
    if (el && !mod && k !== 'Enter' && k !== 'Escape' && k !== 'Tab') return;
    if (el && !mod && k === 'Enter' && (el.localName === 'textarea' || el.isContentEditable)) return;
    flushTyping();
    flushScroll();
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('⌘');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey && (mod || isSpecial)) parts.push('Shift');
    parts.push(k.length === 1 ? k.toUpperCase() : k);
    step({ type: 'key', screen: currentScreen(), key: parts.join('+') });
  }

  function onScroll(e) {
    if (!active()) return;
    if (Date.now() - lastUserInputAt > 1500) return; // ignore programmatic scrolling
    const t = e.target;
    const el = t === document || t === document.documentElement || t === document.body || t === document.scrollingElement ? null : t;
    if (el && !(el instanceof Element)) return;
    if (scrollSess && scrollSess.el !== el) flushScroll();
    if (!scrollSess) {
      flushTyping();
      const s = takeScreen(el, false);
      if (!s) return;
      scrollSess = { el, screenId: s.screenId, targetId: s.targetId, timer: null };
    }
    clearTimeout(scrollSess.timer);
    scrollSess.timer = setTimeout(() => { flushScroll(); scheduleIdle(); }, 450);
  }

  const markInput = () => { lastUserInputAt = Date.now(); };

  // ---------- DOM change detection ----------
  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdle, 700);
    if (!maxTimer) maxTimer = setTimeout(onIdle, 4000);
  }

  function onIdle() {
    clearTimeout(idleTimer); clearTimeout(maxTimer);
    idleTimer = maxTimer = null;
    if (!active() || !dirty) return;
    if (typing || scrollSess) { scheduleIdle(); return; }
    const since = Date.now() - lastChangeAt;
    if (since < 1200) { idleTimer = setTimeout(onIdle, 1200 - since); return; }
    const s = takeScreen(null, true);
    if (s) {
      lastChangeAt = Date.now();
      step({ type: 'change', screen: s.screenId });
    }
  }

  function onMutations(muts) {
    if (!active()) return;
    for (const m of muts) {
      if (m.type === 'attributes' && m.attributeName && m.attributeName.startsWith('data-demo')) continue;
      if (m.type === 'childList') {
        const n = m.addedNodes[0] || m.removedNodes[0];
        if (n && n.id === BADGE_ID) continue;
      }
      dirty = true;
      scheduleIdle();
      return;
    }
  }

  // ---------- badge ----------
  function updateBadge() {
    let host = document.getElementById(BADGE_ID);
    if (!recording) { if (host) host.remove(); badgeRoot = null; return; }
    if (!host) {
      host = document.createElement('div');
      host.id = BADGE_ID;
      host.style.cssText = 'position:fixed;z-index:2147483647;left:12px;bottom:12px;pointer-events:none;';
      badgeRoot = host.attachShadow({ mode: 'closed' });
      badgeRoot.innerHTML = `<style>
        .b{font:600 11px/1 system-ui,sans-serif;color:#fff;background:rgba(17,17,17,.82);padding:6px 9px;border-radius:999px;display:flex;gap:6px;align-items:center;letter-spacing:.04em}
        i{width:8px;height:8px;border-radius:50%;background:#ef4444;animation:p 1.2s infinite}
        .paused i{background:#f59e0b;animation:none}
        @keyframes p{50%{opacity:.3}}
      </style><div class="b"><i></i><span>REC</span></div>`;
      document.documentElement.appendChild(host);
    }
    if (badgeRoot) {
      const b = badgeRoot.querySelector('.b');
      b.classList.toggle('paused', paused);
      b.querySelector('span').textContent = paused ? 'PAUSED' : 'REC';
    }
  }

  // ---------- lifecycle ----------
  function applyState({ recording: rec, paused: p, reason }) {
    const was = active();
    recording = !!rec;
    paused = !!p;
    updateBadge();
    if (recording && !observer) {
      observer = new MutationObserver(onMutations);
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    if (!recording && observer) { observer.disconnect(); observer = null; }
    if (!was && active()) {
      const s = takeScreen(null, false);
      if (s) step({ type: reason === 'start' ? 'start' : reason === 'resume' ? 'change' : 'navigate', screen: s.screenId, url: location.href });
    }
    if (was && !active()) { flushTyping(); flushScroll(); }
  }

  function finish() {
    if (!recording) return;
    flushTyping();
    flushScroll();
    const s = takeScreen(null, false);
    if (s) step({ type: 'end', screen: s.screenId });
    applyState({ recording: false, paused: false });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'rec-state') { applyState(msg); sendResponse({ ok: true }); }
    else if (msg.type === 'finish') { finish(); sendResponse({ ok: true }); }
  });

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('beforeinput', onBeforeInput, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onScroll, true);
  document.addEventListener('wheel', markInput, { capture: true, passive: true });
  document.addEventListener('touchmove', markInput, { capture: true, passive: true });
  document.addEventListener('focusout', (e) => { if (typing && e.target === typing.el) flushTyping(); }, true);
  window.addEventListener('pagehide', () => { flushTyping(); flushScroll(); });

  send({ type: 'hello' }).then((r) => { if (r && r.recording) applyState(r); });
})();
