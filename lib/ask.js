// Q&A and per-ghat summaries. The built-in engine always runs; if the "fast" AI
// role is configured, AI writes the answer from a fact sheet instead, every number
// is verified against that fact sheet, and the built-in answer is the fallback.

import { answerBuiltIn } from './qa.js';
import { complete, roleConfig } from './llm.js';
import { extractEntities, factsForQuestion, factsForGhat, verifyNumbers, knownTokens, isHindi } from './grounding.js';

const QA_SYSTEM = `You answer questions from a Bhopal Municipal Corporation officer about MPPCB water tests at 7 idol-immersion ghats.
Use ONLY the FACTS given. If they do not answer the question, say so plainly.
After each number, cite the table it comes from in square brackets, exactly as written in the facts, e.g. [bairagarh-2023-D].
BDL = below detection limit: very low, not zero, not missing. n/s = not sampled: unknown, never clean. DO 0 is a real reading.
Judge only against CPCB Class B limits (DO >= 5 mg/l, BOD <= 3 mg/l, pH 6.5-8.5). Other parameters have no Class B limit.
Do not claim health effects. Do not invent numbers or do new arithmetic.
Answer in the language of the question (Hindi or English). At most 110 words. Plain text; you may use "- " bullets.`;

const SUMMARY_SYSTEM = `You write a 2-3 sentence briefing on one immersion ghat for a Bhopal Municipal Corporation officer planning Durga visarjan.
Use ONLY the facts given; do not invent numbers or do new arithmetic. Lead with the most urgent point, then the main data gap if any.
Missing data is unknown, never clean. Do not claim health effects. Plain English, no bullet points, at most 70 words.`;

function cleanTokens(text, tokens) {
  return text.replace(/\[([^\]]+)\]/g, (m, id) => (tokens.has(id.trim()) ? `[${id.trim()}]` : ''));
}

function textToBlocks(text) {
  const blocks = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const item = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!list) { list = { type: 'list', items: [] }; blocks.push(list); }
      list.items.push(item[1].replace(/\*\*/g, ''));
    } else {
      list = null;
      blocks.push({ type: 'p', text: line.replace(/\*\*/g, '') });
    }
  }
  return blocks;
}

export async function ask(model, question, { ghatId } = {}) {
  const t0 = performance.now();
  const builtIn = answerBuiltIn(question, model, { ghatId });
  const builtInMs = Math.max(1, Math.round(performance.now() - t0));
  const cfg = roleConfig('fast');
  if (!cfg.enabled || !question.trim()) return { ...builtIn, ms: builtInMs };

  try {
    const ent = extractEntities(question);
    if (!ent.ghats.length && ghatId && /this ghat|this site|here|इस घाट|यहाँ/i.test(question)) ent.ghats.push(ghatId);
    const facts = factsForQuestion(model, ent);
    const ai = await complete('fast', { system: QA_SYSTEM, user: `FACTS\n${facts}\n\nQUESTION: ${question}`, maxTokens: 700 });
    const text = cleanTokens(ai.text.trim(), knownTokens(model));
    return {
      engine: ai.provider,
      model: ai.model,
      ms: ai.ms,
      serverMs: ai.serverMs,
      lang: isHindi(question) ? 'hi' : 'en',
      intent: builtIn.intent,
      blocks: textToBlocks(text),
      verification: verifyNumbers(text, facts, question),
      followUps: builtIn.followUps,
    };
  } catch (err) {
    return { ...builtIn, ms: builtInMs, aiError: err.message };
  }
}

function builtInSummary(model, g) {
  const total = model.ghats.length;
  const bod = g.concerns.find((c) => c.kind === 'bod');
  const gap = g.notes[0];
  const firstSentence = (s) => (s.match(/^.*?\.(\s|$)/)?.[0] ?? s).trim();
  return {
    en: [`#${g.rank} of ${total}, ${model.tiers[g.tier].en}. ${g.tierWhy.en}`, bod?.en, gap ? firstSentence(gap.en) : ''].filter(Boolean).join(' '),
    hi: [`${total} में #${g.rank}, ${model.tiers[g.tier].hi}. ${g.tierWhy.hi}`, bod?.hi, gap ? firstSentence(gap.hi) : ''].filter(Boolean).join(' '),
  };
}

const summaryCache = new Map();

// Call after new data is loaded so no summary describes the old data.
export function clearCaches() {
  summaryCache.clear();
}

export async function ghatSummary(model, ghatId) {
  const g = model.ghats.find((x) => x.id === ghatId);
  if (!g) return null;
  const t0 = performance.now();
  const base = { ghatId, ...builtInSummary(model, g) };
  const cfg = roleConfig('fast');
  if (!cfg.enabled) return { ...base, engine: 'built-in', ms: Math.max(1, Math.round(performance.now() - t0)) };

  if (summaryCache.has(ghatId)) return { ...summaryCache.get(ghatId), cached: true };
  try {
    const facts = factsForGhat(model, ghatId);
    const ai = await complete('fast', { system: SUMMARY_SYSTEM, user: `FACTS\n${facts}`, maxTokens: 300 });
    const text = ai.text.trim().replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ');
    const verification = verifyNumbers(text, facts);
    const out = { ...base, ai: text, engine: ai.provider, model: ai.model, ms: ai.ms, serverMs: ai.serverMs, verification };
    if (!verification.unmatched.length) summaryCache.set(ghatId, out);
    return out;
  } catch (err) {
    return { ...base, engine: 'built-in', ms: Math.round(performance.now() - t0), aiError: err.message };
  }
}
