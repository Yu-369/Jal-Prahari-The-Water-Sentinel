// Ranks the ghats and explains each rank in plain English and Hindi.
// Pure arithmetic on the readings - no AI. Every sentence carries the reading IDs
// it was built from, so each number links back to a page in an MPPCB report.

import { PHASES, PHASE_LABEL, FESTIVAL_HI, GHATS, eventRank, eventLabelOf } from './dataset.js';

export const CORE = ['DO', 'BOD', 'pH'];

const PARAM_WEIGHTS = { DO: 0.5, BOD: 0.35, pH: 0.15 };
const DURGA_WEIGHT = 1.5;
const CRITICAL_DO = 3;

// How the score works for the years in the data (also shown in the UI and README).
export function methodFor(period) {
  const yw = Object.entries(period.yearWeights).sort((a, b) => b[0] - a[0]);
  return {
    paramWeights: PARAM_WEIGHTS,
    yearWeights: period.yearWeights,
    durgaWeight: DURGA_WEIGHT,
    recentYears: period.recentYears,
    criticalDO: CRITICAL_DO,
    summary: [
      'Only the three parameters with a CPCB Class B (bathing) limit count: DO ≥ 5 mg/l, BOD ≤ 3 mg/l, pH 6.5–8.5.',
      'Each failing test gets a severity from 0.25 (just over the line) to 1 (DO at 0, BOD at 12+ mg/l, pH 1.5 units out). Passing tests score 0.',
      `Recent tests count more (${yw.map(([y, w]) => `${y} ×${w}`).join(', ')}) and Durga tests count 1.5× because the next event is Durga. The three most recent years in the data are used.`,
      'Score = 100 × (0.50 × DO severity + 0.35 × BOD severity + 0.15 × pH severity), averaged over the tests that were actually done. Missing tests are left out of the average - they are never counted as passes.',
      `Tier first, then score: Critical if DO fell below 3 mg/l in any ${period.recentSpan} test; Warning if any bathing limit was broken in the two latest festivals tested.`,
    ],
  };
}

export const TIERS = {
  critical: { en: 'Critical', hi: 'गंभीर', order: 0 },
  warning: { en: 'Warning', hi: 'चेतावनी', order: 1 },
  safe: { en: 'Within limits', hi: 'मानक के भीतर', order: 2 },
  nodata: { en: 'No data', hi: 'आँकड़े नहीं', order: 3 },
};

export const ACTIONS = {
  aeration: { en: 'Aeration', hi: 'वातन (एरेशन)' },
  cleaning: { en: 'Cleaning crew', hi: 'सफ़ाई दल' },
  testing: { en: 'Water testing unit', hi: 'जल परीक्षण इकाई' },
};

export const LEVELS = {
  priority: { en: 'Priority', hi: 'प्राथमिकता' },
  standard: { en: 'Standard', hi: 'सामान्य' },
  routine: { en: 'Routine', hi: 'नियमित' },
  none: { en: 'Not indicated', hi: 'आवश्यक नहीं दिखता' },
};

// ---------- small helpers ----------

