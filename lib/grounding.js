// Finds what a question is about, builds the fact sheet an AI model is allowed to
// use, and checks every number in an AI answer against that fact sheet.

import { GHATS, PARAMS, PHASES } from './dataset.js';
import { CORE } from './risk.js';

export function isHindi(text) {
  return /[ऀ-ॿ]/.test(text);
}

export function extractEntities(question) {
  const raw = ` ${question} `;
  const q = raw.toLowerCase();
  const ghats = GHATS.filter((g) => g.aliases.some((a) => q.includes(a))).map((g) => g.id);

  const params = [];
  for (const p of PARAMS) {
    const hit = p.aliases.some((a) => {
      if (a === ' do ') return /\bDO\b/.test(raw); // uppercase only: "what do I…" is not oxygen
      if (/^[a-z.]+$/.test(a) && a.length <= 4) return new RegExp(`\\b${a.replace('.', '\\.')}\\b`).test(q);
      return q.includes(a);
    });
    if (hit) params.push(p.key);
  }
  if (/metal|heavy|धातु/.test(q)) for (const p of PARAMS.filter((x) => x.metal)) if (!params.includes(p.key)) params.push(p.key);
  // "dissolved solids" must not also count as dissolved oxygen
  if (params.includes('DO') && /dissolved solid/.test(q) && !/oxygen|\bDO\b/.test(raw)) params.splice(params.indexOf('DO'), 1);

  const years = [...new Set((q.match(/\b20(23|24|25)\b/g) || []).map(Number))];
  const festivals = [];
  if (/ganesh|ganpati|गणेश|गणपति/.test(q)) festivals.push('Ganesh');
  if (/durga|navratri|दुर्गा|नवरात्र/.test(q)) festivals.push('Durga');
  const phases = [];
  if (/\b(pre|before)\b|पहले|पूर्व/.test(q)) phases.push('pre');
  if (/\bduring\b|दौरान/.test(q)) phases.push('during');
  if (/\b(after|post)\b|बाद/.test(q)) phases.push('after');
  return { ghats, params, years, festivals, phases };
}

// ---------- fact sheets for an AI model ----------

const cell = (r) => (!r ? '-' : r.status === 'measured' ? r.printed : r.status === 'bdl' ? 'BDL' : 'n/s');

function tableLine(model, t, params) {
  const g = model.ghats.find((x) => x.id === t.ghatId);
  const parts = params.map((p) => {
    const rs = PHASES.map((ph) => model.readings.find((r) => r.table === t.id && r.param === p && r.phase === ph));
    if (rs.every((r) => !r)) return null;
    const unit = PARAMS.find((x) => x.key === p).unit;
    return `${p}${unit ? ` (${unit})` : ''} pre ${cell(rs[0])}, during ${cell(rs[1])}, after ${cell(rs[2])}`;
  }).filter(Boolean);
  return `[${t.id}] ${g.short} ${t.festival} ${t.year} (${t.year} report p.${t.page}): ${parts.join(' | ')}`;
}

function header(model) {
  const o = model.overview;
  return [
    'DEFINITIONS',
    `- Source: MPPCB Ganesh and Durga Visarjan reports ${model.period.years.join(', ')}. Each ghat is tested before, during and one week after immersion.`,
    '- CPCB Class B (outdoor bathing) limits: DO >= 5 mg/l, BOD <= 3 mg/l, pH 6.5 to 8.5. Other parameters have NO Class B limit: informational only.',
    '- BDL = below detection limit: very low, not zero, not missing. n/s = not sampled: unknown, never clean. DO 0 is a real reading.',
    '',
    `HEADLINE NUMBERS (all ghats, ${model.period.span})`,
    `- DO below 5 mg/l in ${o.DO.failing} of ${o.DO.tested} tests. DO read 0 mg/l in ${o.DO.zeroIds.length} tests, all at Bairagarh.`,
    `- BOD above 3 mg/l in ${o.BOD.failing} of ${o.BOD.tested} tests. pH outside 6.5-8.5 in ${o.pH.failing} of ${o.pH.tested} tests.`,
    `- ${o.passingLatest.length} of ${model.ghats.length} ghats met all three bathing limits in their ${model.period.latest} tests.`,
    `- Missing tables: ${o.noTable.map((n) => `${model.ghats.find((g) => g.id === n.ghatId).short} ${n.event.replace('-', ' ')}`).join(', ')} (no table in the report).`,
  ].join('\n');
}

