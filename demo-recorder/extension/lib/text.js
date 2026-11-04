// Text helpers for screen HTML: find, replace and translate visible strings.
// Shared by the extension and tools/demo.mjs, so it must not use browser-only APIs.

export const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
export const escText = (s) => s.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;');
export const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Attributes that never hold user-visible data. Everything else (value, placeholder, title,
// alt, aria-label, custom-element props like name="Jane Cooper", data-* labels…) is treated as text.
export const SKIP_ATTRS = new RegExp('^(' + [
  'class', 'id', 'style', 'src', 'srcset', 'srcdoc', 'href', 'xlink:href', 'action', 'for', 'type', 'rel', 'role',
  'lang', 'dir', 'tabindex', 'xmlns(:\\w+)?', 'viewbox', 'd', 'points', 'transform', 'fill', 'stroke', 'stroke-[\\w-]+',
  'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'x2', 'y1', 'y2', 'offset', 'media', 'sizes',
  'aria-(hidden|controls|labelledby|describedby|owns|expanded|selected|checked|haspopup)', 'data-demo-[\\w-]+',
  'shadowrootmode', 'slot', 'part', 'autocomplete', 'inputmode', 'charset', 'http-equiv', 'crossorigin', 'loading',
].join('|') + ')$', 'i');
export const TOKEN_RE = /(<style\b[^>]*>[\s\S]*?<\/style>)|(<[^>]+>)|([^<]+)/gi;
export const ATTR_RE = /(\s([^\s="'>\/]+)=")([^"]*)(")/g;

export function visitHtml(html, onText, onAttr) {
  return html.replace(TOKEN_RE, (m, style, tag, text) => {
    if (style) return style;
    if (tag) {
      if (!onAttr || tag[1] === '/' || tag[1] === '!') return tag;
      return tag.replace(ATTR_RE, (mm, a, name, v, b) => (SKIP_ATTRS.test(name) || !v ? mm : a + onAttr(v, name) + b));
    }
    return onText ? onText(text) : text;
  });
}

export function stripHead(html) {
  // ignore <head> (title handled separately) – keeps strings output focused on visible UI
  return html.replace(/<head\b[\s\S]*?<\/head>/i, '');
}

