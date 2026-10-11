// The forwardable deployment brief: A4 page in English + A4 page in Hindi + an A4
// resource deployment plan (bilingual) built from the allocator's numbers.
// Print or "Save as PDF" from the browser; copy as plain text for WhatsApp.

import { state, h, el, api, icon, pdfHref } from './util.js';
import { RESOURCES, allocationRules } from '/shared/allocate.js';
import { getAllocation } from './allocator.js';

const PAGES = 3;

const L = {
  en: {
    org: 'Bhopal Municipal Corporation', orgSub: 'Visarjan ghat operations',
    prepared: 'Prepared', left: (n) => `${n} day${n === 1 ? '' : 's'} to Durga Visarjan`,
    title: 'Pre-visarjan water quality brief',
    subtitle: (v) => `Bhopal immersion ghats · for ${v.en}`,
    to: 'To', toVal: 'Commissioner, Bhopal Municipal Corporation', from: 'From', fromVal: '[Name, designation]',
    summary: 'Summary', deploy: (v) => `Recommended deployment before ${v.shortEn}`,
    aeration: 'Aeration', cleaning: 'Cleaning crews', testing: 'Water testing units',
    units: (c) => `Units on hand: ${c.aeration} aeration, ${c.testing} testing kits, ${c.cleaning} cleaning crews. The ghat-by-ghat allocation is on page 3.`,
    ranking: 'Ghats ranked by risk', cols: ['#', 'Ghat', 'Risk', 'Main reason (tests failing the bathing limit)', 'Data gap', 'Report pages'],
    gaps: 'Data gaps and limits',
    foot: (engine) => `Jal Prahari · numbers computed in code from MPPCB reports · text: ${engine}`,
    page: `Page 1 of ${PAGES}`, none: '–',
  },
  hi: {
    org: 'भोपाल नगर निगम', orgSub: 'विसर्जन घाट संचालन',
    prepared: 'तैयार', left: (n) => `दुर्गा विसर्जन में ${n} दिन शेष`,
    title: 'विसर्जन-पूर्व जल गुणवत्ता संक्षेप',
    subtitle: (v) => `भोपाल के विसर्जन घाट · ${v.hi} हेतु`,
    to: 'प्रति', toVal: 'आयुक्त, भोपाल नगर निगम', from: 'प्रेषक', fromVal: '[नाम, पद]',
    summary: 'सारांश', deploy: (v) => `${v.shortHi} से पहले सुझाई गई तैनाती`,
    aeration: 'वातन (एरेशन)', cleaning: 'सफ़ाई दल', testing: 'जल परीक्षण इकाइयाँ',
    units: (c) => `उपलब्ध संसाधन: ${c.aeration} वातन इकाइयाँ, ${c.testing} परीक्षण किट, ${c.cleaning} सफ़ाई दल. घाटवार आवंटन पृष्ठ 3 पर है.`,
    ranking: 'जोखिम के आधार पर घाटों की रैंकिंग', cols: ['#', 'घाट', 'जोखिम', 'मुख्य कारण (स्नान मानक में विफल जाँचें)', 'आँकड़ों की कमी', 'रिपोर्ट पृष्ठ'],
    gaps: 'आँकड़ों की कमी और सीमाएँ',
    foot: (engine) => `जल प्रहरी · आँकड़े MPPCB रिपोर्टों से कोड द्वारा गणना · पाठ: ${engine}`,
    page: `पृष्ठ 2 / ${PAGES}`, none: '–',
  },
};

const VIEWS = [['both', 'All pages'], ['en', 'English'], ['hi', 'हिन्दी'], ['plan', 'Plan only']];

let current = null;

export function initBrief() {
  el('brief-btn').addEventListener('click', () => openBrief());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('brief').hidden) closeBrief();
  });
}

/** view: 'both' | 'en' | 'hi' | 'plan'. print: open the print dialog once ready. */
export async function openBrief({ view = 'both', print = false } = {}) {
  const overlay = el('brief');
  overlay.hidden = false;
  overlay.className = 'brief-overlay';
  document.body.style.overflow = 'hidden';
  const ai = state.status.ai.writer;
  overlay.replaceChildren(toolbar(null), h('div', { class: 'brief-loading' }, ai.enabled ? `Writing the brief with ${ai.model}…` : 'Preparing the brief…'));
  try {
    current = await api('/api/brief', {});
  } catch (err) {
    overlay.replaceChildren(toolbar(null), h('div', { class: 'brief-loading' }, `Could not build the brief (${err.message}).`));
    return;
  }
  overlay.replaceChildren(toolbar(current, view), h('div', { class: 'pages' }, page(current, 'en'), page(current, 'hi'), planPage(current)));
  setView(view);
  if (print) {
    await document.fonts?.ready;
    requestAnimationFrame(() => window.print());
  }
}

