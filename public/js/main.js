// Entry point: load the model, render every panel, select the top-ranked ghat.

import { state, init, h, el, api, select, tierBadge, rich, icon } from './util.js';

const eventLabelOf = (key) => { const [y, f] = key.split('-'); return `${f} ${y}`; };

function sourceLine(model) {
  const src = model.source;
  const when = src.updatedAt ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(src.updatedAt)) : '';
  return src.uploaded
    ? `uploaded ${src.uploadedName ? `"${src.uploadedName}" ` : ''}${when} (${src.rows} rows)`
    : `original data pack, bhopal_ghats_2023_2025.csv (${src.rows} rows)`;
}
import { renderList } from './list.js';
import { renderMap } from './map.js';
import { initDetail } from './detail.js';
import { initAsk, askQuestion } from './ask.js';
import { initBrief } from './brief.js';
import { initUpload } from './upload.js';
import { initAllocator } from './allocator.js';
import { renderScoreChart } from './scorechart.js';

async function main() {
  initUpload();
  let model;
  let status;
  try {
    [model, status] = await Promise.all([api('/api/model'), api('/api/status')]);
  } catch (err) {
    el('detail').replaceChildren(h('div', { class: 'empty' }, `Could not load data (${err.message}). Is the server running?`));
    return;
  }
  init(model, status);
  el('brand-sub').textContent = `Water-quality risk at Bhopal's visarjan ghats · MPPCB tests ${model.period.span} against CPCB bathing limits`;
  el('upload-btn').title = `Load a new MPPCB readings CSV (same columns as bhopal_ghats_2023_2025.csv). Years in the file replace those years; other years are kept. Now using: ${sourceLine(model)}`;
  el('period-pill').textContent = `MPPCB tests ${model.period.span}`;
  renderCountdown();
  renderTiles();
  renderList();
  renderScoreChart();
  for (const card of document.querySelectorAll('[data-ask]')) card.addEventListener('click', () => askQuestion(card.dataset.ask));
  initDetail();
  initAllocator();
  initAsk();
  initBrief();
  renderAbout();
  renderFooter();
  try { renderMap(); } catch (err) { el('map').replaceChildren(h('div', { class: 'empty' }, `Map unavailable (${err.message}).`)); }
  select(model.ghats[0].id);
}

function renderCountdown() {
  const v = state.model.visarjan;
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const days = Math.round((Date.parse(v.date) - Date.parse(todayIST)) / 86_400_000);
  const when = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(v.date));
  el('countdown').replaceChildren(
    h('span', {}, h('b', {}, 'Durga Visarjan'), ` · ${when}`),
    days > 0 ? h('span', { class: 'days' }, `${days} day${days === 1 ? '' : 's'} left`) : days === 0 ? h('span', { class: 'days' }, 'Today') : h('span', {}, 'Passed'),
  );
}

function renderTiles() {
  const { model } = state;
  const o = model.overview;
  const name = (id) => state.ghatById.get(id).short;
  const zeroGhats = [...new Set(o.DO.zeroIds.map((id) => state.byId.get(id).ghatId))].map(name);
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const tenths = (p) => Array.from({ length: 10 }, (_, i) => (i < Math.round(p / 10) ? 'fill' : 'empty'));
  const gapGhats = [...new Set(o.noTable.map((n) => n.ghatId))];
  const gapEvents = [...new Set(o.noTable.map((n) => n.event))].map(eventLabelOf);
  const tiles = [
    {
      icon: 'drop', title: 'Oxygen below limit', value: o.DO.failing, den: `/ ${o.DO.tested} tests`,
      pill: `${pct(o.DO.failing, o.DO.tested)}%`, ring: pct(o.DO.failing, o.DO.tested), caps: tenths(pct(o.DO.failing, o.DO.tested)),
      note: 'DO under the 5 mg/l bathing limit', q: 'How many DO tests broke the limit?',
    },
    {
      icon: 'pulse', title: 'BOD above limit', value: o.BOD.failing, den: `/ ${o.BOD.tested} tests`, lime: true,
      pill: `${pct(o.BOD.failing, o.BOD.tested)}%`, ring: pct(o.BOD.failing, o.BOD.tested), caps: tenths(pct(o.BOD.failing, o.BOD.tested)),
      note: 'BOD over the 3 mg/l bathing limit', q: 'How many BOD tests broke the limit?',
    },
    {
      icon: 'zero', title: 'Zero-oxygen tests', value: o.DO.zeroIds.length, den: 'at 0 mg/l', alert: o.DO.zeroIds.length > 0,
      pill: zeroGhats.join(', ') || 'none', caps: o.DO.zeroIds.map(() => 'alert'),
      note: 'Real readings, not errors', q: 'Which ghat had zero oxygen?',
    },
    {
      icon: 'gap', title: 'Missing festival tables', value: gapGhats.length, den: `/ ${model.ghats.length} ghats`,
      pill: gapEvents.join(', ') || 'none', caps: [...model.ghats.filter((g) => !gapGhats.includes(g.id)).map(() => 'fill'), ...gapGhats.map(() => 'missing')],
      note: gapGhats.length ? `${gapGhats.map(name).join(', ')}: unknown, not clean` : 'Every ghat has every table', q: 'Where is data missing?',
    },
  ];
  el('tiles').replaceChildren(...tiles.map((t) => h('button', {
    class: `kpi${t.lime ? ' kpi-lime' : ''}${t.alert ? ' kpi-alert' : ''}`, type: 'button', onclick: () => askQuestion(t.q), title: `Ask: ${t.q}`,
    'aria-label': `${t.title}: ${t.value} ${t.den}. ${t.note}. Ask for details.`,
  },
    h('span', { class: 'kpi-head' }, h('span', { class: 'ico-sq' }, icon(t.icon)), h('span', { class: 'kpi-title' }, t.title), h('span', { class: 'kpi-arrow' }, icon('arrow'))),
    h('span', { class: 'kpi-num' },
      h('b', {}, t.value),
      h('span', { class: 'kpi-side' },
        h('span', { class: 'kpi-pill' }, t.pill, t.ring !== undefined ? ring(t.ring) : null),
        h('span', { class: 'kpi-den' }, t.den),
      ),
    ),
    h('span', { class: 'kpi-caps', 'aria-hidden': 'true' }, t.caps.map((c) => h('i', { class: `cap cap-${c}` }))),
    h('span', { class: 'kpi-note' }, t.note),
  )));
}

