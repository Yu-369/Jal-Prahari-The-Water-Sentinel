// Builds the single in-memory model the whole app works from: readings with
// limit checks, the ranked ghats, headline numbers and honest data caveats.

import { readRows, toReadings, loadCriteria, eventsFrom, eventRank, periodFor, reportFor, PHASES, PHASE_LABEL, PARAMS, GHATS, tableId } from './dataset.js';
import { buildRules, checkReading, unmeasuredClassB } from './limits.js';
import { analyse, methodFor, TIERS, ACTIONS, LEVELS, CORE } from './risk.js';

// Next year, set VISARJAN_DATE in .env (YYYY-MM-DD).
export function visarjanInfo(date = process.env.VISARJAN_DATE || '2026-10-20') {
  const d = new Date(`${date}T00:00:00Z`);
  const fmt = (locale, opts) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }).format(d);
  const long = { day: 'numeric', month: 'long', year: 'numeric' };
  const short = { day: 'numeric', month: 'long' };
  return {
    date,
    en: `Durga Visarjan, ${fmt('en-IN', long)}`,
    hi: `दुर्गा विसर्जन, ${fmt('hi-IN', long)}`,
    shortEn: fmt('en-IN', short),
    shortHi: fmt('hi-IN', short),
  };
}

/**
 * rows: CSV records (default: the current data file). source: where they came from.
 * Only the three most recent years are analysed and shown.
 */
export function buildModel({ rows = readRows(), source = {} } = {}) {
  const criteria = loadCriteria();
  const rules = buildRules(criteria, 'B');
  const classD = buildRules(criteria, 'D');
  const classE = buildRules(criteria, 'E');
  const all = toReadings(rows);
  const period = periodFor(all);
  const readings = all.filter((r) => period.years.includes(r.year));
  for (const r of readings) r.check = checkReading(r, rules);
  const events = eventsFrom(readings);

  const { ghats, eventParams } = analyse(readings, rules, period, events);
  const tables = buildTables(readings);

  return {
    builtAt: new Date().toISOString(),
    source: { ...source, rows: all.length, years: period.allYears, shown: period.years },
    period,
    visarjan: visarjanInfo(),
    events,
    phases: PHASES.map((p) => ({ key: p, ...PHASE_LABEL[p] })),
    params: PARAMS.map(({ aliases, ...p }) => ({ ...p, limit: rules[p.key] ?? null })),
    rules,
    context: { classD_DO: classD.DO, classE_COND: classE.COND },
    reports: Object.fromEntries(period.years.map((y) => [y, reportFor(y)])),
    method: methodFor(period),
    tiers: TIERS,
    actions: ACTIONS,
    levels: LEVELS,
    ghats,
    tables,
    readings,
    overview: overview(readings, ghats, events, period),
    caveats: caveats(readings, criteria, eventParams, events, period),
  };
}

function buildTables(readings) {
  const tables = new Map();
  for (const r of readings) {
    if (!tables.has(r.table)) {
      tables.set(r.table, { id: r.table, ghatId: r.ghatId, year: r.year, festival: r.festival, event: r.event, page: r.page, sitePrinted: r.sitePrinted });
    }
  }
  // Chronological per ghat (the 2024 report prints Durga before Ganesh).
  const ghatIdx = (id) => GHATS.findIndex((g) => g.id === id);
  return [...tables.values()].sort((a, b) => ghatIdx(a.ghatId) - ghatIdx(b.ghatId) || eventRank(a.event) - eventRank(b.event));
}

