// Detail panel for the selected ghat: why it ranks where it does, what to deploy,
// 3-year trends, every bathing-limit violation and every reading, each linked to
// its page in the MPPCB report.

import { state, h, icon, tierBadge, levelBadge, rich, el, api, onSelect, eventLabel, pdfHref, openPdf, describeReading, paramOf, citeChip, setChildren, PHASE } from './util.js';
import { trendChart } from './charts.js';
import { askQuestion } from './ask.js';

const PROVIDER = { cerebras: 'Cerebras', anthropic: 'Claude' };
let resizeTimer;

export function initDetail() {
  onSelect((id, opts) => {
    render(id);
    if (opts.scroll && window.innerWidth < 1180) el('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.selected && drawCharts(state.selected), 150);
  });
}

function render(id) {
  const { model } = state;
  const g = state.ghatById.get(id);
  const parts = g.scoreParts;
  const box = el('detail');
  setChildren(box,
    h('div', { class: 'detail-head' },
      h('div', { class: `rank t-${g.tier}` }, g.rank),
      h('div', { class: 'detail-title' },
        h('h2', {}, g.site),
        h('div', { class: 'hi-name', lang: 'hi' }, g.hi),
        h('div', { class: 'detail-meta' },
          tierBadge(g.tier),
          h('span', {}, `${g.waterBody} · `, h('span', { lang: 'hi' }, g.waterBodyHi)),
          h('span', {}, `Rank ${g.rank} of ${model.ghats.length}`),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => askQuestion(`Tell me about ${g.short}`, { ghatId: g.id }) }, 'Ask about this ghat'),
        ),
      ),
      h('div', { class: 'detail-score' },
        h('div', { class: 'big num' }, g.score),
        h('div', { class: 'lbl' }, 'risk score (0–100)'),
        h('div', { class: 'breakdown num', title: 'Points from each parameter. See "How ranking works" below.' },
          ['DO', 'BOD', 'pH'].map((p) => `${p} ${parts[p]?.points ?? '–'}`).join(' + ')),
      ),
    ),
    callouts(g),
    h('div', { class: 'summary', id: 'summary' }),
    h('div', { class: 'two-col' },
      h('div', {},
        h('div', { class: 'block-title' }, `Why rank ${g.rank}`, h('span', { class: 'muted' }, 'against CPCB Class B (bathing)')),
        h('ul', { class: 'why' },
          h('li', { class: 'concern' }, icon('concern'), h('div', {}, h('b', {}, `${model.tiers[g.tier].en}: `), rich(`${g.tierWhy.en} ${tokens(g.tierWhy.evidence)}`))),
          g.concerns.map((c) => h('li', { class: 'concern' }, icon('concern'), h('div', {}, rich(`${c.en} ${tokens(c.evidence)}`), h('span', { class: 'hi', lang: 'hi' }, c.hi)))),
          g.positives.map((c) => h('li', { class: 'ok' }, icon('ok'), h('div', {}, c.en, h('span', { class: 'hi', lang: 'hi' }, c.hi)))),
        ),
      ),
      h('div', {},
        h('div', { class: 'block-title' }, 'Before visarjan: suggested deployment'),
        h('div', { class: 'deploy' }, ['aeration', 'cleaning', 'testing'].map((k) => {
          const d = g.deploy[k];
          return h('div', { class: 'deploy-row' },
            h('div', { class: 'deploy-top' },
              h('span', { class: 'deploy-name' }, icon(k), model.actions[k].en, h('span', { lang: 'hi', class: 'muted', style: 'font-weight:400;font-size:12.5px' }, model.actions[k].hi)),
              h('span', { class: 'deploy-right' }, h('span', { class: 'deploy-alloc', 'data-alloc-detail': k }), levelBadge(d.level)),
            ),
            h('div', { class: 'deploy-why' }, rich(`${d.en} ${tokens(d.evidence.slice(0, 3))}`)),
          );
        })),
      ),
    ),
    h('section', { class: 'section' },
      h('div', { class: 'section-title' },
        h('h3', {}, '3-year trend: each festival before, during and one week after immersion'),
        h('div', { class: 'chart-legend' },
          h('span', {}, h('i', { class: 'dot pass' }), 'meets limit'),
          h('span', {}, h('i', { class: 'dot fail' }), 'breaks limit'),
          h('span', {}, h('i', { class: 'dot missing' }), 'not sampled'),
          h('span', {}, h('i', { class: 'swatch-zone' }), 'bathing limit'),
          h('span', {}, h('i', { class: 'swatch-hatch' }), 'no table (unknown)'),
        ),
      ),
      h('div', { id: 'charts' }),
    ),
    violationsSection(g),
    readingsSection(g),
  );
  drawCharts(id);
  loadSummary(g);
}