// A small progress ring, like the reference's "82% ◯".
function ring(p) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return h('svg', { class: 'ring', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
    h('circle', { cx: 8, cy: 8, r, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.2', 'stroke-width': 2 }),
    h('circle', { cx: 8, cy: 8, r, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-dasharray': `${(c * p) / 100} ${c}`, transform: 'rotate(-90 8 8)' }),
  );
}

function renderAbout() {
  const { model } = state;
  const m = model.method;
  el('about').replaceChildren(
    h('div', { class: 'card', id: 'method' },
      h('h2', {}, 'How the ranking works'),
      h('ul', {}, m.summary.map((s) => h('li', {}, s))),
      h('div', { class: 'tier-rules' },
        h('div', {}, tierBadge('critical'), h('span', {}, `DO fell below ${m.criticalDO} mg/l in any ${m.recentYears.join('–')} test.`)),
        h('div', {}, tierBadge('warning'), h('span', {}, 'Broke a bathing limit in the two latest festivals tested.')),
        h('div', {}, tierBadge('safe'), h('span', {}, 'Met all three limits in the latest tests. No ghat qualifies today.')),
        h('div', {}, tierBadge('nodata'), h('span', {}, 'No bathing-limit test on record.')),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'What this data does not cover'),
      h('ul', {}, model.caveats.map((c) => h('li', {}, c.evidence?.length ? rich(`${c.en} [${c.evidence[0]}]`) : c.en))),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Sources'),
      h('ul', {},
        Object.values(model.reports).map((r) => h('li', {}, `${r.title}${r.pages ? ` (${r.pages} pages)` : ''}: `,
          r.file ? h('a', { href: `/${r.file}`, target: '_blank', rel: 'noopener' }, 'local copy') : `PDF not in the app yet (save as ${r.expectedFile})`,
          r.url ? [' · ', h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'mppcb.mp.gov.in')] : null)),
        h('li', {}, 'Limits: ', h('a', { href: 'https://cpcb.gov.in/water-quality-criteria/', target: '_blank', rel: 'noopener' }, 'CPCB water quality criteria'), ' (data/cpcb_water_quality_criteria.csv).'),
        h('li', {}, `Readings: ${model.readings.length} rows for ${model.period.span} from ${sourceLine(model)}. Each value shows its report page; click to open it.`),
        h('li', {}, 'To add a new year, use "Upload new report" with a CSV in the same columns. ', h('a', { href: '/api/data.csv' }, 'Download the data in use'), ' to start from it.'),
        h('li', {}, 'Ghat positions: OpenStreetMap (approximate).'),
        h('li', {}, 'Ranking, limit checks and every number are computed in code. AI, when switched on, only writes sentences, and every number it writes is checked against the data.'),
      ),
    ),
  );
}

function renderFooter() {
  el('footer').replaceChildren(
    h('span', {}, 'Jal Prahari · open source (MIT)'),
    h('span', {}, `Reports: MPPCB Ganesh and Durga Visarjan ${state.model.period.span}`),
    h('span', {}, 'Limits: CPCB Class B (outdoor bathing)'),
    h('span', {}, 'Map data © ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap'), ' contributors'),
    h('span', {}, `Data: ${sourceLine(state.model)} · `, h('a', { href: '/api/data.csv' }, 'download CSV')),
    h('span', {}, `Built for the BMC officer planning ${state.model.visarjan.en}`),
  );
}

main();
