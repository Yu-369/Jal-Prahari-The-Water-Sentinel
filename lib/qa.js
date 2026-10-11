// Built-in question answering: no AI, no network. Recognises the questions an
// officer is likely to ask, answers from the computed model, and cites every
// number with a [table-id] or [reading-id] token the UI turns into a page link.
// Answers in Hindi when the question is in Hindi.

import { PARAMS, PHASES, PHASE_LABEL, eventLabelOf } from './dataset.js';
import { CORE, val, when } from './risk.js';
import { extractEntities, isHindi } from './grounding.js';

const P = (text) => ({ type: 'p', text });
const LIST = (items) => ({ type: 'list', items });
const TABLE = (head, rows) => ({ type: 'table', head, rows });

const INTENTS = [
  ['zero', (q, e) => /\bzero\b|\b0\s*mg|no oxygen|शून्य|ज़ीरो|जीरो/.test(q) && (e.params.includes('DO') || /oxygen|ऑक्सीजन/.test(q) || /zero/.test(q))],
  ['missing', (q) => /missing|\bgaps?\b|not sampled|unavailable|blank|absent|\bno\b.*\b(data|table|test|reading)s?\b|without (data|test)|कमी|अनुपलब्ध|लापता|नमूना नहीं|डेटा नहीं|आँकड़े नहीं|आंकड़े नहीं/.test(q)],
  ['bdl', (q) => /\bbdl\b|below detection|detection limit|not detected|पहचान सीमा/.test(q)],
  ['site', (q, e) => /confidence|two (places|sites|locations)|same (place|site)|identity|which location|दो स्थान|दो जगह/.test(q) || (e.ghats.includes('kamlapati') && /where|location|kamla park|कहाँ/.test(q) && !e.params.length)],
  ['deploy', (q) => /aerat|aerator|\bclean|crew|testing unit|test(ing)? (team|unit|van)|deploy|where (should|do) (i|we) send|send (the|first|our)|allocate|resources?|वातन|एरेशन|सफ़ाई|सफाई|परीक्षण इकाई|तैनात|भेज/.test(q)],
  ['compare', (q, e) => /compare|\bvs\.?\b|versus|difference between|तुलना|बनाम/.test(q) || e.ghats.length >= 2 || (e.ghats.length === 1 && e.years.length >= 2)],
  ['trend', (q) => /trend|over (the )?years|improv|worse|getting|changed?|history|year on year|रुझान|सुधार|बिगड़|पिछले (तीन|3) साल/.test(q)],
  ['best', (q) => /safest|\bbest\b|cleanest|least (risk|polluted)|lowest risk|\bsafe\b|सबसे (साफ़|साफ|सुरक्षित|अच्छा)|सुरक्षित/.test(q)],
  ['worst', (q) => /worst|most (risk|at risk|polluted|dangerous|critical)|highest risk|riskiest|rank|priorit|\btop\b|critical|danger|which ghats? (needs?|should)|सबसे (ख़तरनाक|खतरनाक|प्रदूषित|गंदा|ज़्यादा|ज्यादा|अधिक)|जोखिम|रैंक|प्राथमिकता|गंभीर/.test(q)],
  ['metals', (q, e) => e.params.some((p) => PARAMS.find((x) => x.key === p).metal)],
  ['violations', (q) => /violat|exceed|above|below|limit|\bfail|breach|how many|how often|count|standard|उल्लंघन|सीमा|मानक|कितनी बार|कितने बार|कितनी जाँच|ऊपर|नीचे/.test(q)],
  ['ghat', (q, e) => e.ghats.length > 0],
  ['param', (q, e) => e.params.length > 0],
];

export function answerBuiltIn(question, model, { ghatId } = {}) {
  const lang = isHindi(question) ? 'hi' : 'en';
  const q = question.toLowerCase().trim();
  const ent = extractEntities(question);
  if (!ent.ghats.length && ghatId && /this ghat|this site|here|इस घाट|यहाँ/.test(q)) ent.ghats.push(ghatId);

  const ctx = makeContext(model, lang, ent, q);
  if (!q) return finish(ctx, 'help', help(ctx));
  for (const [name, test] of INTENTS) {
    if (test(q, ent)) {
      // A ghat + parameter question ("Bairagarh DO in 2024") is about readings, not the ghat summary.
      if (name === 'ghat' && ent.params.length) return finish(ctx, 'param', HANDLERS.param(ctx));
      return finish(ctx, name, HANDLERS[name](ctx));
    }
  }
  return finish(ctx, 'help', help(ctx));
}

