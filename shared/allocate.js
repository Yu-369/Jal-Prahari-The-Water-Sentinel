// Resource allocator: how to share the units the officer actually has across the
// ghats. Pure function, no DOM and no network, so the browser (instant updates),
// the printable plan and the tests all run exactly the same code.
//
// Rules, in order:
//  1. Units only go where the data shows a need:
//       aeration     - DO fell below 5 mg/l in the last two years
//       cleaning     - BOD broke the bathing limit recently, and the ghat has
//                      enough data (otherwise: test first, crew held back)
//       testing kits - any ghat
//  2. Each critical ghat gets one unit first. Testing kits go first to ghats that
//     need testing before anything else (missing data), then to a ghat whose site
//     is uncertain, then to the other critical ghats, and then one to every other
//     ghat (coverage beats a second kit at the same ghat).
//  3. The units left over are shared in proportion to the part of the risk score
//     that the resource addresses (aeration: oxygen points, cleaning: BOD points,
//     testing: whole score), using the largest-remainder method.

export const RESOURCES = [
  { key: 'aeration', en: 'Aeration units', hi: 'वातन (एरेशन) इकाइयाँ', short: 'Aeration', shortHi: 'वातन', one: 'aeration unit', many: 'aeration units' },
  { key: 'testing', en: 'Testing kits', hi: 'जल परीक्षण किट', short: 'Testing', shortHi: 'परीक्षण', one: 'testing kit', many: 'testing kits' },
  { key: 'cleaning', en: 'Cleaning crews', hi: 'सफ़ाई दल', short: 'Cleaning', shortHi: 'सफ़ाई', one: 'cleaning crew', many: 'cleaning crews' },
];

export const DEFAULT_COUNTS = { aeration: 3, testing: 2, cleaning: 4 };
export const MAX_UNITS = 99;
const MIN_COVERAGE = 0.75; // below this share of DO/BOD tests on record, test first