function closeBrief() {
  el('brief').hidden = true;
  document.body.style.overflow = '';
}

function setView(view) {
  el('brief').className = `brief-overlay${view === 'both' ? '' : ` only-${view}`}`;
  for (const btn of el('brief').querySelectorAll('.seg button')) btn.setAttribute('aria-pressed', String(btn.dataset.view === view));
}

function toolbar(b, view = 'both') {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Pages to show and print' },
    VIEWS.map(([k, label]) => h('button', { type: 'button', 'data-view': k, 'aria-pressed': String(k === view), onclick: () => setView(k) }, label)));
  const engine = b ? (b.engine.name === 'built-in' ? 'Text: built-in template, no AI' : `Text: ${b.engine.label}${b.engine.replaced?.length ? ` · ${b.engine.replaced.length} field(s) kept from template after number check` : ' · all numbers checked'}`) : '';
  return h('div', { class: 'brief-toolbar' },
    h('h2', {}, 'Deployment brief ', h('span', { lang: 'hi', class: 'muted', style: 'font-weight:500' }, 'तैनाती संक्षेप')),
    b ? h('span', { class: 'brief-engine' }, engine) : null,
    b?.aiError ? h('span', { class: 'notice' }, `AI unavailable (${b.aiError}). Using the built-in text.`) : null,
    b ? seg : null,
    b ? h('button', { class: 'btn', type: 'button', onclick: copyText }, 'Copy text for WhatsApp') : null,
    b ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => window.print() }, 'Print / Save PDF') : null,
    h('button', { class: 'btn', type: 'button', onclick: closeBrief, 'aria-label': 'Close brief' }, 'Close'),
  );
}

function page(b, lang) {
  const t = L[lang];
  const f = b.facts;
  const n = b.narrative[lang];
  const plan = getAllocation();
  const engineName = b.engine.name === 'built-in' ? (lang === 'hi' ? 'अंतर्निहित टेम्पलेट (AI नहीं)' : 'built-in template (no AI)') : b.engine.label;
  return h('section', { class: 'page', lang },
    h('div', { class: 'page-head' },
      h('div', { class: 'org' }, t.org, h('small', {}, t.orgSub)),
      h('div', { class: 'doc-meta' }, `${t.prepared}: `, h('b', {}, lang === 'hi' ? f.preparedHi : f.preparedEn), h('br'), t.left(f.daysLeft)),
    ),
    h('h1', {}, t.title),
    h('div', { class: 'subtitle' }, t.subtitle(f.visarjan)),
    h('dl', { class: 'memo' },
      h('dt', {}, t.to), h('dd', { contenteditable: 'true', spellcheck: 'false' }, t.toVal),
      h('dt', {}, t.from), h('dd', { contenteditable: 'true', spellcheck: 'false' }, t.fromVal),
    ),
    h('h2', {}, t.summary),
    h('p', {}, n.summary),
    h('h2', {}, t.deploy(f.visarjan)),
    h('table', { class: 'deploy-t' }, h('tbody', {},
      ['aeration', 'cleaning', 'testing'].map((k) => h('tr', {}, h('th', {}, t[k]), h('td', {}, n[k]))),
    )),
    plan ? h('p', { class: 'units-line' }, t.units(plan.counts)) : null,
    h('h2', {}, t.ranking),
    h('table', {},
      h('thead', {}, h('tr', {}, t.cols.map((c) => h('th', {}, c)))),
      h('tbody', {}, f.ranking.map((r) => h('tr', {},
        h('td', {}, r.rank),
        h('td', {}, lang === 'hi' ? r.siteHi : r.site),
        h('td', {}, h('span', { class: `pbadge t-${r.tier}` }, icon(r.tier), lang === 'hi' ? r.tierHi : r.tierEn)),
        h('td', {}, r.short[lang], h('span', { class: 'fails' }, r.fails)),
        h('td', { class: 'gapcell' }, r.gap ? r.gap[lang] : t.none),
        h('td', { class: 'pages-cell' }, r.sources.map((s, i) => [
          i ? h('br') : null, `${s.year}: `,
          s.pages.map((p, j) => [j ? ', ' : '', pdfHref(s.year, p) ? h('a', { href: pdfHref(s.year, p), target: '_blank', rel: 'noopener' }, p) : String(p)]),
        ])),
      ))),
    ),
    h('h2', {}, t.gaps),
    h('p', {}, n.gaps),
    h('p', { class: 'closing' }, n.closing),
    h('div', { class: 'page-foot' }, h('span', {}, t.foot(engineName)), h('span', {}, t.page)),
  );
}