function rankingLines(model) {
  return ['RANKING (computed in code)', ...model.ghats.map((g) =>
    `#${g.rank} ${g.short} (${g.site}, ${g.waterBody}) - ${model.tiers[g.tier].en}, score ${g.score}. ${g.concerns.map((c) => c.en).join(' ')} ${g.positives.map((c) => c.en).join(' ')}`.trim(),
  )].join('\n');
}

function gapLines(model, ghatIds) {
  const lines = ['DATA GAPS AND NOTES'];
  for (const g of model.ghats.filter((x) => !ghatIds.length || ghatIds.includes(x.id))) {
    for (const n of g.notes) lines.push(`- ${g.short}: ${n.en}`);
  }
  for (const c of model.caveats.filter((x) => ['coliform', 'identical-metal', 'all-bdl'].includes(x.kind))) lines.push(`- ${c.en}`);
  return lines.join('\n');
}

export function factsForQuestion(model, ent) {
  const ghatIds = ent.ghats;
  let params = ent.params.length ? ent.params : CORE;
  if (!ghatIds.length && params.length > 4) params = params.slice(0, 4); // keep the prompt small
  const tables = model.tables.filter((t) =>
    (!ghatIds.length || ghatIds.includes(t.ghatId)) &&
    (!ent.years.length || ent.years.includes(t.year)) &&
    (!ent.festivals.length || ent.festivals.includes(t.festival)));
  return [
    header(model),
    '',
    rankingLines(model),
    '',
    gapLines(model, ghatIds),
    '',
    `READINGS BY TABLE (cite the [table-id]; showing ${params.join(', ')})`,
    ...tables.map((t) => tableLine(model, t, params)),
  ].join('\n');
}

export function factsForGhat(model, ghatId) {
  const g = model.ghats.find((x) => x.id === ghatId);
  const d = g.deploy;
  return [
    header(model),
    '',
    `GHAT: #${g.rank} of ${model.ghats.length} ${g.site} (${g.waterBody}) - ${model.tiers[g.tier].en}, score ${g.score}`,
    `Why this tier: ${g.tierWhy.en}`,
    'Concerns:', ...g.concerns.map((c) => `- ${c.en}`),
    'Within limits:', ...g.positives.map((c) => `- ${c.en}`),
    'Data gaps:', ...(g.notes.length ? g.notes.map((n) => `- ${n.en}`) : ['- none']),
    `Suggested: aeration ${d.aeration.level} (${d.aeration.en}); cleaning ${d.cleaning.level} (${d.cleaning.en}); testing ${d.testing.level} (${d.testing.en})`,
    '',
    'READINGS BY TABLE',
    ...model.tables.filter((t) => t.ghatId === ghatId).map((t) => tableLine(model, t, CORE)),
  ].join('\n');
}

// ---------- number verification ----------

const NUM = /\d+(?:[.,]\d+)?/g;
const canon = (s) => String(Number(s.replace(',', '.')));

/**
 * Every number in an AI answer must appear somewhere in the facts it was given
 * (or in the question). Citation tokens like [bairagarh-2023-D] are ignored.
 */
export function verifyNumbers(answer, ...sources) {
  const allowed = new Set();
  for (const s of sources) for (const m of String(s).match(NUM) || []) allowed.add(canon(m));
  const body = answer.replace(/\[[^\]]*\]/g, ' ');
  const found = body.match(NUM) || [];
  const unmatched = [...new Set(found.filter((m) => !allowed.has(canon(m))))];
  return { total: found.length, matched: found.length - found.filter((m) => !allowed.has(canon(m))).length, unmatched };
}

// Citation tokens the client can resolve: reading ids (R0054) and table ids.
export function knownTokens(model) {
  return new Set([...model.tables.map((t) => t.id), ...model.readings.map((r) => r.id)]);
}