function overview(readings, ghats, events, period) {
  const tested = (p) => readings.filter((r) => r.param === p && r.status === 'measured');
  const failing = (p) => tested(p).filter((r) => r.check.result === 'fail');
  const doZero = tested('DO').filter((r) => r.value === 0);
  const noTable = [];
  for (const g of GHATS) {
    for (const ev of events) {
      if (!readings.some((r) => r.ghatId === g.id && r.event === ev.key)) noTable.push({ ghatId: g.id, event: ev.key, table: tableId(g.id, ev.year, ev.festival) });
    }
  }
  // Ghats that met all three bathing limits in every test of the latest year.
  const passingLatest = ghats.filter((g) => {
    const rs = readings.filter((r) => r.ghatId === g.id && r.year === period.latest && CORE.includes(r.param) && r.status !== 'missing');
    return rs.length && rs.every((r) => r.check.result === 'pass');
  }).map((g) => g.id);

  return {
    readings: readings.length,
    measured: readings.filter((r) => r.status === 'measured').length,
    bdl: readings.filter((r) => r.status === 'bdl').length,
    missing: readings.filter((r) => r.status === 'missing').length,
    DO: { failing: failing('DO').length, tested: tested('DO').length, failingIds: failing('DO').map((r) => r.id), zeroIds: doZero.map((r) => r.id) },
    BOD: { failing: failing('BOD').length, tested: tested('BOD').length, failingIds: failing('BOD').map((r) => r.id) },
    pH: { failing: failing('pH').length, tested: tested('pH').length, failingIds: failing('pH').map((r) => r.id) },
    noTable,
    passingLatest,
    critical: ghats.filter((g) => g.tier === 'critical').map((g) => g.id),
  };
}

