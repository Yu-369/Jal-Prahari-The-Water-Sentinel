// Trend charts for DO, BOD and pH: six festivals x three tests, as capsules.
// Black capsule = meets the CPCB bathing limit, red = breaks it. A dashed
// capsule is a test that was not sampled; three dashed capsules mark a festival
// with no table at all. Unknown is never drawn as clean.

import { state, h, tooltip, pdfHref, openPdf, paramOf, PHASE, escapeHtml } from './util.js';

const C = {
  pass: '#161616', fail: '#D7382A', grid: '#DCDED8', text: '#8A8D88', ink: '#161616',
  missing: '#A6A9A4', limit: '#D7382A', label: '#5B5E59',
};

function niceTicks(lo, hi, target = 4) {
  const span = hi - lo;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target + 0.5);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function domain(key, values) {
  if (key === 'pH') {
    const lo = Math.min(6, Math.floor(Math.min(...values, 6.5) * 2) / 2);
    const hi = Math.max(9.5, Math.ceil(Math.max(...values, 8.5) * 2) / 2);
    return [lo, hi];
  }
  const max = Math.max(...values, key === 'DO' ? 10 : 9);
  const step = key === 'DO' ? 2 : 5;
  return [0, Math.ceil((max * 1.08) / step) * step];
}

const phDistance = (v) => (v < 6.5 ? 6.5 - v : v > 8.5 ? v - 8.5 : 0);

