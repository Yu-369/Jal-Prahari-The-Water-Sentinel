// Ranked list of ghats. Each card shows the tier, score, top reasons, data gaps
// and a strip with one square per DO / BOD test (missing tests are hatched).

import { state, h, icon, select, onSelect, el, eventLabel, PHASE } from './util.js';

const STRIP_PARAMS = ['DO', 'BOD'];

export function renderList() {
  const { model } = state;
  el('list-legend').replaceChildren(
    h('span', {}, h('i', { class: 'sq fail' }), 'breaks bathing limit'),
    h('span', {}, h('i', { class: 'sq pass' }), 'meets limit'),
    h('span', {}, h('i', { class: 'sq missing' }), 'no test (not sampled / no table)'),
  );

  const list = el('ghat-list');
  list.replaceChildren(...model.ghats.map((g) => h('li', {}, card(g))));
  onSelect((id) => {
    for (const b of list.querySelectorAll('.ghat-card')) b.setAttribute('aria-current', String(b.dataset.id === id));
  });
}

function card(g) {
  const { model } = state;
  const reasons = g.concerns.slice(0, 2).map((c) => h('li', {}, shorten(c.en)));
  if (!reasons.length && g.positives.length) reasons.push(h('li', {}, g.positives[0].en));
  const flags = [];
  for (const n of g.notes.filter((x) => x.kind === 'no-table')) flags.push(h('span', { class: 'gap-flag' }, icon('gap'), `No ${eventLabel(n.event)} test`));
  if (g.notes.some((n) => n.kind === 'site-uncertain')) flags.push(h('span', { class: 'gap-flag' }, icon('site'), 'May be two places'));

  return h('button', {
    class: 'ghat-card', type: 'button', 'data-id': g.id, 'aria-current': 'false',
    'aria-label': `Rank ${g.rank}: ${g.site}, ${model.tiers[g.tier].en}, score ${g.score}`,
    onclick: () => select(g.id, { scroll: true }),
  },
    h('div', { class: `rank t-${g.tier}` }, g.rank),
    h('div', {},
      h('div', { class: 'card-top' },
        h('div', {},
          h('div', { class: 'ghat-name' }, g.site),
          h('div', { class: 'ghat-sub' }, h('span', { lang: 'hi' }, g.hi), ` · ${g.waterBody}`),
        ),
        h('div', { class: 'score' }, h('b', { class: 'num' }, g.score), 'risk score'),
      ),
      h('div', { style: 'margin-top:6px' }, tierChip(g)),
      h('ul', { class: 'reasons' }, reasons),
      flags.length ? h('div', {}, flags) : null,
      strips(g),
      h('div', { class: 'alloc', 'data-alloc': g.id }), // filled by allocator.js
    ),
  );
}

function tierChip(g) {
  const t = state.model.tiers[g.tier];
  return h('span', { class: `badge t-${g.tier}` }, icon(g.tier), t.en, h('span', { lang: 'hi', style: 'font-weight:500;opacity:.85' }, ` · ${t.hi}`));
}

// Keep card reasons to one line of meaning; the detail panel has the full text.
function shorten(text) {
  return text.replace(/ The bathing limit is at least 5 mg\/l\./, '').replace(/ \((Ganesh|Durga) \d{4}: [^)]*\)/, '');
}

function strips(g) {
  const { model } = state;
  const rows = STRIP_PARAMS.map((p) => h('div', { class: 'strip' },
    h('span', { class: 'strip-label' }, p),
    h('div', { class: 'strip-groups' }, model.events.map((ev) => h('div', { class: 'strip-group' },
      ['pre', 'during', 'after'].map((ph) => {
        const r = model.readings.find((x) => x.ghatId === g.id && x.event === ev.key && x.phase === ph && x.param === p);
        const cls = !r ? 'notable' : r.status === 'missing' ? 'missing' : r.check.result;
        const tip = !r ? `${ev.label} · ${PHASE[ph]}: no table in the report` : `${ev.label} · ${PHASE[ph]}: ${p} ${r.status === 'measured' ? r.printed : r.status === 'missing' ? 'not sampled' : 'BDL'}`;
        return h('i', { class: `sq ${cls}`, title: tip });
      }),
    ))),
  ));
  const axis = h('div', { class: 'strip-axis', 'aria-hidden': 'true' },
    model.events.map((ev) => h('span', { class: ev.festival === 'Durga' ? 'd' : '' }, ev.short)));
  return h('div', { class: 'strips', 'aria-label': `Test strip for ${g.short}: ${model.events[0]?.label} to ${model.events.at(-1)?.label}` }, rows, axis);
}
