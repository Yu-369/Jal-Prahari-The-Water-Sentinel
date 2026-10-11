// Shared state, DOM helpers, icons and the citation renderer.

export const state = {
  model: null,
  status: null,
  selected: null,
  byId: new Map(),
  tableById: new Map(),
  ghatById: new Map(),
  listeners: new Set(),
};

export function init(model, status) {
  state.model = model;
  state.status = status;
  state.byId = new Map(model.readings.map((r) => [r.id, r]));
  state.tableById = new Map(model.tables.map((t) => [t.id, t]));
  state.ghatById = new Map(model.ghats.map((g) => [g.id, g]));
}

export function onSelect(fn) { state.listeners.add(fn); }
export function select(id, opts = {}) {
  if (!state.ghatById.has(id)) return;
  state.selected = id;
  for (const fn of state.listeners) fn(id, opts);
}

// h('div', {class: 'x', onclick: fn}, child, 'text', [more])
export function h(tag, attrs = {}, ...children) {
  const svgTags = new Set(['svg', 'path', 'circle', 'rect', 'line', 'g', 'text', 'polyline', 'defs', 'pattern', 'title', 'clipPath']);
  const el = svgTags.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

// Like replaceChildren, but skips null/false (replaceChildren would print "null").
export function setChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  critical: '<path d="M8 1.6 15 14H1z" fill="currentColor"/><path d="M8 6v3.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.8" r=".95" fill="#fff"/>',
  warning: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.4v4.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.2" r=".95" fill="#fff"/>',
  safe: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="m4.8 8.2 2.1 2.1 4.3-4.4" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  nodata: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.2 8h5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  gap: '<rect x="1.8" y="2.6" width="12.4" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.8 6h12.4M5 1.4v2.4M11 1.4v2.4M6 9.2l4 3M10 9.2l-4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  site: '<path d="M8 15s5-4.4 5-8.4A5 5 0 0 0 3 6.6C3 10.6 8 15 8 15z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.6v2.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="9.4" r=".9" fill="currentColor"/>',
  bolt: '<path d="M9.4 1 3 9.2h4.4L6.6 15 13 6.8H8.6z" fill="currentColor"/>',
  ext: '<path d="M6 2.5H2.5v7h7V6M7 1.5h3v3M10 1.5 5.5 6" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  concern: '<circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.6v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.1" r=".95" fill="currentColor"/>',
  ok: '<circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m5.2 8.1 1.9 1.9 3.8-3.9" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  aeration: '<circle cx="5" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10.5" cy="7" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="7.5" cy="3" r="1.1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 14.5h13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  cleaning: '<path d="M9.5 1.5 6.2 8M3 9.2l6.5 0 .8 5.3H2.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/><path d="M4.6 11.4v1.6M6.6 11.4v1.6M8.4 11.4v1.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  testing: '<path d="M6 1.5h4M6.8 1.5v5L3 13a1 1 0 0 0 .9 1.5h8.2A1 1 0 0 0 13 13L9.2 6.5v-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.6 10.5h6.8" stroke="currentColor" stroke-width="1.3"/>',
  drop: '<path d="M8 1.8c2.6 3.4 4.6 5.7 4.6 8.2a4.6 4.6 0 0 1-9.2 0C3.4 7.5 5.4 5.2 8 1.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.9 10.6c.3 1.1 1.1 1.8 2.2 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  pulse: '<path d="M1.5 8.5h3l1.6-4 2.6 8 1.8-5.5 1 1.5h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  bars: '<path d="M2.5 13.5h11M4.5 13.5V8.5M8 13.5V4.5M11.5 13.5V6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  arrow: '<path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  download: '<path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M2.8 13.5h10.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  book: '<path d="M2.5 3.2c2-.6 3.9-.4 5.5.8 1.6-1.2 3.5-1.4 5.5-.8v9.6c-2-.6-3.9-.4-5.5.8-1.6-1.2-3.5-1.4-5.5-.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 4v9.6" stroke="currentColor" stroke-width="1.3"/>',
  zero: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 12 12 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  play: '<path d="M5 3.2v9.6L12.5 8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
};

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', name === 'ext' ? '0 0 12 12' : '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = ICONS[name] ?? '';
  return s;
}

export function tierBadge(tier, lang = 'en') {
  const t = state.model.tiers[tier];
  return h('span', { class: `badge t-${tier}` }, icon(tier), lang === 'hi' ? h('span', { lang: 'hi' }, t.hi) : t.en);
}