const tokens = (ids) => ids.map((i) => `[${i}]`).join(' ');

function callouts(g) {
  const items = g.notes.filter((n) => ['no-table', 'site-uncertain', 'partial'].includes(n.kind)).map((n) =>
    h('div', { class: `callout ${n.kind === 'site-uncertain' ? 'site' : 'gap'}` },
      icon(n.kind === 'site-uncertain' ? 'site' : 'gap'),
      h('div', {}, rich(`${n.en} ${tokens(n.evidence)}`), h('span', { lang: 'hi' }, n.hi)),
    ));
  return items.length ? h('div', { class: 'callouts' }, items) : null;
}

async function loadSummary(g) {
  const box = el('summary');
  box.replaceChildren(h('div', { class: 'summary-head' }, h('b', {}, 'In short'), h('span', { class: 'thinking' }, h('i'), h('i'), h('i'))));
  let s;
  try {
    s = await api(`/api/summary/${g.id}`);
  } catch {
    setChildren(box, h('div', { class: 'summary-head' }, h('b', {}, 'In short')), h('p', {}, g.tierWhy.en));
    return;
  }
  if (state.selected !== g.id) return;
  const head = h('div', { class: 'summary-head' }, h('b', {}, 'In short'), engineTag(s));
  if (s.ai) {
    setChildren(box, head, h('p', {}, s.ai), verifyTag(s.verification));
  } else {
    setChildren(box, head, h('p', {}, s.en), h('p', { lang: 'hi' }, s.hi), s.aiError ? h('div', { class: 'notice', style: 'margin-top:6px' }, `AI unavailable (${s.aiError}). Showing the built-in summary.`) : null);
  }
}

export function engineTag(s) {
  if (!s.engine || s.engine === 'built-in') return h('span', {}, `Built-in engine · ${s.ms ?? 1} ms · no AI, computed from the readings`);
  return h('span', { class: 'speed' }, icon('bolt'), `${PROVIDER[s.engine] ?? s.engine} · ${s.model} · ${s.ms} ms${s.cached ? ' (cached)' : ''}`);
}

export function verifyTag(v) {
  if (!v) return null;
  if (!v.unmatched.length) return h('span', { class: 'verify ok', style: 'margin-top:6px' }, icon('ok'), v.total ? `All ${v.total} numbers match the source data` : 'No numbers to check');
  return h('span', { class: 'verify bad', style: 'margin-top:6px' }, icon('warning'), `Not found in the data: ${v.unmatched.join(', ')}. Check before use.`);
}

function drawCharts(id) {
  const wrap = el('charts');
  if (!wrap) return;
  const g = state.ghatById.get(id);
  const width = wrap.clientWidth || 640;
  wrap.replaceChildren(...['DO', 'BOD', 'pH'].map((key) => {
    const p = paramOf(key);
    const t = g.trends[key];
    return h('div', { class: 'chart' },
      h('div', { class: 'chart-title' }, h('b', {}, `${p.label}${p.unit ? ` (${p.unit})` : ''}`), h('span', {}, `bathing limit ${p.limit.text}`)),
      trendChart(id, key, width),
      h('div', { class: 'trend-lines' },
        ['Durga', 'Ganesh'].map((f) => h('div', { class: `v-${t[f].verdict ?? 'none'}` }, t[f].en))),
    );
  }));
}