// ---------- page 3: resource deployment plan (bilingual) ----------

const bi = (en, hi) => [en, h('span', { class: 'bi', lang: 'hi' }, hi)];

// The single most useful reason to print next to a ghat's allocation.
function mainReason(row) {
  if (row.testFirst) return row.why.testing;
  for (const k of ['aeration', 'cleaning', 'testing']) if (row.alloc[k] > 0) return row.why[k];
  const short = row.notes.find((n) => n.kind === 'short');
  if (short) return short;
  return { en: 'Nothing allocated with the units entered.', hi: 'दर्ज इकाइयों में कुछ आवंटित नहीं.' };
}

function planCell(row, r) {
  const st = row.state[r.key];
  const n = row.alloc[r.key];
  if (st === 'held') return h('td', { class: 'pc held' }, h('b', {}, 'Test first'), h('span', { class: 'bi', lang: 'hi' }, 'पहले जाँच'));
  if (st === 'short') return h('td', { class: 'pc short' }, h('b', {}, '0'), h('span', { class: 'bi' }, 'short · कमी'));
  if (st === 'not-needed') return h('td', { class: 'pc none' }, h('b', {}, '–'), h('span', { class: 'bi' }, 'not needed'));
  return h('td', { class: `pc ${n ? 'given' : 'none'}` }, h('b', {}, String(n)));
}

function planPage(b) {
  const a = getAllocation();
  if (!a) return null;
  const f = b.facts;
  const rules = allocationRules(state.model);
  const shortLines = a.lines.filter((l) => l.kind === 'short' || l.kind === 'unplaced');
  return h('section', { class: 'page plan-page' },
    h('div', { class: 'page-head' },
      h('div', { class: 'org' }, 'Bhopal Municipal Corporation · ', h('span', { lang: 'hi' }, 'भोपाल नगर निगम'), h('small', {}, 'Visarjan ghat operations · ', h('span', { lang: 'hi' }, 'विसर्जन घाट संचालन'))),
      h('div', { class: 'doc-meta' }, 'Prepared: ', h('b', {}, f.preparedEn), h('br'), h('span', { lang: 'hi' }, `तैयार: ${f.preparedHi}`)),
    ),
    h('h1', {}, 'Resource deployment plan ', h('span', { class: 'h1-hi', lang: 'hi' }, 'संसाधन तैनाती योजना')),
    h('div', { class: 'subtitle' }, `For ${f.visarjan.en} · `, h('span', { lang: 'hi' }, `${f.visarjan.hi} हेतु`)),
    h('div', { class: 'onhand' },
      h('span', { class: 'onhand-label' }, ...bi('On hand', 'उपलब्ध')),
      RESOURCES.map((r) => h('span', { class: 'onhand-item' }, h('b', {}, String(a.counts[r.key])), h('span', {}, r.en, h('span', { class: 'bi', lang: 'hi' }, r.hi)))),
    ),
    h('table', { class: 'plan-t' },
      h('thead', {}, h('tr', {},
        h('th', {}, '#'),
        h('th', {}, ...bi('Ghat', 'घाट')),
        h('th', {}, ...bi('Risk', 'जोखिम')),
        RESOURCES.map((r) => h('th', { class: 'pc' }, ...bi(r.short, r.shortHi))),
        h('th', {}, ...bi('Main reason', 'मुख्य कारण')),
      )),
      h('tbody', {}, a.rows.map((row) => {
        const why = mainReason(row);
        return h('tr', { class: row.tier === 'critical' ? 'crit' : '' },
          h('td', {}, row.rank),
          h('td', {}, h('b', {}, row.site), h('span', { class: 'bi', lang: 'hi' }, row.siteHi)),
          h('td', {}, h('span', { class: `pbadge t-${row.tier}` }, icon(row.tier), state.model.tiers[row.tier].en), h('span', { class: 'bi', lang: 'hi' }, state.model.tiers[row.tier].hi)),
          RESOURCES.map((r) => planCell(row, r)),
          h('td', { class: 'reason' }, why.en, h('span', { class: 'bi', lang: 'hi' }, why.hi)),
        );
      })),
      h('tfoot', {}, h('tr', {},
        h('td', {}),
        h('td', { colspan: 2 }, ...bi('Placed', 'भेजी गईं')),
        RESOURCES.map((r) => h('td', { class: 'pc' }, h('b', {}, `${a.totals[r.key].allocated} / ${a.totals[r.key].available}`))),
        h('td', {}),
      )),
    ),
    h('h2', {}, ...bi('Gaps', 'कमी')),
    shortLines.length
      ? h('ul', { class: 'plan-list' }, shortLines.map((l) => h('li', {}, l.en, h('span', { class: 'bi', lang: 'hi' }, l.hi))))
      : h('p', {}, 'Every ghat that needs a unit first is covered. ', h('span', { lang: 'hi' }, 'जिन घाटों को पहले इकाई चाहिए थी, सबको मिली.')),
    h('h2', {}, ...bi('How this plan is worked out', 'यह योजना कैसे बनी')),
    h('ol', { class: 'plan-list' }, rules.map((x) => h('li', {}, x.en, h('span', { class: 'bi', lang: 'hi' }, x.hi)))),
    h('div', { class: 'approve' },
      h('span', {}, 'Approved by / ', h('span', { lang: 'hi' }, 'स्वीकृतकर्ता'), h('i', {})),
      h('span', {}, 'Date / ', h('span', { lang: 'hi' }, 'दिनांक'), h('i', {})),
    ),
    h('div', { class: 'page-foot' },
      h('span', {}, 'Jal Prahari · allocation computed in code from the risk scores · annex to the pre-visarjan brief'),
      h('span', {}, `Page 3 of ${PAGES} · `, h('span', { lang: 'hi' }, `पृष्ठ 3 / ${PAGES}`))),
  );
}