function finish(ctx, intent, blocks) {
  return { engine: 'built-in', intent, lang: ctx.lang, blocks, entities: ctx.ent, followUps: followUps(ctx, intent) };
}

function makeContext(model, lang, ent, q) {
  const byId = new Map(model.readings.map((r) => [r.id, r]));
  const ghat = (id) => model.ghats.find((g) => g.id === id);
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  const name = (g) => (lang === 'hi' ? g.hiShort : g.short);
  const tier = (g) => model.tiers[g.tier][lang];
  const eventLabel = (key) => eventLabelOf(key, lang);
  const param = (key) => PARAMS.find((p) => p.key === key);
  const pLabel = (key) => (lang === 'hi' ? param(key).hi : param(key).label);

  // Cite up to 3 readings individually; otherwise one token per source table.
  const cite = (ids, max = 6) => {
    const rs = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!rs.length) return '';
    if (rs.length <= 3) return rs.map((r) => `[${r.id}]`).join(' ');
    const tables = [...new Set(rs.map((r) => r.table))];
    tables.sort((a, b) => model.tables.findIndex((t) => t.id === a) - model.tables.findIndex((t) => t.id === b));
    const shown = tables.slice(0, max).map((t) => `[${t}]`).join(' ');
    return tables.length > max ? `${shown} …` : shown;
  };

  const filtered = (rs) => rs.filter((r) =>
    (!ent.ghats.length || ent.ghats.includes(r.ghatId)) &&
    (!ent.years.length || ent.years.includes(r.year)) &&
    (!ent.festivals.length || ent.festivals.includes(r.festival)) &&
    (!ent.phases.length || ent.phases.includes(r.phase)));

  const scope = () => {
    const bits = [];
    if (ent.years.length) bits.push(ent.years.join(', '));
    if (ent.festivals.length) bits.push(ent.festivals.map((f) => (lang === 'hi' ? (f === 'Ganesh' ? 'गणेश' : 'दुर्गा') : f)).join(', '));
    if (ent.phases.length) bits.push(ent.phases.map((p) => PHASE_LABEL[p][lang]).join(', '));
    return bits.length ? ` (${bits.join('; ')})` : '';
  };

  return { model, lang, ent, q, byId, ghat, L, name, tier, eventLabel, param, pLabel, cite, filtered, scope, when: (r) => when(r, lang) };
}

// ---------- handlers ----------

