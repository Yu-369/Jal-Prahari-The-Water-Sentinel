// Resource allocator: the officer enters the units they have; every ranked ghat
// shows what to send, recalculated on each keystroke. The arithmetic lives in
// /shared/allocate.js (the same code the printable plan and the tests use).

import { state, h, el, icon, onSelect } from './util.js';
import { RESOURCES, DEFAULT_COUNTS, MAX_UNITS, allocate, cleanCounts } from '/shared/allocate.js';
import { openBrief } from './brief.js';

const STORE = 'jal-prahari-resources';
let current = null;

export function getAllocation() {
  return current;
}

function loadCounts() {
  try {
    return cleanCounts({ ...DEFAULT_COUNTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') });
  } catch {
    return { ...DEFAULT_COUNTS };
  }
}

function saveCounts(counts) {
  try { localStorage.setItem(STORE, JSON.stringify(counts)); } catch { /* private mode: fine */ }
}

const downloadIcon = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="M10 3.5V13M6 9l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 14.5v2h13v-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
};

export function initAllocator() {
  const box = el('allocator');
  const counts = loadCounts();
  box.replaceChildren(
    h('div', { class: 'alloc-head' },
      h('p', { class: 'eyebrow', id: 'alloc-title' }, 'Resource allocator'),
      h('h3', { class: 'alloc-title' }, 'Put your units where the risk is'),
      h('p', { class: 'alloc-lede' }, 'Enter what you have. Each ranked ghat shows what to send.'),
    ),
    h('div', { class: 'alloc-inputs', role: 'group', 'aria-labelledby': 'alloc-title' }, RESOURCES.map((r) => field(r, counts[r.key]))),
    h('div', { class: 'alloc-summary', id: 'alloc-summary', 'aria-live': 'polite' }),
    h('button', { class: 'btn btn-outline', id: 'plan-btn', type: 'button', onclick: () => openBrief({ view: 'plan', print: true }) },
      downloadIcon(), 'Download deployment plan'),
  );
  box.addEventListener('input', update);
  box.addEventListener('change', normalise);
  onSelect(() => fillDetail()); // registered after the detail panel, so it runs after it renders
  update();
}

function field(r, value) {
  const id = `alloc-${r.key}`;
  return h('div', { class: 'alloc-field', 'data-resource': r.key },
    h('label', { for: id }, icon(r.key), h('span', {}, r.en), h('span', { lang: 'hi' }, r.shortHi)),
    h('div', { class: 'stepper' },
      h('button', { type: 'button', tabindex: '-1', 'aria-label': `One fewer: ${r.en}`, onclick: () => step(r.key, -1) }, '−'),
      h('input', { id, type: 'number', inputmode: 'numeric', min: 0, max: MAX_UNITS, step: 1, value }),
      h('button', { type: 'button', tabindex: '-1', 'aria-label': `One more: ${r.en}`, onclick: () => step(r.key, 1) }, '+'),
    ),
  );
}

function step(key, delta) {
  const input = el(`alloc-${key}`);
  const next = cleanCounts({ [key]: (Number(input.value) || 0) + delta })[key];
  input.value = next;
  update();
}

// On blur, show the number actually used (e.g. "-2" or "abc" becomes 0).
function normalise(e) {
  const key = e.target.id?.replace('alloc-', '');
  if (current && key in current.counts) e.target.value = current.counts[key];
}

function readCounts() {
  return cleanCounts(Object.fromEntries(RESOURCES.map((r) => [r.key, el(`alloc-${r.key}`).value])));
}

function update() {
  const counts = readCounts();
  saveCounts(counts);
  current = allocate(state.model, counts);
  renderSummary();
  renderRows();
  fillDetail();
}

const noun = (r, n) => `${n} ${n === 1 ? r.one : r.many}`;
const nameOf = (id) => state.ghatById.get(id)?.short ?? id;

function renderSummary() {
  const box = el('alloc-summary');
  const shorts = RESOURCES.filter((r) => current.totals[r.key].short > 0);
  const unplaced = RESOURCES.filter((r) => current.totals[r.key].unplaced > 0);
  const items = shorts.map((r) => {
    const t = current.totals[r.key];
    return h('div', { class: 'alloc-line short', title: current.lines.find((l) => l.resource === r.key).en },
      icon('warning'), h('span', {}, h('b', {}, `${noun(r, t.short)} short`), ` · ${t.uncovered.map(nameOf).join(', ')}`));
  });
  for (const r of unplaced) {
    items.push(h('div', { class: 'alloc-line unplaced' }, icon('nodata'), h('span', {}, `${noun(r, current.totals[r.key].unplaced)} not needed by the data`)));
  }
  if (!shorts.length) {
    items.unshift(h('div', { class: 'alloc-line ok' }, icon('ok'), h('span', {}, h('b', {}, 'Every critical ghat is covered'))));
  }
  box.replaceChildren(...items);
}

const SYMBOL = { given: null, short: '0', held: '–', 'not-needed': '–', none: '0' };
const STATE_TEXT = {
  given: (r, n) => `${noun(r, n)}`,
  short: (r) => `no ${r.one} left (critical: more needed)`,
  held: (r) => `${r.one} held back: test first`,
  'not-needed': (r) => `no ${r.one} needed by the data`,
  none: (r) => `no ${r.one} with the units entered`,
};

function renderRows() {
  for (const row of current.rows) {
    const cell = document.querySelector(`.alloc[data-alloc="${row.id}"]`);
    if (!cell) continue;
    const parts = RESOURCES.map((r) => {
      const st = row.state[r.key];
      const n = row.alloc[r.key];
      return h('span', { class: `alloc-n s-${st}`, title: `${r.short}: ${STATE_TEXT[st](r, n)}. ${row.why[r.key].en}` },
        icon(r.key), h('b', {}, st === 'given' ? String(n) : SYMBOL[st]));
    });
    let note = null;
    if (row.testFirst) note = h('span', { class: 'alloc-note test' }, 'Test first');
    else if (Object.values(row.state).includes('short')) note = h('span', { class: 'alloc-note short' }, 'Short');
    cell.replaceChildren(...[h('span', { class: 'alloc-set' }, parts), note].filter(Boolean));
    cell.setAttribute('aria-label', `Send to ${row.name}: ${RESOURCES.map((r) => STATE_TEXT[row.state[r.key]](r, row.alloc[r.key])).join('; ')}`);
  }
}

const DETAIL_TEXT = {
  given: (r, n, t) => `Send ${n} of ${t.available}`,
  short: () => 'None left · short',
  held: () => 'Held · test first',
  'not-needed': () => 'Not needed',
  none: () => 'None with units entered',
};

function fillDetail() {
  if (!current || !state.selected) return;
  const row = current.rows.find((x) => x.id === state.selected);
  for (const span of document.querySelectorAll('#detail [data-alloc-detail]')) {
    const key = span.dataset.allocDetail;
    const r = RESOURCES.find((x) => x.key === key);
    const st = row.state[key];
    span.className = `deploy-alloc s-${st}`;
    span.textContent = DETAIL_TEXT[st](r, row.alloc[key], current.totals[key]);
  }
}