const isNum = (r) => r.status === 'measured';
const fails = (r) => r.check.result === 'fail';
const ids = (rs) => rs.map((r) => r.id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Hindi "test": oblique (… में) and direct forms.
const jaanch = (n) => (n === 1 ? 'जाँच' : 'जाँचों');
const jaanche = (n) => (n === 1 ? 'जाँच' : 'जाँचें');

export function val(r) {
  if (r.status === 'measured') return r.printed;
  if (r.status === 'bdl') return 'BDL';
  return 'not sampled';
}

export function when(r, lang = 'en') {
  return lang === 'hi'
    ? `${FESTIVAL_HI[r.festival]} ${r.year}, ${PHASE_LABEL[r.phase].hi}`
    : `${r.festival} ${r.year}, ${PHASE_LABEL[r.phase].en}`;
}

const PHASE_SHORT = {
  en: { pre: 'before', during: 'during', after: 'one week after' },
  hi: { pre: 'पहले', during: 'दौरान', after: 'एक सप्ताह बाद' },
};

// "Ganesh 2023: one week after; Durga 2023: before, during"
export function groupWhen(rs, lang = 'en') {
  const groups = [];
  const keys = [...new Set(rs.map((r) => r.event))].sort((a, b) => eventRank(a) - eventRank(b));
  for (const key of keys) {
    const inEv = rs.filter((r) => r.event === key);
    const phases = PHASES.filter((p) => inEv.some((r) => r.phase === p)).map((p) => PHASE_SHORT[lang][p]);
    const r0 = inEv[0];
    groups.push(`${lang === 'hi' ? `${FESTIVAL_HI[r0.festival]} ${r0.year}` : `${r0.festival} ${r0.year}`}: ${phases.join(', ')}`);
  }
  return groups.join('; ');
}

function minBy(rs) { return rs.reduce((a, b) => (b.value < a.value ? b : a), rs[0]); }
function maxBy(rs) { return rs.reduce((a, b) => (b.value > a.value ? b : a), rs[0]); }
const phDistance = (v) => (v < 6.5 ? 6.5 - v : v > 8.5 ? v - 8.5 : 0);

function range(rs) {
  const vs = rs.map((r) => r.value);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const p = (v) => rs.find((r) => r.value === v).printed;
  return lo === hi ? p(lo) : `${p(lo)}–${p(hi)}`;
}

// ---------- scoring ----------

export function severity(r, rules) {
  if (!fails(r)) return 0;
  if (r.status === 'bdl') return 1; // BDL against a minimum limit (e.g. DO): effectively none
  const v = r.value;
  const rule = rules[r.param];
  if (r.param === 'DO') return 0.25 + 0.75 * Math.min(1, (rule.limit - v) / rule.limit);
  if (r.param === 'BOD') return 0.25 + 0.75 * Math.min(1, (v - rule.limit) / 9);
  if (r.param === 'pH') {
    const d = v < rule.min ? rule.min - v : v - rule.max;
    return 0.25 + 0.75 * Math.min(1, d / 1.5);
  }
  return 0;
}

export function weight(r, method) {
  return method.yearWeights[r.year] * (r.festival === 'Durga' ? method.durgaWeight : 1);
}

function scoreGhat(rs, rules, method) {
  const parts = {};
  let total = 0;
  let wsum = 0;
  for (const p of CORE) {
    const tested = rs.filter((r) => r.param === p && (r.status === 'measured' || r.status === 'bdl') && r.check.result !== 'unknown');
    if (!tested.length) { parts[p] = null; continue; }
    let num = 0;
    let den = 0;
    for (const r of tested) { num += weight(r, method) * severity(r, rules); den += weight(r, method); }
    const s = num / den;
    parts[p] = {
      severity: round(s, 3),
      failing: tested.filter(fails).length,
      tested: tested.length,
      points: round(100 * PARAM_WEIGHTS[p] * s, 1),
    };
    total += PARAM_WEIGHTS[p] * s;
    wsum += PARAM_WEIGHTS[p];
  }
  // Re-normalise if a parameter had no tests at all, so a gap never lowers the score.
  return { score: wsum ? round((100 * total) / wsum, 1) : null, parts };
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- explanations ----------

function reasonsFor(rs, period) {
  const DO = rs.filter((r) => r.param === 'DO' && isNum(r));
  const BOD = rs.filter((r) => r.param === 'BOD' && isNum(r));
  const PH = rs.filter((r) => r.param === 'pH' && isNum(r));
  const concerns = [];
  const positives = [];

  // 1. Zero or very low oxygen
  const zeros = DO.filter((r) => r.value === 0);
  if (zeros.length) {
    concerns.push({
      kind: 'do-zero',
      en: `Dissolved oxygen read 0 mg/l in ${plural(zeros.length, 'test')} (${groupWhen(zeros)}). The bathing limit is at least 5 mg/l.`,
      hi: `${zeros.length} जाँचों में घुलित ऑक्सीजन 0 mg/l दर्ज हुई (${groupWhen(zeros, 'hi')}). स्नान मानक: कम से कम 5 mg/l.`,
      evidence: ids(zeros),
    });
  } else if (DO.length) {
    const low = DO.filter((r) => r.value < CRITICAL_DO);
    if (low.length) {
      const w = minBy(DO);
      concerns.push({
        kind: 'do-low',
        en: `Dissolved oxygen fell to ${val(w)} mg/l (${when(w)}); ${low.length} of ${DO.length} tests ${low.length === 1 ? 'was' : 'were'} below 3 mg/l.`,
        hi: `घुलित ऑक्सीजन घटकर ${val(w)} mg/l रह गई (${when(w, 'hi')}); ${DO.length} में से ${low.length} ${jaanche(low.length)} 3 mg/l से कम.`,
        evidence: ids(low),
      });
    }
  }

  // 2. Latest Durga festival with DO data
  const durgaYears = [...new Set(DO.filter((r) => r.festival === 'Durga').map((r) => r.year))];
  if (durgaYears.length) {
    const y = Math.max(...durgaYears);
    const ld = DO.filter((r) => r.festival === 'Durga' && r.year === y);
    const ldFail = ld.filter(fails);
    if (ldFail.length) {
      concerns.push({
        kind: 'do-durga',
        en: `Latest Durga test (${y}): DO was ${range(ld)} mg/l, below 5 in ${ldFail.length} of ${ld.length} tests.`,
        hi: `पिछली दुर्गा जाँच (${y}): DO ${range(ld)} mg/l, ${ld.length} में से ${ldFail.length} ${jaanch(ldFail.length)} में 5 से कम.`,
        evidence: ids(ld),
      });
    }
  }

  // 3. DO failure rate
  const doFail = DO.filter(fails);
  if (doFail.length) {
    concerns.push({
      kind: 'do-rate',
      en: `DO below 5 mg/l in ${doFail.length} of ${DO.length} tests (${period.span}).`,
      hi: `${DO.length} में से ${doFail.length} जाँचों में DO 5 mg/l से कम (${period.span}).`,
      evidence: ids(doFail),
    });
  } else if (DO.length) {
    positives.push({
      kind: 'do-ok',
      en: `DO met the 5 mg/l limit in all ${DO.length} tests.`,
      hi: `सभी ${DO.length} जाँचों में DO 5 mg/l मानक के भीतर.`,
      evidence: ids(DO),
    });
  }

  // 4. BOD
  const bodFail = BOD.filter(fails);
  if (bodFail.length) {
    const w = maxBy(BOD);
    concerns.push({
      kind: 'bod',
      en: `BOD above 3 mg/l in ${bodFail.length} of ${BOD.length} tests; highest ${val(w)} mg/l (${when(w)}).`,
      hi: `${BOD.length} में से ${bodFail.length} जाँचों में BOD 3 mg/l से अधिक; सर्वाधिक ${val(w)} mg/l (${when(w, 'hi')}).`,
      evidence: ids(bodFail),
    });
  } else if (BOD.length) {
    positives.push({
      kind: 'bod-ok',
      en: `BOD within 3 mg/l in all ${BOD.length} tests.`,
      hi: `सभी ${BOD.length} जाँचों में BOD 3 mg/l के भीतर.`,
      evidence: ids(BOD),
    });
  }

  // 5. pH
  const phFail = PH.filter(fails);
  if (phFail.length) {
    const w = phFail.reduce((a, b) => (phDistance(b.value) > phDistance(a.value) ? b : a));
    concerns.push({
      kind: 'ph',
      en: `pH outside 6.5–8.5 in ${phFail.length} of ${PH.length} tests; furthest out ${val(w)} (${when(w)}).`,
      hi: `${PH.length} में से ${phFail.length} ${jaanch(phFail.length)} में pH 6.5–8.5 सीमा से बाहर; सबसे दूर ${val(w)} (${when(w, 'hi')}).`,
      evidence: ids(phFail),
    });
  } else if (PH.length) {
    positives.push({
      kind: 'ph-ok',
      en: `pH stayed within 6.5–8.5 in all ${PH.length} tests.`,
      hi: `सभी ${PH.length} जाँचों में pH 6.5–8.5 के भीतर.`,
      evidence: ids(PH),
    });
  }

  return { concerns, positives };
}

function dataNotesFor(ghat, rs, eventParams, events) {
  const notes = [];
  const durgaYears = rs.filter((r) => r.festival === 'Durga').map((r) => r.year);
  const latestDurga = durgaYears.length ? Math.max(...durgaYears) : null;

  for (const ev of events) {
    const inEv = rs.filter((r) => r.event === ev.key);
    if (!inEv.length) {
      notes.push({
        kind: 'no-table',
        event: ev.key,
        en: `No ${ev.label} table in the MPPCB ${ev.year} report, so there is no reading for this festival. Treat it as unknown, not clean.${ev.festival === 'Durga' && latestDurga ? ` The latest Durga data is from ${latestDurga}.` : ''}`,
        hi: `MPPCB ${ev.year} रिपोर्ट में ${ev.hi} की कोई तालिका नहीं है, इसलिए इस त्योहार की कोई रीडिंग नहीं. इसे अज्ञात मानें, साफ़ नहीं.${ev.festival === 'Durga' && latestDurga ? ` नवीनतम दुर्गा आँकड़े ${latestDurga} के हैं.` : ''}`,
        evidence: [],
      });
      continue;
    }
    // Whole phases with nothing sampled
    const emptyPhases = PHASES.filter((p) => inEv.filter((r) => r.phase === p).every((r) => r.status === 'missing'));
    if (emptyPhases.length) {
      const sampled = PHASES.filter((p) => !emptyPhases.includes(p));
      const why = [...new Set(emptyPhases.map((p) => inEv.find((r) => r.phase === p).missingReason))];
      notes.push({
        kind: 'partial',
        event: ev.key,
        en: `${ev.label}: sampled ${sampled.map((p) => PHASE_LABEL[p].en).join(' and ')} only. ${why.map((w) => w.en).join(' ')}`,
        hi: `${ev.hi}: केवल ${sampled.map((p) => PHASE_LABEL[p].hi).join(' और ')} नमूना. ${why.map((w) => w.hi).join(' ')}`,
        evidence: ids(inEv.filter((r) => emptyPhases.includes(r.phase) && r.param === 'pH')),
      });
    }
    // Core parameters missing inside an otherwise sampled phase
    for (const p of CORE) {
      if (!eventParams[ev.key].has(p)) continue;
      const gaps = inEv.filter((r) => r.param === p && r.status === 'missing' && !emptyPhases.includes(r.phase));
      if (!gaps.length) continue;
      const phases = gaps.map((r) => PHASE_LABEL[r.phase]);
      notes.push({
        kind: 'core-gap',
        event: ev.key,
        en: `${p} not sampled in ${ev.label} (${phases.map((x) => x.en).join(', ')}).`,
        hi: `${ev.hi} में ${p} का नमूना नहीं (${phases.map((x) => x.hi).join(', ')}).`,
        evidence: ids(gaps),
      });
    }
  }

  if (rs.some((r) => r.confidence !== 'high')) {
    const byFestival = (f) => [...new Set(rs.filter((r) => r.festival === f).map((r) => r.sitePrinted))];
    notes.unshift({
      kind: 'site-uncertain',
      en: `Site identity is uncertain (medium match confidence). Ganesh tables print "${byFestival('Ganesh')[0]}"; Durga tables print "${byFestival('Durga')[0]}". These may be two different places, so this ghat's history may mix two sites.`,
      hi: `स्थान की पहचान अनिश्चित है (मध्यम विश्वास). गणेश तालिकाओं में "कमला पार्क कुंड" और दुर्गा तालिकाओं में "छोटा तालाब घाट" छपा है. ये दो अलग स्थान हो सकते हैं, इसलिए इस घाट का इतिहास दो जगहों का मिश्रण हो सकता है.`,
      evidence: [rs.find((r) => r.festival === 'Ganesh')?.id, rs.find((r) => r.festival === 'Durga')?.id].filter(Boolean),
    });
  }
  // no-table first: it's the most important gap for the coming Durga.
  return notes.sort((a, b) => (a.kind === 'no-table' ? -1 : 0) - (b.kind === 'no-table' ? -1 : 0));
}

function deployFor(rs, notes, rules, period) {
  const recent = (r) => period.recentYears.includes(r.year);
  const DO = rs.filter((r) => r.param === 'DO' && isNum(r) && recent(r));
  const BOD = rs.filter((r) => r.param === 'BOD' && isNum(r) && recent(r));
  const out = {};

  const minDO = DO.length ? minBy(DO) : null;
  if (minDO && minDO.value < CRITICAL_DO) {
    out.aeration = { level: 'priority', en: `DO fell to ${val(minDO)} mg/l (${when(minDO)}).`, hi: `DO घटकर ${val(minDO)} mg/l रह गई (${when(minDO, 'hi')}).`, evidence: [minDO.id] };
  } else if (minDO && minDO.value < rules.DO.limit) {
    out.aeration = { level: 'standard', en: `DO dipped to ${val(minDO)} mg/l (${when(minDO)}).`, hi: `DO ${val(minDO)} mg/l तक गिरी (${when(minDO, 'hi')}).`, evidence: [minDO.id] };
  } else {
    out.aeration = { level: 'none', en: `DO met 5 mg/l in every ${period.recentSpan} test.`, hi: `${period.recentSpan} की हर जाँच में DO 5 mg/l के भीतर.`, evidence: ids(DO) };
  }

  const maxBOD = BOD.length ? maxBy(BOD) : null;
  const bodLatest = BOD.filter((r) => r.year === period.latest && fails(r));
  if (maxBOD && maxBOD.value > 3 * rules.BOD.limit) {
    const x = round(maxBOD.value / rules.BOD.limit, 1);
    out.cleaning = { level: 'priority', en: `BOD reached ${val(maxBOD)} mg/l, ${x}× the limit (${when(maxBOD)}).`, hi: `BOD ${val(maxBOD)} mg/l तक पहुँचा, मानक का ${x} गुना (${when(maxBOD, 'hi')}).`, evidence: [maxBOD.id] };
  } else if (bodLatest.length) {
    const w = maxBy(bodLatest);
    out.cleaning = { level: 'standard', en: `BOD above 3 mg/l in ${plural(bodLatest.length, 'test')} in ${period.latest} (highest ${val(w)} mg/l).`, hi: `${period.latest} की ${bodLatest.length} ${jaanch(bodLatest.length)} में BOD 3 mg/l से अधिक (सर्वाधिक ${val(w)} mg/l).`, evidence: ids(bodLatest) };
  } else {
    out.cleaning = { level: 'none', en: `BOD within 3 mg/l in ${period.latest} tests.`, hi: `${period.latest} की जाँचों में BOD 3 mg/l के भीतर.`, evidence: [] };
  }

  const why = [];
  for (const n of notes.filter((x) => x.kind === 'no-table' && x.event.startsWith(String(period.latest)))) {
    why.push({ en: `No ${eventLabelOf(n.event)} test on record: test before, during and after visarjan.`, hi: `${eventLabelOf(n.event, 'hi')} की कोई जाँच दर्ज नहीं: विसर्जन से पहले, दौरान और बाद में जाँच करें.` });
  }
  if (notes.some((n) => n.kind === 'partial' && n.event.startsWith(String(period.latest)))) {
    why.push({ en: `Part of the ${period.latest} sampling is missing: add before and after samples.`, hi: `${period.latest} के कुछ नमूने छूटे हैं: पहले और बाद के नमूने भी लें.` });
  }
  if (notes.some((n) => n.kind === 'site-uncertain')) {
    why.push({ en: 'Confirm which location is sampled; test both if Kamla Park kund and the Lower Lake ghat are two places.', hi: 'पुष्टि करें कि नमूना किस स्थान से लिया जाता है; कमला पार्क कुंड और छोटा तालाब घाट अलग हों तो दोनों की जाँच करें.' });
  }
  out.testing = why.length
    ? { level: 'priority', en: why.map((w) => w.en).join(' '), hi: why.map((w) => w.hi).join(' '), evidence: [] }
    : { level: 'routine', en: 'Routine before / during / after testing.', hi: 'नियमित: विसर्जन से पहले, दौरान और बाद में जाँच.', evidence: [] };

  return out;
}

// ghatEvents: festivals this ghat has a table for. allEvents: festivals present in
// the data at all (a festival whose report is not out yet is left off, not "missing").
function trendsFor(rs, ghatEvents, allEvents, years) {
  const trends = {};
  const pickWorst = { DO: minBy, BOD: maxBy, pH: (xs) => xs.reduce((a, b) => (phDistance(b.value) > phDistance(a.value) ? b : a)) };
  const label = { DO: 'lowest DO', BOD: 'highest BOD', pH: 'pH furthest from range' };
  const labelHi = { DO: 'न्यूनतम DO', BOD: 'अधिकतम BOD', pH: 'सीमा से सबसे दूर pH' };

  for (const p of CORE) {
    trends[p] = {};
    for (const festival of ['Ganesh', 'Durga']) {
      const points = years.filter((year) => allEvents.has(`${year}-${festival}`)).map((year) => {
        const key = `${year}-${festival}`;
        if (!ghatEvents.has(key)) return { year, status: 'no-table' };
        const xs = rs.filter((r) => r.event === key && r.param === p && isNum(r));
        if (!xs.length) return { year, status: 'not-sampled' };
        const w = pickWorst[p](xs);
        return { year, status: fails(w) ? 'fail' : 'pass', value: w.value, printed: w.printed, id: w.id, n: xs.length };
      });
      const have = points.filter((x) => x.value !== undefined);
      let verdict = null;
      if (p !== 'pH' && have.length >= 2) {
        const last = have[have.length - 1];
        const d = last.value - have[0].value;
        const step = p === 'DO' ? 1 : 2;
        const better = p === 'DO' ? d >= step : d <= -step;
        const worse = p === 'DO' ? d <= -step : d >= step;
        verdict = worse ? 'worse' : better ? 'better' : 'similar';
        // A series that is still failing is never "better", even if the number moved.
        if (verdict !== 'worse' && have[0].status === 'fail' && last.status === 'fail') verdict = 'still-failing';
      }
      const latestMissing = points.length > 0 && points[points.length - 1].value === undefined;
      const seq = (lang) => (!points.length ? (lang === 'hi' ? 'इन वर्षों में कोई आँकड़ा नहीं' : 'no data in these years') : points.map((x) => `${x.year} ${x.printed ?? (x.status === 'no-table' ? (lang === 'hi' ? 'कोई तालिका नहीं' : 'no table') : (lang === 'hi' ? 'नमूना नहीं' : 'not sampled'))}`).join(' → '));
      const vEn = { better: 'better', worse: 'worse', similar: 'little change', 'still-failing': 'still outside the limit' }[verdict];
      const vHi = { better: 'सुधार', worse: 'बिगड़ा', similar: 'लगभग समान', 'still-failing': 'अब भी मानक से बाहर' }[verdict];
      const tailEn = verdict ? ` (${vEn}${latestMissing ? '; latest year missing' : ''})` : '';
      const tailHi = verdict ? ` (${vHi}${latestMissing ? '; नवीनतम वर्ष अनुपलब्ध' : ''})` : '';
      trends[p][festival] = {
        points,
        verdict,
        latestMissing,
        en: `${festival}, ${label[p]}: ${seq('en')}${tailEn}`,
        hi: `${FESTIVAL_HI[festival]}, ${labelHi[p]}: ${seq('hi')}${tailHi}`,
      };
    }
  }
  return trends;
}

function coverageFor(rs, eventParams, ghatEvents, events) {
  const cov = {};
  for (const p of CORE) {
    let expected = 0;
    for (const ev of events) if (eventParams[ev.key].has(p)) expected += 3;
    const tested = rs.filter((r) => r.param === p && r.status !== 'missing').length;
    cov[p] = { expected, tested, missing: expected - tested };
  }
  cov.tables = { expected: events.length, present: ghatEvents.size };
  return cov;
}

function tierFor(rs, rules, period, events) {
  const recentDO = rs.filter((r) => r.param === 'DO' && isNum(r) && period.recentYears.includes(r.year));
  const low = recentDO.filter((r) => r.value < CRITICAL_DO);
  if (low.length) {
    const w = minBy(low);
    return {
      tier: 'critical',
      en: `DO fell below 3 mg/l in a ${period.recentSpan} test (lowest ${val(w)} mg/l, ${when(w)}).`,
      hi: `${period.recentSpan} की जाँच में DO 3 mg/l से नीचे गई (न्यूनतम ${val(w)} mg/l, ${when(w, 'hi')}).`,
      evidence: ids(low),
    };
  }
  const withCore = events.filter((ev) => rs.some((r) => r.event === ev.key && CORE.includes(r.param) && r.status !== 'missing'));
  const latest = withCore.slice(-2);
  if (!latest.length) return { tier: 'nodata', en: 'No bathing-limit tests on record.', hi: 'स्नान मानक की कोई जाँच दर्ज नहीं.', evidence: [] };
  const latestFails = rs.filter((r) => latest.some((ev) => ev.key === r.event) && CORE.includes(r.param) && fails(r));
  if (latestFails.length) {
    return {
      tier: 'warning',
      en: `Broke a CPCB bathing limit in its latest tests (${latest.map((e) => e.label).join(', ')}): ${latestFails.length} failing tests.`,
      hi: `नवीनतम जाँचों (${latest.map((e) => e.hi).join(', ')}) में CPCB स्नान मानक का उल्लंघन: ${latestFails.length} जाँचें विफल.`,
      evidence: ids(latestFails),
    };
  }
  return { tier: 'safe', en: `Met all three bathing limits in its latest tests (${latest.map((e) => e.label).join(', ')}).`, hi: `नवीनतम जाँचों में तीनों स्नान मानक पूरे.`, evidence: [] };
}

// ---------- main ----------

export function analyse(readings, rules, period, events) {
  const method = methodFor(period);
  const eventParams = {};
  for (const ev of events) eventParams[ev.key] = new Set(readings.filter((r) => r.event === ev.key).map((r) => r.param));

  const ghats = GHATS.map((g) => {
    const rs = readings.filter((r) => r.ghatId === g.id);
    const ghatEvents = new Set(rs.map((r) => r.event));
    const { score, parts } = scoreGhat(rs, rules, method);
    const tier = tierFor(rs, rules, period, events);
    const { concerns, positives } = reasonsFor(rs, period);
    const notes = dataNotesFor(g, rs, eventParams, events);
    return {
      id: g.id,
      site: g.site,
      short: g.short,
      hi: g.hi,
      hiShort: g.hiShort,
      waterBody: g.waterBody,
      waterBodyHi: g.waterBodyHi,
      location: g.location,
      confidence: rs.some((r) => r.confidence !== 'high') ? 'medium' : 'high',
      score,
      scoreParts: parts,
      tier: tier.tier,
      tierWhy: tier,
      concerns,
      positives,
      notes,
      deploy: deployFor(rs, notes, rules, period),
      trends: trendsFor(rs, ghatEvents, new Set(events.map((e) => e.key)), period.years),
      coverage: coverageFor(rs, eventParams, ghatEvents, events),
      violations: ids(rs.filter((r) => CORE.includes(r.param) && fails(r))),
      events: events.map((ev) => ev.key).filter((k) => ghatEvents.has(k)),
    };
  });

  ghats.sort((a, b) => TIERS[a.tier].order - TIERS[b.tier].order || (b.score ?? -1) - (a.score ?? -1));
  ghats.forEach((g, i) => { g.rank = i + 1; });
  return { ghats, eventParams };
}