const HANDLERS = {
  zero(c) {
    const { model, L, name, cite } = c;
    const rs = c.filtered(model.readings.filter((r) => r.param === 'DO' && r.status === 'measured' && r.value === 0));
    if (!rs.length) {
      const all = c.filtered(model.readings.filter((r) => r.param === 'DO' && r.status === 'measured'));
      if (!all.length) return [P(L('No dissolved-oxygen test matches that question.', 'इस प्रश्न से मेल खाती कोई ऑक्सीजन जाँच नहीं है.'))];
      const low = all.reduce((a, b) => (b.value < a.value ? b : a));
      return [P(L(
        `No test${c.scope()} recorded 0 mg/l dissolved oxygen. The lowest was ${val(low)} mg/l at ${name(c.ghat(low.ghatId))} (${c.when(low)}) [${low.id}].`,
        `किसी भी जाँच${c.scope()} में घुलित ऑक्सीजन 0 mg/l दर्ज नहीं हुई. सबसे कम ${val(low)} mg/l, ${name(c.ghat(low.ghatId))} (${c.when(low)}) [${low.id}].`,
      ))];
    }
    const ghats = [...new Set(rs.map((r) => r.ghatId))];
    const where = ghats.length === 1 ? L(`, all at ${c.ghat(ghats[0]).site}`, `, सभी ${c.ghat(ghats[0]).hi} में`) : '';
    const d = model.context.classD_DO;
    return [
      P(L(
        `${rs.length} test${rs.length === 1 ? '' : 's'} recorded dissolved oxygen of 0 mg/l${where}. The bathing limit (CPCB Class B) is at least ${model.rules.DO.limit} mg/l; even the fisheries limit (Class D) asks for ${d.limit} mg/l.`,
        `${rs.length} जाँचों में घुलित ऑक्सीजन 0 mg/l दर्ज हुई${where}. स्नान मानक (CPCB श्रेणी B) कम से कम ${model.rules.DO.limit} mg/l है; मत्स्य मानक (श्रेणी D) भी ${d.limit} mg/l माँगता है.`,
      )),
      LIST(rs.map((r) => `${name(c.ghat(r.ghatId))}: ${c.when(r)} ${cite([r.id])}`)),
    ];
  },

  missing(c) {
    const { model, L, name } = c;
    const o = model.overview;
    const gs = model.ghats.filter((g) => !c.ent.ghats.length || c.ent.ghats.includes(g.id));
    const blocks = [];
    if (!c.ent.ghats.length) {
      const nt = o.noTable.map((n) => `${name(c.ghat(n.ghatId))} ${c.eventLabel(n.event)}`).join(', ');
      blocks.push(P(L(
        `${o.missing} of ${o.readings} readings were not sampled, and ${o.noTable.length} festival tables are missing from the reports entirely (${nt}). Missing means unknown. It is never counted as clean. (BDL is different: ${o.bdl} readings were tested and found too low to measure.)`,
        `${o.readings} में से ${o.missing} रीडिंग का नमूना नहीं लिया गया, और ${o.noTable.length} त्योहार तालिकाएँ रिपोर्टों में हैं ही नहीं (${nt}). अनुपलब्ध का अर्थ अज्ञात है; इसे कभी साफ़ नहीं माना जाता. (BDL अलग है: ${o.bdl} रीडिंग की जाँच हुई और मात्रा मापने लायक नहीं थी.)`,
      )));
    }
    const items = [];
    for (const g of gs) for (const n of g.notes) items.push(`${name(g)}: ${n[c.lang]} ${c.cite(n.evidence, 3)}`.trim());
    if (items.length) blocks.push(LIST(items));
    else blocks.push(P(L(`No gaps for ${gs.map(name).join(', ')}: every expected test is present.`, `${gs.map(name).join(', ')} के लिए कोई कमी नहीं: सभी अपेक्षित जाँचें मौजूद हैं.`)));
    return blocks;
  },

  bdl(c) {
    const { model, L } = c;
    const rs = c.filtered(model.readings.filter((r) => r.status === 'bdl' && (!c.ent.params.length || c.ent.params.includes(r.param))));
    const counts = PARAMS.map((p) => [p, rs.filter((r) => r.param === p.key).length]).filter(([, n]) => n);
    const coreBdl = rs.filter((r) => CORE.includes(r.param)).length;
    return [
      P(L(
        'BDL means "below detection limit": the lab tested the water and the amount was too small to measure. It is very low, not zero and not missing. Jal Prahari never treats BDL as zero or as a missing test.',
        'BDL का अर्थ है "पहचान सीमा से कम": प्रयोगशाला ने पानी की जाँच की और मात्रा मापने लायक नहीं थी. यह बहुत कम है, शून्य या अनुपलब्ध नहीं. जल प्रहरी BDL को कभी शून्य या छूटी जाँच नहीं मानता.',
      )),
      P(L(
        `${rs.length} readings${c.scope()} are BDL: ${counts.map(([p, n]) => `${p.name.toLowerCase()} ${n}`).join(', ') || 'none'}. ${coreBdl ? '' : 'None of them is a DO, BOD or pH reading, so BDL does not change the ranking.'}`,
        `${rs.length} रीडिंग${c.scope()} BDL हैं: ${counts.map(([p, n]) => `${p.hi} ${n}`).join(', ') || 'कोई नहीं'}. ${coreBdl ? '' : 'इनमें कोई DO, BOD या pH रीडिंग नहीं है, इसलिए BDL रैंकिंग नहीं बदलता.'}`,
      )),
    ];
  },

  site(c) {
    const { model, L, name } = c;
    const uncertain = model.ghats.filter((g) => g.notes.some((n) => n.kind === 'site-uncertain'));
    return [
      ...uncertain.map((g) => {
        const note = g.notes.find((n) => n.kind === 'site-uncertain');
        return P(`${name(g)}: ${note[c.lang]} ${c.cite(note.evidence)} ${L(`Suggested: ${g.deploy.testing.en}`, `सुझाव: ${g.deploy.testing.hi}`)}`);
      }),
      P(L('All other ghats are matched with high confidence.', 'बाकी सभी घाटों का मिलान उच्च विश्वास के साथ है.')),
    ];
  },

  deploy(c) {
    const { model, L, name, q } = c;
    let kinds = [];
    if (/aerat|aerator|oxygen|वातन|एरेशन|ऑक्सीजन/.test(q)) kinds.push('aeration');
    if (/clean|crew|सफ़ाई|सफाई/.test(q)) kinds.push('cleaning');
    if (/test|परीक्षण|जाँच/.test(q)) kinds.push('testing');
    if (!kinds.length) kinds = ['aeration', 'cleaning', 'testing'];
    const blocks = [];
    if (kinds.length === 3) {
      blocks.push(P(L('Suggested deployment before visarjan, computed from the readings:', 'विसर्जन से पहले सुझाई गई तैनाती, रीडिंग के आधार पर:')));
    }
    for (const k of kinds) {
      const items = [];
      for (const level of ['priority', 'standard']) {
        for (const g of model.ghats.filter((x) => x.deploy[k].level === level)) {
          items.push(`${name(g)} (${model.levels[level][c.lang]}): ${g.deploy[k][c.lang]} ${c.cite(g.deploy[k].evidence)}`.trim());
        }
      }
      const none = model.ghats.filter((g) => ['none', 'routine'].includes(g.deploy[k].level));
      if (none.length) items.push(L(`${k === 'testing' ? 'Routine testing' : 'Not indicated by the data'}: ${none.map(name).join(', ')}`, `${k === 'testing' ? 'नियमित जाँच' : 'आँकड़ों से आवश्यक नहीं दिखता'}: ${none.map(name).join(', ')}`));
      blocks.push(P(`${model.actions[k][c.lang]}:`));
      blocks.push(LIST(items));
    }
    return blocks;
  },

  compare(c) {
    const { model, L, name, ent } = c;
    if (ent.ghats.length === 1) {
      const g = c.ghat(ent.ghats[0]);
      const tables = model.tables.filter((t) => t.ghatId === g.id && (!ent.years.length || ent.years.includes(t.year)) && (!ent.festivals.length || ent.festivals.includes(t.festival)));
      const fmt = (t, p) => PHASES.map((ph) => { const r = model.readings.find((x) => x.table === t.id && x.param === p && x.phase === ph); return r ? val(r).replace('not sampled', 'n/s') : '–'; }).join(' / ');
      const missing = model.events.filter((e) => (!ent.years.length || ent.years.includes(e.year)) && (!ent.festivals.length || ent.festivals.includes(e.festival)) && !tables.some((t) => t.event === e.key));
      const blocks = [
        P(L(`${g.site}: readings before / during / after immersion${c.scope()}.`, `${g.hi}: विसर्जन से पहले / दौरान / बाद की रीडिंग${c.scope()}.`)),
        TABLE([L('Festival', 'त्योहार'), 'DO (mg/l)', 'BOD (mg/l)', 'pH', L('Source', 'स्रोत')], tables.map((t) => [c.eventLabel(t.event), fmt(t, 'DO'), fmt(t, 'BOD'), fmt(t, 'pH'), `[${t.id}]`])),
      ];
      if (missing.length) blocks.push(P(L(`No table in the reports for ${missing.map((e) => e.label).join(', ')}: unknown, not clean.`, `${missing.map((e) => e.hi).join(', ')} की कोई तालिका रिपोर्ट में नहीं: अज्ञात, साफ़ नहीं.`)));
      return blocks;
    }
    const gs = ent.ghats.length >= 2 ? model.ghats.filter((g) => ent.ghats.includes(g.id)) : model.ghats;
    const rows = gs.map((g) => {
      const rs = model.readings.filter((r) => r.ghatId === g.id && r.status === 'measured');
      const DO = rs.filter((r) => r.param === 'DO');
      const BOD = rs.filter((r) => r.param === 'BOD');
      const lo = DO.reduce((a, b) => (b.value < a.value ? b : a));
      const hi = BOD.reduce((a, b) => (b.value > a.value ? b : a));
      return [
        `#${g.rank} ${name(g)}`,
        c.tier(g),
        String(g.score),
        `${g.scoreParts.DO.failing} / ${g.scoreParts.DO.tested}`,
        `${g.scoreParts.BOD.failing} / ${g.scoreParts.BOD.tested}`,
        `${val(lo)} [${lo.id}]`,
        `${val(hi)} [${hi.id}]`,
      ];
    });
    return [
      P(L(`Side by side, ${model.period.span} (tests failing / tests done):`, `तुलना, ${model.period.span} (विफल जाँचें / कुल जाँचें):`)),
      TABLE([L('Ghat', 'घाट'), L('Risk', 'जोखिम'), L('Score', 'अंक'), L('DO < 5', 'DO < 5'), L('BOD > 3', 'BOD > 3'), L('Lowest DO', 'न्यूनतम DO'), L('Highest BOD', 'अधिकतम BOD')], rows),
    ];
  },

  trend(c) {
    const { model, L, name, ent } = c;
    const gs = model.ghats.filter((g) => !ent.ghats.length || ent.ghats.includes(g.id));
    const params = ent.params.filter((p) => CORE.includes(p));
    const ps = params.length ? params : ['DO', 'BOD'];
    const fs = ent.festivals.length ? ent.festivals : ['Durga'];
    const items = [];
    for (const g of gs) {
      for (const p of ps) {
        for (const f of fs) {
          const t = g.trends[p][f];
          const ids = t.points.filter((x) => x.id).map((x) => x.id);
          items.push(`${name(g)}: ${t[c.lang]} ${c.cite(ids)}`);
        }
      }
    }
    const blocks = [P(L(
      `Worst reading per year${fs.length === 1 && !ent.festivals.length ? ' at Durga (the next event)' : ''}. "Still outside the limit" means the number moved but never met the bathing standard.`,
      `हर वर्ष की सबसे खराब रीडिंग${fs.length === 1 && !ent.festivals.length ? ', दुर्गा (अगला आयोजन)' : ''}. "अब भी मानक से बाहर" का अर्थ है कि संख्या बदली पर स्नान मानक कभी पूरा नहीं हुआ.`,
    )), LIST(items)];
    if (ent.params.some((p) => !CORE.includes(p))) blocks.push(P(L('Trends are shown for DO, BOD and pH only, the parameters with a bathing limit.', 'रुझान केवल DO, BOD और pH के लिए दिखाए गए हैं, जिनकी स्नान सीमा है.')));
    return blocks;
  },

  best(c) {
    const { model, L, name } = c;
    const o = model.overview;
    const last = model.ghats[model.ghats.length - 1];
    if (o.passingLatest.length) {
      return [P(L(`Met all three bathing limits in every ${model.period.latest} test: ${o.passingLatest.map((id) => name(c.ghat(id))).join(', ')}.`, `${model.period.latest} की हर जाँच में तीनों स्नान मानक पूरे: ${o.passingLatest.map((id) => name(c.ghat(id))).join(', ')}.`))];
    }
    return [
      P(L(
        `No ghat met all three bathing limits in its ${model.period.latest} tests, so none can be called safe. The lowest risk is ${name(last)} (#${last.rank}, ${c.tier(last)}, score ${last.score}), but:`,
        `${model.period.latest} की जाँचों में कोई भी घाट तीनों स्नान मानकों पर खरा नहीं उतरा, इसलिए किसी को सुरक्षित नहीं कहा जा सकता. सबसे कम जोखिम ${name(last)} (#${last.rank}, ${c.tier(last)}, अंक ${last.score}) का है, फिर भी:`,
      )),
      LIST(last.concerns.map((x) => `${x[c.lang]} ${c.cite(x.evidence)}`)),
    ];
  },

  worst(c) {
    const { model, L, name, q } = c;
    const all = /rank|list|all|every|सभी|रैंकिंग|सूची/.test(q);
    const gs = all ? model.ghats : model.ghats.slice(0, 3);
    const items = gs.map((g) => {
      const top = g.concerns[0];
      const gap = g.notes.find((n) => n.kind === 'no-table' || n.kind === 'site-uncertain');
      const gapText = gap ? L(` Data gap: ${gap.kind === 'no-table' ? `no ${c.eventLabel(gap.event)} test.` : 'site may be two places.'}`, ` आँकड़ों की कमी: ${gap.kind === 'no-table' ? `${c.eventLabel(gap.event)} की जाँच नहीं.` : 'स्थान दो जगहें हो सकती हैं.'}`) : '';
      return `#${g.rank} ${name(g)}: ${c.tier(g)}, ${L('score', 'अंक')} ${g.score}. ${top ? `${top[c.lang]} ${c.cite(top.evidence)}` : ''}${gapText}`;
    });
    return [
      P(L(
        `${all ? 'All ghats' : 'Highest-risk ghats'}, ranked against the CPCB bathing limits (${model.period.span} tests, recent and Durga tests weigh more):`,
        `${all ? 'सभी घाट' : 'सबसे अधिक जोखिम वाले घाट'}, CPCB स्नान मानकों के आधार पर (${model.period.span} की जाँचें; हाल की और दुर्गा जाँचों को अधिक भार):`,
      )),
      LIST(items),
    ];
  },

  metals(c) {
    const { model, L, name, ent } = c;
    const metals = ent.params.filter((p) => c.param(p).metal);
    const items = metals.map((key) => {
      const rs = c.filtered(model.readings.filter((r) => r.param === key));
      const nums = rs.filter((r) => r.status === 'measured');
      const bdl = rs.filter((r) => r.status === 'bdl').length;
      const miss = rs.filter((r) => r.status === 'missing').length;
      if (!nums.length) return L(`${c.param(key).label}: no number printed${c.scope()} (${bdl} BDL, ${miss} not sampled).`, `${c.param(key).hi}: कोई अंक नहीं${c.scope()} (${bdl} BDL, ${miss} नमूना नहीं).`);
      const top = nums.reduce((a, b) => (b.value > a.value ? b : a));
      return L(
        `${c.param(key).label}: highest ${val(top)} mg/l at ${name(c.ghat(top.ghatId))} (${c.when(top)}) [${top.id}]. Of ${rs.length} tests: ${nums.length} with a number, ${bdl} BDL, ${miss} not sampled.`,
        `${c.param(key).hi}: सर्वाधिक ${val(top)} mg/l, ${name(c.ghat(top.ghatId))} (${c.when(top)}) [${top.id}]. ${rs.length} जाँचों में: ${nums.length} में अंक, ${bdl} BDL, ${miss} नमूना नहीं.`,
      );
    });
    const notes = model.caveats.filter((x) => x.kind === 'identical-metal' || x.kind === 'all-bdl').map((x) => x[c.lang]);
    return [
      P(L(`Heavy metals${c.scope()}. CPCB Class B sets no metal limits, so these are for information and do not affect the ranking.`, `भारी धातुएँ${c.scope()}. CPCB श्रेणी B में धातुओं की कोई सीमा नहीं, इसलिए ये केवल जानकारी हैं और रैंकिंग पर असर नहीं डालतीं.`)),
      LIST(items),
      ...(notes.length ? [P(L('Cautions:', 'सावधानियाँ:')), LIST(notes)] : []),
    ];
  },

  violations(c) {
    const { model, L, name, ent } = c;
    const asked = ent.params.length ? ent.params : CORE;
    const params = asked.filter((p) => CORE.includes(p));
    const blocks = [];
    const nolimit = asked.filter((p) => !CORE.includes(p));
    if (nolimit.length) blocks.push(P(L(`${nolimit.map((p) => c.param(p).label).join(', ')} ha${nolimit.length === 1 ? 's' : 've'} no CPCB Class B limit, so there is nothing to violate. Values are shown for information.`, `${nolimit.map((p) => c.param(p).hi).join(', ')} की CPCB श्रेणी B में कोई सीमा नहीं, इसलिए उल्लंघन का प्रश्न नहीं. मान केवल जानकारी के लिए हैं.`)));
    if (!params.length) return blocks;
    const items = params.map((p) => {
      const rs = c.filtered(model.readings.filter((r) => r.param === p && r.status !== 'missing'));
      const bad = rs.filter((r) => r.check.result === 'fail');
      const miss = c.filtered(model.readings.filter((r) => r.param === p && r.status === 'missing')).length;
      const rule = model.rules[p];
      return L(
        `${c.param(p).label} (limit ${rule.text}): ${bad.length} of ${rs.length} tests broke the limit${miss ? `; ${miss} not sampled` : ''}. ${c.cite(bad.map((r) => r.id))}`,
        `${c.param(p).hi} (मानक ${rule.text}): ${rs.length} में से ${bad.length} जाँचों में उल्लंघन${miss ? `; ${miss} का नमूना नहीं` : ''}. ${c.cite(bad.map((r) => r.id))}`,
      );
    });
    blocks.unshift(P(L(`Tests outside the CPCB bathing limits${c.scope()}${ent.ghats.length ? ` at ${ent.ghats.map((id) => name(c.ghat(id))).join(', ')}` : ', all ghats'}:`, `CPCB स्नान मानक से बाहर जाँचें${c.scope()}${ent.ghats.length ? `, ${ent.ghats.map((id) => name(c.ghat(id))).join(', ')}` : ', सभी घाट'}:`)));
    blocks.push(LIST(items));
    if (!ent.ghats.length) {
      const rows = model.ghats.map((g) => [
        `#${g.rank} ${name(g)}`,
        ...params.map((p) => {
          const rs = c.filtered(model.readings.filter((r) => r.ghatId === g.id && r.param === p && r.status !== 'missing'));
          return `${rs.filter((r) => r.check.result === 'fail').length} / ${rs.length}`;
        }),
      ]);
      blocks.push(TABLE([L('Ghat', 'घाट'), ...params.map((p) => `${p} ${L('fails', 'विफल')}`)], rows));
    }
    return blocks;
  },

  ghat(c) {
    const { model, L } = c;
    const g = c.ghat(c.ent.ghats[0]);
    const blocks = [
      P(`${L(`#${g.rank} of ${model.ghats.length}`, `${model.ghats.length} में #${g.rank}`)}: ${g.site}${c.lang === 'hi' ? ` (${g.hi})` : ''}. ${c.tier(g)}. ${g.tierWhy[c.lang]} ${c.cite(g.tierWhy.evidence)}`),
      LIST([...g.concerns, ...g.positives].map((x) => `${x[c.lang]} ${c.cite(x.evidence)}`)),
    ];
    if (g.notes.length) {
      blocks.push(P(L('Data gaps:', 'आँकड़ों की कमी:')));
      blocks.push(LIST(g.notes.map((n) => n[c.lang])));
    }
    const d = g.deploy;
    blocks.push(P(L(
      `Suggested: aeration ${model.levels[d.aeration.level].en.toLowerCase()}, cleaning crew ${model.levels[d.cleaning.level].en.toLowerCase()}, testing unit ${model.levels[d.testing.level].en.toLowerCase()}.`,
      `सुझाव: वातन ${model.levels[d.aeration.level].hi}, सफ़ाई दल ${model.levels[d.cleaning.level].hi}, जल परीक्षण इकाई ${model.levels[d.testing.level].hi}.`,
    )));
    return blocks;
  },

  param(c) {
    const { model, L, name, ent } = c;
    const key = ent.params[0];
    const p = c.param(key);
    const rule = model.rules[key];
    const gs = model.ghats.filter((g) => !ent.ghats.length || ent.ghats.includes(g.id));
    const blocks = [];
    if (!rule) blocks.push(P(L(`${p.label} has no CPCB Class B limit: shown for information only.`, `${p.hi} की CPCB श्रेणी B में कोई सीमा नहीं: केवल जानकारी के लिए.`)));
    if (gs.length === 1) {
      const g = gs[0];
      const tables = model.tables.filter((t) => t.ghatId === g.id && (!ent.years.length || ent.years.includes(t.year)) && (!ent.festivals.length || ent.festivals.includes(t.festival)));
      const fmt = (t) => PHASES.filter((ph) => !ent.phases.length || ent.phases.includes(ph)).map((ph) => {
        const r = model.readings.find((x) => x.table === t.id && x.param === key && x.phase === ph);
        return `${PHASE_LABEL[ph][c.lang]} ${r ? (r.status === 'missing' ? L('not sampled', 'नमूना नहीं') : val(r)) : '–'}`;
      }).join(', ');
      blocks.unshift(P(L(`${p.label} at ${g.site}${p.unit ? ` (${p.unit})` : ''}${rule ? `, bathing limit ${rule.text}` : ''}${c.scope()}:`, `${g.hi} पर ${p.hi}${p.unit ? ` (${p.unit})` : ''}${rule ? `, स्नान मानक ${rule.text}` : ''}${c.scope()}:`)));
      blocks.push(LIST(tables.map((t) => `${c.eventLabel(t.event)}: ${fmt(t)} [${t.id}]`)));
      const noTable = model.overview.noTable.filter((n) => n.ghatId === g.id && (!ent.years.length || ent.years.includes(Number(n.event.slice(0, 4)))));
      if (noTable.length) blocks.push(P(L(`No table for ${noTable.map((n) => c.eventLabel(n.event)).join(', ')}: unknown, not clean.`, `${noTable.map((n) => c.eventLabel(n.event)).join(', ')} की तालिका नहीं: अज्ञात, साफ़ नहीं.`)));
      return blocks;
    }
    const lowIsBad = key === 'DO';
    const items = gs.map((g) => {
      const rs = c.filtered(model.readings.filter((r) => r.ghatId === g.id && r.param === key));
      const nums = rs.filter((r) => r.status === 'measured');
      if (!nums.length) return `${name(g)}: ${L('no number printed', 'कोई अंक नहीं')}`;
      const w = nums.reduce((a, b) => ((lowIsBad ? b.value < a.value : b.value > a.value) ? b : a));
      const bad = rs.filter((r) => r.check.result === 'fail').length;
      const tested = rs.filter((r) => r.status !== 'missing').length;
      return `${name(g)}: ${lowIsBad ? L('lowest', 'न्यूनतम') : L('highest', 'अधिकतम')} ${val(w)}${p.unit ? ` ${p.unit}` : ''} (${c.when(w)}) [${w.id}]${rule ? L(`; ${bad} of ${tested} tests outside the limit`, `; ${tested} में से ${bad} जाँचें मानक से बाहर`) : ''}`;
    });
    blocks.unshift(P(L(`${p.label}${p.unit ? ` (${p.unit})` : ''} by ghat${rule ? `, bathing limit ${rule.text}` : ''}${c.scope()}:`, `घाटवार ${p.hi}${p.unit ? ` (${p.unit})` : ''}${rule ? `, स्नान मानक ${rule.text}` : ''}${c.scope()}:`)));
    blocks.push(LIST(items));
    return blocks;
  },
};

function help(c) {
  const { model, L } = c;
  const o = model.overview;
  return [
    P(L(
      `Across ${model.ghats.length} Bhopal ghats (MPPCB tests, ${model.period.span}): dissolved oxygen was below 5 mg/l in ${o.DO.failing} of ${o.DO.tested} tests, and BOD was above 3 mg/l in ${o.BOD.failing} of ${o.BOD.tested}. ${o.critical.length} ghats are critical.`,
      `भोपाल के ${model.ghats.length} घाटों पर (MPPCB जाँच, ${model.period.span}): ${o.DO.tested} में से ${o.DO.failing} जाँचों में घुलित ऑक्सीजन 5 mg/l से कम, और ${o.BOD.tested} में से ${o.BOD.failing} में BOD 3 mg/l से अधिक रहा. ${o.critical.length} घाट गंभीर श्रेणी में हैं.`,
    )),
    P(L('I can answer questions about rankings, a ghat, a parameter, limits broken, trends, missing data, BDL, metals and where to send aeration, cleaning or testing.', 'मैं रैंकिंग, किसी घाट, किसी मानक, उल्लंघन, रुझान, छूटे आँकड़े, BDL, धातुएँ, और वातन, सफ़ाई या जाँच कहाँ भेजें, इन पर उत्तर दे सकता हूँ.')),
  ];
}

function followUps(c, intent) {
  const en = {
    worst: ['Where should aeration go first?', 'Which ghats have missing data?'],
    best: ['Rank all ghats', 'Is Prempura getting worse?'],
    deploy: ['Rank all ghats', 'Which ghats have missing data?'],
    missing: ['What does BDL mean?', 'Where should testing units go?'],
    zero: ['Is Bairagarh getting worse?', 'Where should aeration go first?'],
    compare: ['Is Shahpura getting worse?', 'Rank all ghats'],
    trend: ['Compare all ghats', 'Where should aeration go first?'],
    help: ['Which ghat is most at risk?', 'Where is data missing?'],
  };
  const hi = {
    worst: ['वातन पहले कहाँ भेजें?', 'किन घाटों के आँकड़े अधूरे हैं?'],
    best: ['सभी घाटों की रैंकिंग', 'प्रेमपुरा का रुझान क्या है?'],
    deploy: ['सभी घाटों की रैंकिंग', 'किन घाटों के आँकड़े अधूरे हैं?'],
    missing: ['BDL का क्या अर्थ है?', 'जल परीक्षण इकाई कहाँ भेजें?'],
    zero: ['बैरागढ़ का रुझान क्या है?', 'वातन पहले कहाँ भेजें?'],
    compare: ['शाहपुरा का रुझान क्या है?', 'सभी घाटों की रैंकिंग'],
    trend: ['सभी घाटों की तुलना', 'वातन पहले कहाँ भेजें?'],
    help: ['सबसे ख़तरनाक घाट कौन सा है?', 'किन घाटों के आँकड़े अधूरे हैं?'],
  };
  const set = c.lang === 'hi' ? hi : en;
  return set[intent] ?? set.help;
}