const noun = (r, n) => `${n} ${n === 1 ? r.one : r.many}`;
const listEn = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const listHi = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} और ${xs[xs.length - 1]}`);

export function cleanCounts(counts = {}) {
  const out = {};
  for (const r of RESOURCES) {
    const v = Math.floor(Number(counts[r.key]));
    out[r.key] = Number.isFinite(v) ? Math.min(MAX_UNITS, Math.max(0, v)) : 0;
  }
  return out;
}

/** Does this ghat need testing before crews are committed? */
export function dataStatus(ghat, events) {
  const durga = events.filter((e) => e.festival === 'Durga');
  const latestDurga = durga[durga.length - 1];
  const missingDurga = Boolean(latestDurga) && !ghat.events.includes(latestDurga.key);
  const ratio = (p) => (ghat.coverage[p]?.expected ? ghat.coverage[p].tested / ghat.coverage[p].expected : 1);
  const coverage = Math.min(ratio('DO'), ratio('BOD'));
  const lowCoverage = coverage < MIN_COVERAGE;
  let reason = null;
  if (missingDurga) reason = { en: `no ${latestDurga.label} test`, hi: `${latestDurga.hi} की जाँच नहीं` };
  else if (lowCoverage) reason = { en: `only ${Math.round(coverage * 100)}% of DO and BOD tests on record`, hi: `DO और BOD की केवल ${Math.round(coverage * 100)}% जाँचें दर्ज` };
  return {
    testFirst: missingDurga || lowCoverage,
    reason,
    siteUncertain: ghat.notes.some((n) => n.kind === 'site-uncertain'),
  };
}

// Largest-remainder split of `units` by weight; ties go to the better rank.
function shareOut(units, items) {
  const out = new Map(items.map((x) => [x.id, 0]));
  if (units <= 0 || !items.length) return out;
  let W = items.reduce((s, x) => s + Math.max(0, x.weight), 0);
  const weights = W > 0 ? items.map((x) => Math.max(0, x.weight)) : items.map(() => 1);
  W = W > 0 ? W : items.length;
  const exact = items.map((x, i) => ({ id: x.id, rank: x.rank, share: (units * weights[i]) / W }));
  let given = 0;
  for (const e of exact) { const f = Math.floor(e.share); out.set(e.id, f); given += f; }
  exact.sort((a, b) => (b.share - Math.floor(b.share)) - (a.share - Math.floor(a.share)) || a.rank - b.rank);
  for (let i = 0; given < units; i = (i + 1) % exact.length) { out.set(exact[i].id, out.get(exact[i].id) + 1); given += 1; }
  return out;
}

export function allocate(model, rawCounts) {
  const counts = cleanCounts(rawCounts);
  const ghats = model.ghats; // already in rank order
  const status = new Map(ghats.map((g) => [g.id, dataStatus(g, model.events)]));
  const points = (g, p) => g.scoreParts?.[p]?.points ?? 0;
  const critical = (g) => g.tier === 'critical';

  const plan = {
    aeration: {
      eligible: (g) => g.deploy.aeration.level !== 'none',
      weight: (g) => points(g, 'DO'),
      firstOrder: (cands) => cands.filter(critical).sort((a, b) => points(b, 'DO') - points(a, 'DO') || a.rank - b.rank),
    },
    testing: {
      eligible: () => true,
      weight: (g) => g.score ?? 0,
      firstOrder: (cands) => {
        const seen = new Set();
        const take = (xs) => xs.filter((g) => !seen.has(g.id) && seen.add(g.id));
        return [
          ...take(cands.filter((g) => status.get(g.id).testFirst)),
          ...take(cands.filter((g) => status.get(g.id).siteUncertain)),
          ...take(cands.filter(critical)),
        ];
      },
      // After the must-cover ghats, one kit for every other ghat before any second kit.
      thenEach: (cands, first) => cands.filter((g) => !first.includes(g)),
    },
    cleaning: {
      eligible: (g) => g.deploy.cleaning.level !== 'none' && !status.get(g.id).testFirst,
      weight: (g) => points(g, 'BOD'),
      firstOrder: (cands) => cands.filter(critical).sort((a, b) => points(b, 'BOD') - points(a, 'BOD') || a.rank - b.rank),
    },
  };

  const alloc = new Map(ghats.map((g) => [g.id, { aeration: 0, testing: 0, cleaning: 0 }]));
  const state = new Map(ghats.map((g) => [g.id, {}]));
  const totals = {};

  for (const r of RESOURCES) {
    const rule = plan[r.key];
    const n = counts[r.key];
    const cands = ghats.filter(rule.eligible);
    const first = rule.firstOrder(cands);
    let left = n;
    const covered = [];
    const uncovered = [];
    for (const g of first) {
      if (left > 0) { alloc.get(g.id)[r.key] += 1; left -= 1; covered.push(g.id); } else uncovered.push(g.id);
    }
    for (const g of rule.thenEach ? rule.thenEach(cands, first) : []) {
      if (left > 0) { alloc.get(g.id)[r.key] += 1; left -= 1; }
    }
    const shares = shareOut(left, cands.map((g) => ({ id: g.id, rank: g.rank, weight: rule.weight(g) })));
    for (const [id, k] of shares) alloc.get(id)[r.key] += k;
    const allocated = [...alloc.values()].reduce((s, a) => s + a[r.key], 0);

    for (const g of ghats) {
      const st = state.get(g.id);
      if (alloc.get(g.id)[r.key] > 0) st[r.key] = 'given';
      else if (uncovered.includes(g.id)) st[r.key] = 'short';
      else if (r.key === 'cleaning' && status.get(g.id).testFirst && g.deploy.cleaning.level !== 'none') st[r.key] = 'held';
      else if (!rule.eligible(g)) st[r.key] = 'not-needed';
      else st[r.key] = 'none';
    }
    totals[r.key] = { available: n, allocated, unplaced: n - allocated, firstNeeded: first.length, uncovered, short: uncovered.length };
  }

  const rows = ghats.map((g) => {
    const s = status.get(g.id);
    const a = alloc.get(g.id);
    const st = state.get(g.id);
    const notes = [];
    if (s.testFirst) {
      notes.push({ kind: 'test-first', en: `Needs testing first (${s.reason.en}): testing kit before a cleaning crew.`, hi: `पहले जाँच ज़रूरी (${s.reason.hi}): सफ़ाई दल से पहले परीक्षण किट.` });
    }
    for (const r of RESOURCES) {
      if (st[r.key] === 'short') {
        notes.push({ kind: 'short', resource: r.key, en: `Critical, but no ${r.one} left.`, hi: `गंभीर, पर कोई ${r.shortHi} इकाई नहीं बची.` });
      }
    }
    const why = {};
    for (const r of RESOURCES) {
      if (st[r.key] === 'held') why[r.key] = { en: `Held back until tested (${s.reason.en}).`, hi: `जाँच होने तक रोका गया (${s.reason.hi}).`, evidence: [] };
      else if (r.key === 'testing') why[r.key] = s.testFirst ? { en: `Needs testing first: ${s.reason.en}.`, hi: `पहले जाँच: ${s.reason.hi}.`, evidence: [] } : { en: g.deploy.testing.en, hi: g.deploy.testing.hi, evidence: g.deploy.testing.evidence };
      else why[r.key] = { en: g.deploy[r.key].en, hi: g.deploy[r.key].hi, evidence: g.deploy[r.key].evidence };
    }
    return {
      id: g.id, rank: g.rank, name: g.short, nameHi: g.hiShort, site: g.site, siteHi: g.hi,
      tier: g.tier, score: g.score, alloc: a, state: st, why, notes,
      testFirst: s.testFirst, testReason: s.reason, siteUncertain: s.siteUncertain,
    };
  });

  // Plain-language summary, one line per resource.
  const nameOf = (id, lang) => { const g = ghats.find((x) => x.id === id); return lang === 'hi' ? g.hiShort : g.short; };
  const lines = RESOURCES.map((r) => {
    const t = totals[r.key];
    const who = (lang) => (lang === 'hi' ? listHi(t.uncovered.map((id) => nameOf(id, 'hi'))) : listEn(t.uncovered.map((id) => nameOf(id, 'en'))));
    if (t.available === 0 && t.firstNeeded === 0) return { resource: r.key, kind: 'none', en: `${r.en}: none entered, and no ghat needs one first.`, hi: `${r.hi}: कोई दर्ज नहीं, और किसी घाट को पहले इसकी ज़रूरत नहीं.` };
    if (t.short > 0) {
      return {
        resource: r.key, kind: 'short',
        en: `${r.en}: ${t.short} more needed so ${who('en')} ${t.short === 1 ? 'gets' : 'get'} one (${t.available} entered, ${t.firstNeeded} needed first).`,
        hi: `${r.hi}: ${t.short} और चाहिए ताकि ${who('hi')} को भी मिले (${t.available} दर्ज, पहले ${t.firstNeeded} ज़रूरी).`,
      };
    }
    if (t.unplaced > 0) {
      return { resource: r.key, kind: 'unplaced', en: `${r.en}: ${noun(r, t.unplaced)} not placed. No ghat needs one by the data.`, hi: `${r.hi}: ${t.unplaced} नहीं भेजी गईं. आँकड़ों के अनुसार किसी घाट को ज़रूरत नहीं.` };
    }
    return { resource: r.key, kind: 'ok', en: `${r.en}: all ${t.available} placed; every ghat that needs one first is covered.`, hi: `${r.hi}: सभी ${t.available} भेजी गईं; जिन घाटों को पहले ज़रूरत थी, सबको मिलीं.` };
  });

  return { counts, rows, totals, lines, shortTotal: RESOURCES.reduce((s, r) => s + totals[r.key].short, 0) };
}

// How the plan is worked out, for the screen and the printed plan.
export function allocationRules(model) {
  const durga = model.events.filter((e) => e.festival === 'Durga');
  const latest = durga[durga.length - 1];
  const recent = model.period.recentSpan;
  return [
    {
      en: `Units only go where the data shows a need: aeration where DO fell below 5 mg/l in ${recent}, cleaning crews where BOD broke the bathing limit, testing kits anywhere.`,
      hi: `इकाइयाँ केवल वहीं भेजी जाती हैं जहाँ आँकड़े ज़रूरत दिखाते हैं: वातन जहाँ ${recent} में DO 5 mg/l से नीचे गई, सफ़ाई दल जहाँ BOD स्नान मानक से ऊपर रहा, परीक्षण किट कहीं भी.`,
    },
    {
      en: 'Each critical ghat gets one first. Testing kits go first to ghats that need testing, and every ghat gets one before any gets a second. The rest are shared in proportion to risk: oxygen risk for aeration, BOD risk for cleaning, total score for testing.',
      hi: 'हर गंभीर घाट को पहले एक इकाई मिलती है. परीक्षण किट पहले उन घाटों को जहाँ जाँच ज़रूरी है, और किसी घाट को दूसरी किट से पहले हर घाट को एक. बाकी जोखिम के अनुपात में बाँटी जाती हैं: वातन ऑक्सीजन जोखिम से, सफ़ाई BOD जोखिम से, परीक्षण कुल अंक से.',
    },
    {
      en: `A ghat with insufficient data${latest ? ` (no ${latest.label} test, or under 75% of DO and BOD tests on record)` : ''} gets a testing kit before any cleaning crew.`,
      hi: `जिस घाट के आँकड़े अपर्याप्त हैं${latest ? ` (${latest.hi} की जाँच नहीं, या DO और BOD की 75% से कम जाँचें दर्ज)` : ''}, उसे किसी सफ़ाई दल से पहले परीक्षण किट मिलती है.`,
    },
  ];
}