// What the data does not cover. Data-derived where possible, so the caveats stay
// true if the CSV is updated.
function caveats(readings, criteria, eventParams, events, period) {
  const out = [];
  const coliform = unmeasuredClassB(criteria);
  if (coliform.length) {
    out.push({
      kind: 'coliform',
      en: `${coliform.join(', ')} is part of the CPCB bathing standard but is not measured in the MPPCB visarjan reports. Bacterial safety for bathing cannot be judged from this data.`,
      hi: `टोटल कोलीफ़ॉर्म CPCB स्नान मानक का हिस्सा है, पर MPPCB विसर्जन रिपोर्टों में इसकी जाँच नहीं होती. इन आँकड़ों से स्नान के लिए जीवाणु-सुरक्षा का आकलन नहीं हो सकता.`,
    });
  }
  out.push({
    kind: 'units',
    en: 'The reports print no units. Standard units are assumed (mg/l; NTU for turbidity; µS/cm for conductivity).',
    hi: 'रिपोर्टों में इकाइयाँ नहीं छपी हैं. मानक इकाइयाँ मानी गई हैं (mg/l; गंदलापन NTU; चालकता µS/cm).',
  });
  out.push({
    kind: 'snapshot',
    en: 'Each festival has three tests per ghat (before, during, one week after). They are snapshots, not continuous monitoring.',
    hi: 'हर त्योहार पर प्रति घाट तीन जाँचें होती हैं (पहले, दौरान, एक सप्ताह बाद). ये एक समय की तस्वीर हैं, लगातार निगरानी नहीं.',
  });

  // Identical metal values printed at every ghat and phase: likely a reporting limit, not a measurement.
  for (const ev of events) {
    for (const p of PARAMS.filter((x) => x.metal)) {
      const rs = readings.filter((r) => r.event === ev.key && r.param === p.key);
      const nums = rs.filter((r) => r.status === 'measured');
      const ghatsWith = new Set(nums.map((r) => r.ghatId));
      if (nums.length >= 12 && ghatsWith.size >= 5 && new Set(nums.map((r) => r.value)).size === 1) {
        const bdl = rs.filter((r) => r.status === 'bdl').length;
        out.push({
          kind: 'identical-metal',
          en: `${ev.label}: ${p.name.toLowerCase()} reads exactly ${nums[0].printed} mg/l in every one of the ${nums.length} tests with a number, at ${ghatsWith.size} ghats${bdl ? ` (the other ${bdl} are BDL)` : ''}. The same value everywhere may be a reporting or detection limit, not a measurement. Treat with caution.`,
          hi: `${ev.hi}: ${p.hi} ${ghatsWith.size} घाटों पर अंक वाली सभी ${nums.length} जाँचों में ठीक ${nums[0].printed} mg/l है${bdl ? ` (बाकी ${bdl} BDL हैं)` : ''}. हर जगह एक जैसा मान रिपोर्टिंग या पहचान सीमा हो सकता है, असली माप नहीं. सावधानी से देखें.`,
          evidence: nums.map((r) => r.id),
        });
      }
      const allBdl = rs.length >= 12 && rs.every((r) => r.status === 'bdl');
      if (allBdl && p.key === 'Cr') {
        const metalsAllBdl = PARAMS.filter((x) => x.metal).every((m) => readings.filter((r) => r.event === ev.key && r.param === m.key).every((r) => r.status === 'bdl'));
        if (metalsAllBdl) {
          out.push({
            kind: 'all-bdl',
            en: `${ev.label}: all four metals are BDL (below detection limit) at every ghat. BDL means very low, not zero and not missing.`,
            hi: `${ev.hi}: चारों धातुएँ हर घाट पर BDL (पहचान सीमा से कम) हैं. BDL का अर्थ बहुत कम है, शून्य या अनुपलब्ध नहीं.`,
            evidence: readings.filter((r) => r.event === ev.key && PARAMS.find((m) => m.key === r.param).metal).map((r) => r.id),
          });
        }
      }
    }
  }

  const noTSS = events.filter((ev) => !eventParams[ev.key].has('TSS'));
  if (noTSS.length) {
    out.push({
      kind: 'no-tss',
      en: `Suspended solids are not in the ${noTSS.map((e) => e.label).join(' and ')} tables.`,
      hi: `${noTSS.map((e) => e.hi).join(' और ')} की तालिकाओं में निलंबित ठोस नहीं हैं.`,
    });
  }
  out.push({
    kind: 'metals',
    en: 'Only four metals were tested (chromium, lead, zinc, copper). CPCB Class B sets no metal limits, so metals are shown for information and do not affect the ranking.',
    hi: 'केवल चार धातुओं की जाँच हुई (क्रोमियम, सीसा, जस्ता, तांबा). CPCB श्रेणी B में धातुओं की कोई सीमा नहीं है, इसलिए वे केवल जानकारी के लिए हैं और रैंकिंग पर असर नहीं डालतीं.',
  });
  out.push({
    kind: 'ngt',
    en: `The National Green Tribunal has banned immersion in the Upper and Lower Lakes and BMC is building new ghats. These readings describe the sites used in ${period.span}.`,
    hi: `राष्ट्रीय हरित अधिकरण ने बड़े और छोटे तालाब में विसर्जन पर रोक लगाई है और नगर निगम नए घाट बना रहा है. ये रीडिंग ${period.span} में उपयोग हुए स्थलों की हैं.`,
  });
  out.push({
    kind: 'map',
    en: 'Map positions come from OpenStreetMap and are approximate. Four ghats are placed at a lake or locality centre.',
    hi: 'नक्शे पर स्थान OpenStreetMap से लिए गए हैं और अनुमानित हैं. चार घाट झील या इलाके के केंद्र पर रखे गए हैं.',
  });
  if (period.dropped.length) {
    out.push({
      kind: 'older-years',
      en: `The data file also holds ${period.dropped.join(', ')}. Only the three most recent years (${period.span}) are ranked and shown.`,
      hi: `डेटा फ़ाइल में ${period.dropped.join(', ')} के आँकड़े भी हैं. केवल नवीनतम तीन वर्ष (${period.span}) रैंक किए और दिखाए गए हैं.`,
    });
  }
  const noPdf = period.years.map(reportFor).filter((r) => !r.file);
  if (noPdf.length) {
    out.push({
      kind: 'no-pdf',
      en: `The ${noPdf.map((r) => r.year).join(', ')} report PDF is not in the app, so its page numbers are shown but cannot be opened. Save it as ${noPdf.map((r) => r.expectedFile).join(', ')}.`,
      hi: `${noPdf.map((r) => r.year).join(', ')} की रिपोर्ट PDF ऐप में नहीं है, इसलिए पृष्ठ संख्या दिखती है पर खुलती नहीं. इसे ${noPdf.map((r) => r.expectedFile).join(', ')} नाम से सहेजें.`,
    });
  }
  out.push({
    kind: 'health',
    en: 'This tool reports readings against CPCB limits. It does not claim health effects the data does not show.',
    hi: 'यह टूल रीडिंग की तुलना CPCB मानकों से करता है. यह ऐसे स्वास्थ्य प्रभावों का दावा नहीं करता जो आँकड़ों में नहीं दिखते.',
  });
  return out;
}