export function levelBadge(level, lang = 'en') {
  return h('span', { class: `badge l-${level}` }, state.model.levels[level][lang]);
}

export const PHASE = { pre: 'before immersion', during: 'during immersion', after: 'one week after' };

export function eventLabel(key) {
  return state.model.events.find((e) => e.key === key)?.label ?? key;
}

// Null when the report PDF for that year is not in public/reports/ yet.
export function pdfHref(year, page) {
  const rep = state.model.reports[year];
  return rep?.file ? `/${rep.file}#page=${page}` : null;
}

export function openPdf(year, page) {
  const href = pdfHref(year, page);
  if (href) window.open(href, '_blank', 'noopener');
}

export function fmt(r) {
  if (!r) return '–';
  if (r.status === 'measured') return r.printed;
  if (r.status === 'bdl') return 'BDL';
  return 'n/s';
}

export function paramOf(key) {
  return state.model.params.find((p) => p.key === key);
}

// Explain a reading in one line, for tooltips.
export function describeReading(r) {
  const g = state.ghatById.get(r.ghatId);
  const p = paramOf(r.param);
  const rule = p.limit;
  const value = r.status === 'measured' ? `${r.printed}${p.unit ? ` ${p.unit}` : ''}` : r.status === 'bdl' ? 'BDL (below detection limit: very low, not zero)' : 'not sampled (unknown, not clean)';
  const verdict = { pass: 'meets the bathing limit', fail: 'breaks the bathing limit', missing: '', info: 'no Class B limit', unknown: '' }[r.check.result];
  return `${g.short} · ${eventLabel(r.event)} · ${PHASE[r.phase]}\n${p.label}: ${value}${rule && verdict ? ` · ${verdict} (${rule.short}${p.unit ? ' ' + p.unit : ''})` : verdict ? ` · ${verdict}` : ''}\nPrinted as "${r.printed}" · MPPCB ${r.year} report, page ${r.page} · CSV row ${r.csvRow}`;
}

// A link chip to the exact PDF page.
export function citeChip(year, page, title) {
  const href = pdfHref(year, page);
  if (!href) {
    const rep = state.model.reports[year];
    return h('span', { class: 'cite nolink', title: `${title ? `${title}\n\n` : ''}The ${year} report PDF is not in the app yet. Save it as ${rep?.expectedFile ?? 'public/reports/'} to open this page.` }, `${year} p.${page}`);
  }
  return h('a', { class: 'cite', href, target: '_blank', rel: 'noopener', title: title || `Open MPPCB ${year} report, page ${page}` },
    `${year} p.${page}`, icon('ext'));
}

/**
 * Render text containing [R0123] / [ghat-2023-D] tokens as text + page chips.
 * Consecutive tokens pointing at the same page collapse into one chip.
 */
export function rich(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text).split(/(\[[A-Za-z0-9-]+\](?:\s*\[[A-Za-z0-9-]+\])*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (!part.startsWith('[')) { frag.append(part.replace(/\s+…$/, ' …')); continue; }
    const ids = [...part.matchAll(/\[([A-Za-z0-9-]+)\]/g)].map((m) => m[1]);
    const pages = new Map();
    for (const id of ids) {
      const r = state.byId.get(id);
      const t = r ? state.tableById.get(r.table) : state.tableById.get(id);
      if (!t) continue;
      const key = `${t.year}|${t.page}`;
      const line = r ? describeReading(r) : `${state.ghatById.get(t.ghatId).short} · ${eventLabel(t.event)} table\nPrinted as "${t.sitePrinted}" · MPPCB ${t.year} report, page ${t.page}`;
      if (!pages.has(key)) pages.set(key, { year: t.year, page: t.page, lines: [] });
      pages.get(key).lines.push(line);
    }
    let first = true;
    for (const p of pages.values()) {
      if (!first) frag.append(' ');
      frag.append(citeChip(p.year, p.page, p.lines.join('\n\n')));
      first = false;
    }
  }
  return frag;
}

export function el(id) { return document.getElementById(id); }

export async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

// Shared floating tooltip for charts.
export const tooltip = {
  show(html, x, y) {
    const t = el('tooltip');
    t.innerHTML = html;
    t.hidden = false;
    const pad = 14;
    const r = t.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
    t.style.left = `${Math.max(8, left)}px`;
    t.style.top = `${Math.max(8, top)}px`;
  },
  hide() { el('tooltip').hidden = true; },
};

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
