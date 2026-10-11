// The forwardable deployment brief: one page in English, one in Hindi.
// Tables and numbers always come from code. The prose comes from a bilingual
// template; if an AI writer is configured it may reword the prose, and any AI
// field containing a number that is not in the facts is replaced by the template.

import { val } from './risk.js';
import { eventLabelOf } from './dataset.js';
import { complete, parseJSON, roleConfig } from './llm.js';
import { verifyNumbers } from './grounding.js';

const FIELDS = ['summary', 'aeration', 'cleaning', 'testing', 'gaps', 'closing'];

const istDate = (d, locale) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d);

function daysUntil(dateStr, now) {
  const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now));
  return Math.round((Date.parse(dateStr) - today.getTime()) / 86_400_000);
}

const listEn = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const listHi = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} और ${xs[xs.length - 1]}`);

export function briefFacts(model, now = new Date()) {
  const byId = new Map(model.readings.map((r) => [r.id, r]));
  const o = model.overview;
  const ghat = (id) => model.ghats.find((g) => g.id === id);

  const gapShort = (g) => {
    const n = g.notes.find((x) => x.kind === 'no-table') || g.notes.find((x) => x.kind === 'site-uncertain') || g.notes.find((x) => x.kind === 'partial') || g.notes.find((x) => x.kind === 'core-gap');
    if (!n) return null;
    return {
      'no-table': { en: `No ${n.event?.replace('-', ' ').replace(/(\d+) (\w+)/, '$2 $1')} test`, hi: `${n.event?.endsWith('Durga') ? 'दुर्गा' : 'गणेश'} ${n.event?.slice(0, 4)} की जाँच नहीं` },
      'site-uncertain': { en: 'May be two places', hi: 'दो स्थान हो सकते हैं' },
      partial: { en: 'Partly sampled', hi: 'आंशिक नमूने' },
      'core-gap': { en: 'Some tests not sampled', hi: 'कुछ जाँचें छूटीं' },
    }[n.kind];
  };

  const pages = (g) => {
    const byYear = {};
    for (const t of model.tables.filter((x) => x.ghatId === g.id)) (byYear[t.year] ??= []).push(t.page);
    return Object.entries(byYear).map(([y, ps]) => ({ year: Number(y), pages: [...new Set(ps)].sort((a, b) => a - b) }));
  };

  // One short plain-words reason per ghat for the printed table.
  const shortReason = (g) => {
    const ev = g.tierWhy.evidence.map((id) => byId.get(id));
    if (g.tier === 'critical') {
      const w = ev.reduce((a, b) => (b.value < a.value ? b : a));
      return {
        en: `DO fell to ${val(w)} mg/l (${w.festival} ${w.year})`,
        hi: `DO ${val(w)} mg/l तक गिरी (${w.festival === 'Durga' ? 'दुर्गा' : 'गणेश'} ${w.year})`,
      };
    }
    if (g.tier === 'warning') {
      const keys = ['DO', 'BOD', 'pH'];
      const events = [...new Set(ev.map((r) => r.event))];
      const counts = keys.map((p) => {
        const tested = model.readings.filter((r) => r.ghatId === g.id && r.param === p && events.includes(r.event) && r.status !== 'missing');
        return { p, k: ev.filter((r) => r.param === p).length, n: tested.length };
      }).sort((a, b) => b.k - a.k);
      const top = counts[0];
      const years = [...new Set(ev.map((r) => r.year))].join('–');
      return {
        en: `${top.p} outside the bathing limit in ${top.k} of ${top.n} tests in ${years}`,
        hi: `${years} की ${top.n} में से ${top.k} जाँचों में ${top.p} स्नान मानक से बाहर`,
      };
    }
    return { en: g.tierWhy.en, hi: g.tierWhy.hi };
  };
  const failText = (g) => ['DO', 'BOD', 'pH'].map((p) => (g.scoreParts[p] ? `${p} ${g.scoreParts[p].failing}/${g.scoreParts[p].tested}` : `${p} –`)).join(' · ');

  const ranking = model.ghats.map((g) => ({
    rank: g.rank,
    short: shortReason(g),
    fails: failText(g),
    id: g.id,
    name: g.short,
    nameHi: g.hiShort,
    site: g.site,
    siteHi: g.hi,
    tier: g.tier,
    tierEn: model.tiers[g.tier].en,
    tierHi: model.tiers[g.tier].hi,
    score: g.score,
    reason: g.concerns[0] ? { en: g.concerns[0].en, hi: g.concerns[0].hi } : { en: g.positives[0]?.en ?? '', hi: g.positives[0]?.hi ?? '' },
    gap: gapShort(g),
    sources: pages(g),
  }));

  const deploy = {};
  for (const k of ['aeration', 'cleaning', 'testing']) {
    const pick = (level) => model.ghats.filter((g) => g.deploy[k].level === level).map((g) => {
      const ev = byId.get(g.deploy[k].evidence[0]);
      return {
        id: g.id, name: g.short, nameHi: g.hiShort, en: g.deploy[k].en, hi: g.deploy[k].hi,
        value: ev ? val(ev) : null, festival: ev?.festival ?? null, year: ev?.year ?? null,
        notes: g.notes.filter((n) => ['no-table', 'site-uncertain', 'partial'].includes(n.kind)).map((n) => ({ kind: n.kind, event: n.event ?? null })),
      };
    });
    deploy[k] = { priority: pick('priority'), standard: pick('standard'), rest: model.ghats.filter((g) => ['none', 'routine'].includes(g.deploy[k].level)).map((g) => ({ id: g.id, name: g.short, nameHi: g.hiShort })) };
  }

  const zeroGhats = [...new Set(o.DO.zeroIds.map((id) => byId.get(id).ghatId))];
  return {
    preparedEn: istDate(now, 'en-IN'),
    preparedHi: istDate(now, 'hi-IN'),
    visarjan: model.visarjan,
    daysLeft: daysUntil(model.visarjan.date, now),
    ghatCount: model.ghats.length,
    period: { span: model.period.span, recentSpan: model.period.recentSpan, latest: model.period.latest },
    headline: {
      doFailing: o.DO.failing, doTested: o.DO.tested,
      bodFailing: o.BOD.failing, bodTested: o.BOD.tested,
      zeroCount: o.DO.zeroIds.length,
      zeroGhats: zeroGhats.map((id) => ({ name: ghat(id).short, nameHi: ghat(id).hiShort })),
      critical: o.critical.map((id) => ({ name: ghat(id).short, nameHi: ghat(id).hiShort })),
      noTable: o.noTable.map((n) => ({ name: ghat(n.ghatId).short, nameHi: ghat(n.ghatId).hiShort, event: n.event })),
      passingLatest: o.passingLatest.length,
      uncertain: model.ghats.filter((g) => g.confidence !== 'high').map((g) => ({ name: g.short, nameHi: g.hiShort })),
    },
    ranking,
    deploy,
    reports: Object.values(model.reports).map((r) => ({ year: r.year, title: r.title, url: r.url, file: r.file })),
    identicalMetals: model.caveats.some((c) => c.kind === 'identical-metal'),
  };
}

export function templateNarrative(f) {
  const h = f.headline;
  const fest = (x, lang) => (lang === 'hi' ? (x.festival === 'Durga' ? 'दुर्गा' : 'गणेश') : x.festival);
  const aerItem = (x, lang) => (lang === 'hi' ? `${x.nameHi} (DO ${x.value} mg/l, ${fest(x, 'hi')} ${x.year})` : `${x.name} (DO ${x.value} mg/l, ${x.festival} ${x.year})`);
  const bodItem = (x, lang) => (lang === 'hi' ? `${x.nameHi} (BOD ${x.value} mg/l)` : `${x.name} (BOD ${x.value} mg/l)`);
  const names = (xs, lang) => (lang === 'hi' ? listHi(xs.map((x) => x.nameHi)) : listEn(xs.map((x) => x.name)));
  const A = f.deploy.aeration;
  const C = f.deploy.cleaning;
  const T = f.deploy.testing;
  const P = f.period;
  const has = (x, kind) => x.notes.filter((n) => n.kind === kind && (!n.event || n.event.startsWith(String(P.latest))));
  const testWhy = (x, lang) => {
    const bits = [];
    for (const n of has(x, 'no-table')) bits.push(lang === 'hi' ? `${eventLabelOf(n.event, 'hi')} की कोई जाँच दर्ज नहीं` : `no ${eventLabelOf(n.event)} test on record`);
    if (x.notes.some((n) => n.kind === 'site-uncertain')) bits.push(lang === 'hi' ? 'पुष्टि करें कि दो में से किस स्थान का नमूना लिया जाता है' : 'confirm which of two possible locations is sampled');
    if (!bits.length && has(x, 'partial').length) bits.push(lang === 'hi' ? `${P.latest} के कुछ नमूने छूटे` : `part of the ${P.latest} sampling missing`);
    return `${lang === 'hi' ? x.nameHi : x.name} (${bits.join(lang === 'hi' ? '; ' : '; ')})`;
  };

  const noTableBy = [...new Set(h.noTable.map((n) => n.event))].map((ev) => ({ ev, ghats: h.noTable.filter((n) => n.event === ev) }));

  const en = {
    summary: [
      `MPPCB tested the water at ${f.ghatCount} Bhopal immersion ghats before, during and one week after each Ganesh and Durga festival in ${P.span}.`,
      `Against the CPCB bathing standard (Class B), dissolved oxygen (DO) was below 5 mg/l in ${h.doFailing} of ${h.doTested} tests and BOD was above 3 mg/l in ${h.bodFailing} of ${h.bodTested}.`,
      h.passingLatest === 0 ? `No ghat met all three bathing limits in its ${P.latest} tests.` : '',
      h.critical.length ? `${h.critical.length} ghats are critical because DO fell below 3 mg/l in ${P.recentSpan}: ${names(h.critical, 'en')}.` : '',
      h.zeroCount ? `${names(h.zeroGhats, 'en')} recorded 0 mg/l DO in ${h.zeroCount} tests.` : '',
    ].filter(Boolean).join(' '),
    aeration: [
      A.priority.length ? `Send first to ${listEn(A.priority.map((x) => aerItem(x, 'en')))}.` : `No ghat shows severe oxygen loss in ${P.recentSpan}.`,
      A.standard.length ? `Keep on standby for ${names(A.standard, 'en')}.` : '',
    ].filter(Boolean).join(' '),
    cleaning: [
      C.priority.length ? `Priority: ${listEn(C.priority.map((x) => bodItem(x, 'en')))}.` : '',
      C.standard.length ? `Standard cleaning at ${names(C.standard, 'en')}.` : '',
    ].filter(Boolean).join(' '),
    testing: [
      T.priority.length ? `Priority: ${listEn(T.priority.map((x) => testWhy(x, 'en')))}.` : '',
      'Test before, during and one week after immersion at every ghat.',
    ].filter(Boolean).join(' '),
    gaps: [
      ...noTableBy.map((x) => `No ${eventLabelOf(x.ev)} readings exist for ${names(x.ghats, 'en')}: treat this as unknown, not clean.`),
      h.uncertain.length ? `${names(h.uncertain, 'en')} readings may come from two different places.` : '',
      'Total coliform is not measured, so bacterial safety for bathing cannot be judged.',
      f.identicalMetals ? 'Some metal values are identical at every ghat and may be reporting limits.' : '',
    ].filter(Boolean).join(' '),
    closing: `All figures are from the MPPCB Ganesh and Durga Visarjan reports ${P.span}; report pages are listed against each ghat. Readings are compared with CPCB limits only. No health effects are claimed.`,
  };

  const hi = {
    summary: [
      `म.प्र. प्रदूषण नियंत्रण बोर्ड (MPPCB) ने ${P.span} में हर गणेश और दुर्गा विसर्जन पर भोपाल के ${f.ghatCount} विसर्जन घाटों के पानी की जाँच विसर्जन से पहले, दौरान और एक सप्ताह बाद की.`,
      `CPCB स्नान मानक (श्रेणी B) की तुलना में ${h.doTested} में से ${h.doFailing} जाँचों में घुलित ऑक्सीजन (DO) 5 mg/l से कम और ${h.bodTested} में से ${h.bodFailing} जाँचों में BOD 3 mg/l से अधिक रहा.`,
      h.passingLatest === 0 ? `${P.latest} की जाँचों में कोई भी घाट तीनों स्नान मानकों पर खरा नहीं उतरा.` : '',
      h.critical.length ? `${h.critical.length} घाट गंभीर श्रेणी में हैं क्योंकि ${P.recentSpan} में DO 3 mg/l से नीचे गई: ${names(h.critical, 'hi')}.` : '',
      h.zeroCount ? `${names(h.zeroGhats, 'hi')} में ${h.zeroCount} जाँचों में DO 0 mg/l दर्ज हुई.` : '',
    ].filter(Boolean).join(' '),
    aeration: [
      A.priority.length ? `पहले यहाँ भेजें: ${listHi(A.priority.map((x) => aerItem(x, 'hi')))}.` : `${P.recentSpan} में किसी घाट पर ऑक्सीजन की गंभीर कमी नहीं दिखी.`,
      A.standard.length ? `स्टैंडबाय पर रखें: ${names(A.standard, 'hi')}.` : '',
    ].filter(Boolean).join(' '),
    cleaning: [
      C.priority.length ? `प्राथमिकता: ${listHi(C.priority.map((x) => bodItem(x, 'hi')))}.` : '',
      C.standard.length ? `सामान्य सफ़ाई: ${names(C.standard, 'hi')}.` : '',
    ].filter(Boolean).join(' '),
    testing: [
      T.priority.length ? `प्राथमिकता: ${listHi(T.priority.map((x) => testWhy(x, 'hi')))}.` : '',
      'हर घाट पर विसर्जन से पहले, दौरान और एक सप्ताह बाद जाँच करें.',
    ].filter(Boolean).join(' '),
    gaps: [
      ...noTableBy.map((x) => `${names(x.ghats, 'hi')} की ${eventLabelOf(x.ev, 'hi')} की कोई रीडिंग नहीं है: इसे अज्ञात मानें, साफ़ नहीं.`),
      h.uncertain.length ? `${names(h.uncertain, 'hi')} की रीडिंग दो अलग स्थानों की हो सकती हैं.` : '',
      'टोटल कोलीफ़ॉर्म की जाँच नहीं होती, इसलिए स्नान के लिए जीवाणु-सुरक्षा का आकलन संभव नहीं.',
      f.identicalMetals ? 'कुछ धातु मान हर घाट पर एक जैसे हैं और रिपोर्टिंग सीमा हो सकते हैं.' : '',
    ].filter(Boolean).join(' '),
    closing: `सभी आँकड़े MPPCB गणेश एवं दुर्गा विसर्जन रिपोर्ट ${P.span} से हैं; हर घाट के सामने रिपोर्ट के पृष्ठ दिए गए हैं. रीडिंग की तुलना केवल CPCB मानकों से की गई है. स्वास्थ्य प्रभावों का कोई दावा नहीं किया गया है.`,
  };
  return { en, hi };
}

const NARRATIVE_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(['en', 'hi'].map((lang) => [lang, {
    type: 'object',
    properties: Object.fromEntries(FIELDS.map((k) => [k, { type: 'string' }])),
    required: FIELDS,
    additionalProperties: false,
  }])),
  required: ['en', 'hi'],
  additionalProperties: false,
};

const WRITER_SYSTEM = `You write short official notes for the Bhopal Municipal Corporation (BMC).
The reader is a senior officer who has one minute. Write plain, formal sentences.
Use only the facts and the draft you are given. Keep every fact and number from the draft; add no new numbers.
Missing data is unknown, never clean. BDL means below detection limit: very low, not zero, not missing.
Report readings against CPCB limits only and do not claim health effects.
The Hindi must read as natural, formal Hindi used in Madhya Pradesh government notes, not a word-for-word translation. Keep DO, BOD, pH, mg/l, CPCB and MPPCB in Latin script.
Keep each field about as long as the draft field.`;

export async function buildBrief(model, { useAI = true, now = new Date() } = {}) {
  const facts = briefFacts(model, now);
  const template = templateNarrative(facts);
  const result = { generatedAt: now.toISOString(), facts, narrative: template, engine: { name: 'built-in', label: 'Built-in template (no AI)' } };

  const cfg = roleConfig('writer');
  if (!useAI || !cfg.enabled) return result;

  try {
    const factsText = JSON.stringify(facts);
    const draftText = JSON.stringify(template);
    const ai = await complete('writer', {
      system: WRITER_SYSTEM,
      user: `FACTS (computed in code):\n${factsText}\n\nDRAFT (improve the wording, keep every fact):\n${draftText}\n\nReturn the six fields (${FIELDS.join(', ')}) in English ("en") and Hindi ("hi").`,
      maxTokens: 4000,
      schema: NARRATIVE_SCHEMA,
    });
    const parsed = parseJSON(ai.text);
    const narrative = { en: {}, hi: {} };
    const replaced = [];
    for (const lang of ['en', 'hi']) {
      for (const k of FIELDS) {
        const text = typeof parsed?.[lang]?.[k] === 'string' ? parsed[lang][k].trim() : '';
        const check = text ? verifyNumbers(text, factsText, draftText) : { unmatched: ['(empty)'] };
        if (!text || check.unmatched.length) {
          narrative[lang][k] = template[lang][k];
          replaced.push({ field: `${lang}.${k}`, unmatched: check.unmatched });
        } else {
          narrative[lang][k] = text;
        }
      }
    }
    result.narrative = narrative;
    result.engine = { name: ai.provider, model: ai.model, ms: ai.ms, label: `${ai.provider} · ${ai.model}`, replaced };
  } catch (err) {
    result.aiError = err.message;
  }
  return result;
}