function violationsSection(g) {
  const { model } = state;
  const evIdx = (k) => model.events.findIndex((e) => e.key === k);
  const rows = g.violations.map((id) => state.byId.get(id))
    .sort((a, b) => evIdx(a.event) - evIdx(b.event) || ['pre', 'during', 'after'].indexOf(a.phase) - ['pre', 'during', 'after'].indexOf(b.phase));
  return h('section', { class: 'section' },
    h('details', { class: 'fold' },
      h('summary', {}, h('h3', {}, `Bathing-limit violations (${rows.length})`), h('span', { class: 'muted', style: 'font-size:12.5px' }, 'every failing DO, BOD and pH test')),
      h('div', { class: 'table-wrap', style: 'margin-top:8px' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, ['Festival', 'Test', 'Parameter', 'Reading', 'CPCB Class B limit', 'Source'].map((t) => h('th', {}, t)))),
          h('tbody', {}, rows.map((r) => {
            const p = paramOf(r.param);
            return h('tr', {},
              h('td', {}, eventLabel(r.event)),
              h('td', {}, PHASE[r.phase]),
              h('td', {}, p.label),
              h('td', { class: 'c-fail', title: describeReading(r) }, `${r.printed}${p.unit ? ` ${p.unit}` : ''}`),
              h('td', {}, `${p.limit.text}`),
              h('td', {}, citeChip(r.year, r.page, describeReading(r))),
            );
          })),
        ),
      ),
    ),
  );
}

function readingsSection(g) {
  const { model } = state;
  const evs = model.events;
  const head1 = h('tr', {}, h('th', { class: 'param', rowspan: 2 }, 'Parameter'),
    evs.map((ev) => {
      const t = model.tables.find((x) => x.ghatId === g.id && x.event === ev.key);
      return h('th', { class: `ev${ev.festival === 'Durga' ? ' durga' : ''}`, colspan: 3 },
        t && pdfHref(t.year, t.page) ? h('a', { href: pdfHref(t.year, t.page), target: '_blank', rel: 'noopener', title: `Printed as "${t.sitePrinted}"` }, ev.label, h('span', { class: 'pg' }, `${t.year} report p.${t.page} ↗`))
          : t ? [ev.label, h('span', { class: 'pg', style: 'color:var(--muted)', title: 'Report PDF not in the app yet' }, `${t.year} report p.${t.page}`)]
          : [ev.label, h('span', { class: 'pg', style: 'color:var(--muted)' }, 'no table')]);
    }));
  const head2 = h('tr', {}, evs.map(() => ['Pre', 'During', 'After'].map((x, j) => h('th', { class: j === 0 ? 'ev' : '', style: 'text-align:center' }, x))));

  const params = model.params;
  const body = params.map((p, pi) => {
    const tr = h('tr', { class: pi === 3 ? 'sep' : '' },
      h('th', { class: 'param' }, p.label, h('small', {}, `${p.unit || 'no unit'} · ${p.limit ? `limit ${p.limit.short}` : 'no Class B limit'}`)));
    evs.forEach((ev) => {
      const t = model.tables.find((x) => x.ghatId === g.id && x.event === ev.key);
      if (!t) {
        if (pi === 0) tr.append(h('td', { class: 'c-notable first', colspan: 3, rowspan: params.length }, `No ${ev.label} table in the MPPCB ${ev.year} report. Unknown, not clean.`));
        return;
      }
      ['pre', 'during', 'after'].forEach((ph, j) => {
        const r = model.readings.find((x) => x.table === t.id && x.param === p.key && x.phase === ph);
        if (!r) { tr.append(h('td', { class: `c-missing${j === 0 ? ' first' : ''}`, title: 'Not in this table (parameter not tested at this festival)' }, '–')); return; }
        const cls = r.status === 'missing' ? 'c-missing' : r.status === 'bdl' ? 'c-bdl' : `c-${r.check.result}`;
        tr.append(h('td', {
          class: `${cls}${j === 0 ? ' first' : ''}`, title: describeReading(r),
          onclick: () => openPdf(r.year, r.page),
        }, r.status === 'measured' ? r.printed : r.status === 'bdl' ? 'BDL' : 'n/s'));
      });
    });
    return tr;
  });

  return h('section', { class: 'section' },
    h('details', { class: 'fold', open: true },
      h('summary', {}, h('h3', {}, 'All readings'), h('span', { class: 'muted', style: 'font-size:12.5px' }, `${model.readings.filter((r) => r.ghatId === g.id).length} values · click any value to open its report page`)),
      h('div', { class: 'table-wrap', style: 'margin-top:8px' }, h('table', { class: 'data readings' }, h('thead', {}, head1, head2), h('tbody', {}, body))),
      h('p', { class: 'table-note' }, 'Red: breaks the CPCB bathing limit. Green: meets it. BDL: below detection limit (very low, not zero, not missing). n/s: not sampled (unknown, never counted as clean). Metals and solids have no Class B limit and are shown for information. Units are assumed; the reports print none.'),
    ),
  );
}