// ---------- WhatsApp text ----------

function planText(lang) {
  const a = getAllocation();
  if (!a) return [];
  const hi = lang === 'hi';
  const cellText = (row, r) => {
    const st = row.state[r.key];
    const label = hi ? r.shortHi : r.short.toLowerCase();
    if (st === 'held') return `${label}: ${hi ? 'पहले जाँच' : 'test first'}`;
    if (st === 'not-needed') return null;
    return `${label} ${row.alloc[r.key]}`;
  };
  return [
    `*${hi ? 'संसाधन तैनाती योजना' : 'Resource deployment plan'}* (${RESOURCES.map((r) => `${a.counts[r.key]} ${hi ? r.shortHi : r.short.toLowerCase()}`).join(', ')})`,
    ...a.rows.map((row) => `${row.rank}. ${hi ? row.nameHi : row.name}: ${RESOURCES.map((r) => cellText(row, r)).filter(Boolean).join(', ')}`),
    ...a.lines.filter((l) => l.kind === 'short').map((l) => `- ${l[lang]}`),
    '',
  ];
}

async function copyText() {
  if (!current) return;
  const f = current.facts;
  const out = [];
  for (const lang of ['en', 'hi']) {
    const t = L[lang];
    const n = current.narrative[lang];
    out.push(
      `*${t.title}*`,
      t.subtitle(f.visarjan),
      '',
      n.summary,
      '',
      `*${t.aeration}:* ${n.aeration}`,
      `*${t.cleaning}:* ${n.cleaning}`,
      `*${t.testing}:* ${n.testing}`,
      '',
      ...planText(lang),
      `*${t.ranking}:*`,
      ...f.ranking.map((r) => `${r.rank}. ${lang === 'hi' ? r.nameHi : r.name}: ${lang === 'hi' ? r.tierHi : r.tierEn}. ${r.short[lang]}`),
      '',
      `*${t.gaps}:* ${n.gaps}`,
      '',
      n.closing,
      '',
      '———',
      '',
    );
  }
  const text = out.join('\n').trim();
  try {
    await navigator.clipboard.writeText(text);
    flash('Copied. Paste into WhatsApp or email.');
  } catch {
    flash('Copy failed. Select the text on the page instead.');
  }
}

function flash(msg) {
  const bar = el('brief').querySelector('.brief-toolbar');
  const note = h('span', { class: 'verify ok' }, msg);
  bar.insertBefore(note, bar.querySelector('.seg'));
  setTimeout(() => note.remove(), 2500);
}
