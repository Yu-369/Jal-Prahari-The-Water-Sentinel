// Risk score by ghat, drawn as stacked capsules: lime = BOD risk points,
// black = oxygen (DO) risk points, grey = pH points. The pill on top is the
// score in its tier colour. A dashed capsule behind a ghat marks a data gap:
// the part of the picture that is unknown, never assumed clean.

import { state, h, el, tooltip, onSelect, select, escapeHtml } from './util.js';
import { dataStatus } from '/shared/allocate.js';

const C = { do: '#161616', bod: '#E6F68B', ph: '#B7BAB4', grid: '#DCDED8', text: '#8A8D88', ink: '#161616', gap: '#9FA29D', col: '#FFFFFF' };
const PILL = { critical: ['#D7382A', '#FFFFFF'], warning: ['#EBA335', '#241800'], safe: ['#2E8B45', '#FFFFFF'], nodata: ['#9A9D99', '#FFFFFF'] };
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let timer;

export function renderScoreChart() {
  draw();
  onSelect(() => draw());
  window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(draw, 150); });
}

function draw() {
  const box = el('score-chart');
  if (!box || !state.model) return;
  const { model } = state;
  const W = Math.max(300, Math.floor(box.clientWidth || 800));
  const narrow = W < 600;
  const H = narrow ? 250 : 300;
  const M = { l: 30, r: 4, t: 44, b: 34 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const ghats = model.ghats;
  const maxScore = Math.max(10, ...ghats.map((g) => g.score ?? 0));
  const top = Math.ceil((maxScore + 6) / 10) * 10;
  const y = (v) => M.t + ph - (Math.max(0, v) / top) * ph;
  const base = y(0);
  const gw = pw / ghats.length;
  const bw = Math.max(18, Math.min(54, gw * 0.42));

  const svg = h('svg', {
    viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
    'aria-label': `Risk score by ghat: ${ghats.map((g) => `${g.short} ${g.score}`).join(', ')}`,
  });

  // Grid
  for (let v = 0; v <= top; v += 10) {
    svg.append(h('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: C.grid, 'stroke-width': 1 }));
    svg.append(h('text', { x: M.l - 8, y: y(v) + 3.5, 'text-anchor': 'end', 'font-size': 10.5, fill: C.text, class: 'num' }, v));
  }

  ghats.forEach((g, i) => {
    const cx = M.l + gw * (i + 0.5);
    const x0 = cx - bw / 2;
    const parts = g.scoreParts || {};
    const raw = { bod: parts.BOD?.points ?? 0, dox: parts.DO?.points ?? 0, ph: parts.pH?.points ?? 0 };
    const sum = raw.bod + raw.dox + raw.ph;
    const k = sum > 0 ? (g.score ?? 0) / sum : 0; // stack adds up to the score shown
    const bod = raw.bod * k;
    const dox = raw.dox * k;
    const total = g.score ?? 0;
    const selected = g.id === state.selected;
    const gap = dataStatus(g, model.events).testFirst;
    const capsule = (from, to, fill, extra = {}) => {
      const yTop = Math.min(y(to), base - bw);
      return h('rect', { x: x0, y: yTop, width: bw, height: base - yTop, rx: bw / 2, fill, ...extra });
    };

    if (selected) svg.append(h('rect', { x: cx - gw / 2 + 4, y: M.t - 36, width: gw - 8, height: base - M.t + 62, rx: 22, fill: C.col, opacity: 0.75 }));

    const group = h('g', { class: 'sc-col', style: `--i:${i}` });
    if (gap) {
      group.append(h('rect', { x: x0, y: M.t, width: bw, height: base - M.t, rx: bw / 2, fill: 'none', stroke: C.gap, 'stroke-width': 1.3, 'stroke-dasharray': '4 4' }));
      group.append(h('circle', { cx, cy: M.t + bw / 2, r: Math.max(3, bw * 0.13), fill: C.gap }));
    }
    group.append(capsule(0, total, C.ph));
    group.append(capsule(0, bod + dox, C.do));
    if (bod > 0) group.append(capsule(0, bod, C.bod));
    const dot = (val, fill) => group.append(h('circle', { cx, cy: Math.min(y(val), base - bw) + bw / 2, r: Math.max(3, bw * 0.13), fill }));
    if (dox > 0.05) dot(bod + dox, '#FFFFFF');
    if (bod > 0.05) dot(bod, C.ink);

    // Score pill
    const [pf, pt] = PILL[g.tier] || PILL.nodata;
    const label = String(g.score);
    const pwid = narrow ? Math.max(32, label.length * 6.6 + 10) : Math.max(40, label.length * 8 + 18);
    const py = Math.min(y(total), base - bw) - 32;
    group.append(h('rect', { x: cx - pwid / 2, y: py, width: pwid, height: 24, rx: 12, fill: pf }));
    group.append(h('text', { x: cx, y: py + 16.5, 'text-anchor': 'middle', 'font-size': narrow ? 10.5 : 12.5, 'font-weight': 600, fill: pt, class: 'num' }, label));

    // Ghat name
    const name = narrow ? String(g.rank).padStart(2, '0') : gw < 100 ? g.short.split(' ')[0] : g.short; // narrow: rank numbers, as on the rows
    group.append(h('text', { x: cx, y: H - 10, 'text-anchor': 'middle', 'font-size': narrow ? 10.5 : 12.5, fill: selected ? C.ink : C.text, 'font-weight': selected ? 600 : 400 }, name));
    svg.append(group);

    // Hit area: hover explains, click selects the ghat
    const hit = h('rect', {
      x: cx - gw / 2, y: M.t - 36, width: gw, height: H - M.t + 36, fill: 'transparent', class: 'sc-hit', tabindex: 0, role: 'button',
      'aria-label': `${g.site}: risk score ${g.score}, ${model.tiers[g.tier].en}${gap ? ', data gap' : ''}. Select this ghat.`,
    });
    const html = `<b>#${g.rank} ${escapeHtml(g.short)}</b> · ${model.tiers[g.tier].en}<br>Risk score <span class="tt-val">${g.score}</span> = oxygen ${parts.DO?.points ?? 0} + BOD ${parts.BOD?.points ?? 0} + pH ${parts.pH?.points ?? 0}${gap ? `<br><span class="tt-muted">${escapeHtml(dataStatus(g, model.events).reason.en)}: unknown, not clean</span>` : ''}<br><span class="tt-muted">Click to select</span>`;
    const show = (e) => {
      const b = e.clientX ? { x: e.clientX, y: e.clientY } : (() => { const r = hit.getBoundingClientRect(); return { x: r.right - 20, y: r.top + 40 }; })();
      tooltip.show(html, b.x, b.y);
    };
    hit.addEventListener('mousemove', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('mouseleave', tooltip.hide);
    hit.addEventListener('blur', tooltip.hide);
    const choose = () => {
      tooltip.hide();
      select(g.id);
      document.querySelector(`.ghat-card[data-id="${g.id}"]`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    };
    hit.addEventListener('click', choose);
    hit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    svg.append(hit);
  });

  box.replaceChildren(svg);
  // Columns rise in once on load; later redraws (selection, resize) are instant.
  if (!box.dataset.drawn) { box.dataset.drawn = 'pending'; setTimeout(() => { box.dataset.drawn = 'yes'; }, 1200); }
}