export function trendChart(ghatId, key, width) {
  const { model } = state;
  const g = state.ghatById.get(ghatId);
  const p = paramOf(key);
  const rule = p.limit;
  const unit = p.unit ? ` ${p.unit}` : '';
  const W = Math.max(340, Math.floor(width));
  const H = 196;
  const M = { l: 34, r: 8, t: 28, b: 34 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const evs = model.events;
  const gw = pw / evs.length;
  const bw = Math.max(8, Math.min(18, gw * 0.15));
  const rs = model.readings.filter((r) => r.ghatId === ghatId && r.param === key);
  const measured = rs.filter((r) => r.status === 'measured');
  const [lo, hi] = domain(key, measured.length ? measured.map((r) => r.value) : [rule?.limit ?? 0]);
  const y = (v) => M.t + ph - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * ph;
  const base = y(lo);
  const x = (i, j) => M.l + i * gw + gw * (0.26 + 0.24 * j);

  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${p.label} at ${g.short}, each festival before, during and one week after immersion` });

  // Grid and y ticks
  for (const t of niceTicks(lo, hi)) {
    svg.append(h('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), stroke: C.grid, 'stroke-width': 1 }));
    svg.append(h('text', { x: M.l - 8, y: y(t) + 3.5, 'text-anchor': 'end', 'font-size': 10.5, fill: C.text, class: 'num' }, t));
  }

  // Bathing limit line(s), labelled in text ink
  const limits = rule ? (rule.type === 'range' ? [[rule.max, -6], [rule.min, 13]] : [[rule.limit, rule.type === 'min' ? -6 : 13]]) : [];
  for (const [v, dy] of limits) {
    svg.append(h('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: C.limit, 'stroke-width': 1.25 }));
    svg.append(h('text', { x: W - M.r - 2, y: y(v) + dy, 'text-anchor': 'end', 'font-size': 10.5, fill: C.label }, `limit ${v}`));
  }

  // Festival labels (Durga, the coming event, in ink)
  evs.forEach((ev, i) => {
    const label = gw > 78 ? ev.label : `${ev.festival[0]}${String(ev.year).slice(2)}`;
    svg.append(h('text', {
      x: M.l + i * gw + gw / 2, y: H - 10, 'text-anchor': 'middle', 'font-size': 11.5,
      fill: ev.festival === 'Durga' ? C.ink : C.text, 'font-weight': ev.festival === 'Durga' ? 600 : 400,
    }, label));
  });

  // The worst failing reading gets a value pill, like the reference's "87%"
  const failing = measured.filter((r) => r.check.result === 'fail');
  const worst = failing.length
    ? failing.reduce((a, b) => (key === 'DO' ? (b.value < a.value ? b : a) : key === 'pH' ? (phDistance(b.value) > phDistance(a.value) ? b : a) : (b.value > a.value ? b : a)))
    : null;

  const dashed = (cx) => h('rect', { x: cx - bw / 2, y: M.t, width: bw, height: base - M.t, rx: bw / 2, fill: 'none', stroke: C.missing, 'stroke-width': 1.2, 'stroke-dasharray': '3 3' });

  evs.forEach((ev, i) => {
    const inEv = rs.filter((r) => r.event === ev.key);
    if (!inEv.length) {
      [0, 1, 2].forEach((j) => svg.append(dashed(x(i, j))));
      const cx = M.l + i * gw + gw / 2;
      svg.append(h('rect', { x: cx - 52, y: M.t + ph / 2 - 22, width: 104, height: 46, rx: 16, fill: '#FFFFFF' }));
      svg.append(h('text', { x: cx, y: M.t + ph / 2 - 5, 'text-anchor': 'middle', 'font-size': 10.5, fill: C.label, 'font-weight': 600 }, 'No table'));
      svg.append(h('text', { x: cx, y: M.t + ph / 2 + 14, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.text }, 'unknown, not clean'));
      return;
    }
    ['pre', 'during', 'after'].forEach((phz, j) => {
      const r = inEv.find((x2) => x2.phase === phz);
      if (!r) return;
      const cx = x(i, j);
      const isNum = r.status === 'measured';
      if (isNum) {
        const yTop = Math.min(y(r.value), base - bw);
        const fill = r.check.result === 'fail' ? C.fail : C.pass;
        svg.append(h('rect', { x: cx - bw / 2, y: yTop, width: bw, height: base - yTop, rx: bw / 2, fill }));
        svg.append(h('circle', { cx, cy: yTop + bw / 2, r: Math.max(2, bw * 0.2), fill: '#FFFFFF', 'pointer-events': 'none' }));
        if (worst && r.id === worst.id) {
          const txt = `${r.printed}${unit}`;
          const wPill = txt.length * 6.6 + 16;
          const px = Math.min(W - M.r - wPill, cx + bw / 2 + 4);
          const py = Math.max(2, yTop - 2);
          svg.append(h('rect', { x: px, y: py, width: wPill, height: 20, rx: 10, fill: C.ink, 'pointer-events': 'none' }));
          svg.append(h('text', { x: px + wPill / 2, y: py + 14, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 600, fill: '#FFFFFF', 'pointer-events': 'none' }, txt));
        }
      } else {
        svg.append(dashed(cx));
        svg.append(h('circle', { cx, cy: M.t + bw / 2, r: Math.max(2, bw * 0.2), fill: C.missing, 'pointer-events': 'none' }));
      }
      const hit = h('rect', { class: 'hit', x: cx - Math.max(bw, 12), y: M.t, width: Math.max(bw, 12) * 2, height: base - M.t + 4, fill: 'transparent', tabindex: 0, role: 'button', 'aria-label': ariaFor(r, p) });
      const show = (e) => {
        const box = e.clientX ? { x: e.clientX, y: e.clientY } : (() => { const b = hit.getBoundingClientRect(); return { x: b.right, y: b.top }; })();
        tooltip.show(tooltipHtml(r, p, unit), box.x, box.y);
      };
      hit.addEventListener('mouseenter', show);
      hit.addEventListener('mousemove', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('mouseleave', tooltip.hide);
      hit.addEventListener('blur', tooltip.hide);
      const open = () => openPdf(r.year, r.page);
      hit.addEventListener('click', open);
      hit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      svg.append(hit);
    });
  });
  svg.append(h('line', { x1: M.l, x2: W - M.r, y1: base, y2: base, stroke: '#C9CCC6', 'stroke-width': 1 }));
  return svg;
}

function ariaFor(r, p) {
  const v = r.status === 'measured' ? `${r.printed}` : r.status === 'bdl' ? 'below detection limit' : 'not sampled';
  return `${r.festival} ${r.year} ${PHASE[r.phase]}: ${p.label} ${v}. Opens report page ${r.page}.`;
}

function tooltipHtml(r, p, unit) {
  const rule = p.limit;
  let line;
  if (r.status === 'measured') {
    const verdict = r.check.result === 'fail' ? '<span style="color:#B02A1E;font-weight:600">breaks</span> the bathing limit' : 'meets the bathing limit';
    line = `${escapeHtml(p.label)}: <span class="tt-val">${escapeHtml(r.printed)}${unit}</span><br>${rule ? `${verdict} (${escapeHtml(rule.short)}${unit})` : 'no Class B limit'}`;
  } else {
    line = `${escapeHtml(p.label)}: <b>not sampled</b>, unknown and not counted as clean<br><span class="tt-muted">${escapeHtml(r.missingReason?.en ?? '')}</span>`;
  }
  return `<b>${r.festival} ${r.year}</b> · ${PHASE[r.phase]}<br>${line}<br><span class="tt-muted">MPPCB ${r.year} report, page ${r.page}${pdfHref(r.year, r.page) ? ' · click to open' : ' (PDF not in the app yet)'}</span>`;
}
