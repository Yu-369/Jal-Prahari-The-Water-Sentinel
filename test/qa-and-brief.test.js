// Built-in Q&A, citations, number verification and the bilingual brief.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../lib/model.js';
import { answerBuiltIn } from '../lib/qa.js';
import { verifyNumbers, knownTokens, extractEntities } from '../lib/grounding.js';
import { buildBrief } from '../lib/brief.js';

const model = buildModel();
const tokens = knownTokens(model);
const text = (a) => a.blocks.flatMap((b) => (b.type === 'p' ? [b.text] : b.type === 'list' ? b.items : b.rows.flat())).join('\n');

const QUESTIONS = [
  'Which ghat is most at risk?', 'Where should aeration go first?', 'Where is data missing?',
  'Which ghat had zero oxygen?', 'Is Shahpura getting worse?', 'Compare Shahpura 2024 and 2025',
  'What is the BOD at Bairagarh in 2024?', 'How many BOD violations at Khatlapura?', 'Which is the safest ghat?',
  'What does BDL mean?', 'Show lead levels', 'Tell me about Rani Kamlapati', 'सबसे ख़तरनाक घाट कौन सा है?',
  'बैरागढ़ में ऑक्सीजन कितनी थी?', 'Compare all ghats', 'turbidity', 'hello',
];

test('every built-in answer cites only real readings or tables', () => {
  for (const q of QUESTIONS) {
    const a = answerBuiltIn(q, model);
    assert.ok(a.blocks.length, `answer for "${q}"`);
    for (const m of text(a).matchAll(/\[([A-Za-z0-9-]+)\]/g)) assert.ok(tokens.has(m[1]), `unknown token ${m[1]} in "${q}"`);
  }
});

test('zero-oxygen question finds the four Bairagarh readings', () => {
  const a = answerBuiltIn('Which ghat had zero oxygen?', model);
  assert.equal(a.intent, 'zero');
  const t = text(a);
  assert.match(t, /4 tests recorded dissolved oxygen of 0 mg\/l/);
  assert.equal([...t.matchAll(/\[R\d{4}\]/g)].length, 4);
});

test('missing-data question names both gaps and says unknown, not clean', () => {
  const t = text(answerBuiltIn('Where is data missing?', model));
  assert.match(t, /Bairagarh/);
  assert.match(t, /Malikhedi/);
  assert.match(t, /never counted as clean/);
});

test('Hindi questions get Hindi answers', () => {
  const a = answerBuiltIn('सबसे ख़तरनाक घाट कौन सा है?', model);
  assert.equal(a.lang, 'hi');
  assert.equal(a.intent, 'worst');
  assert.match(text(a), /बैरागढ़/);
});

test('"what do I…" does not trigger the DO parameter', () => {
  assert.deepEqual(extractEntities('What do I do about turbidity?').params, ['TURB']);
  assert.ok(extractEntities('DO at Bairagarh').params.includes('DO'));
});

test('number verification catches invented numbers and ignores citations', () => {
  const facts = 'DO 0 in 4 tests; BOD 14 mg/l; 42 of 116';
  assert.deepEqual(verifyNumbers('DO read 0 in 4 tests [bairagarh-2023-D]; 42 of 116.', facts).unmatched, []);
  assert.deepEqual(verifyNumbers('BOD reached 17.5 mg/l [R0054].', facts).unmatched, ['17.5']);
});

test('brief works with no AI and carries both languages', async () => {
  const b = await buildBrief(model, { now: new Date('2026-10-11T06:00:00Z') });
  assert.equal(b.engine.name, 'built-in');
  assert.equal(b.facts.daysLeft, 9);
  assert.equal(b.facts.ranking.length, 7);
  assert.match(b.narrative.en.summary, /42 of 116/);
  assert.match(b.narrative.hi.summary, /116 में से 42/);
  for (const lang of ['en', 'hi']) for (const k of ['summary', 'aeration', 'cleaning', 'testing', 'gaps', 'closing']) assert.ok(b.narrative[lang][k].length > 20, `${lang}.${k}`);
  assert.match(b.narrative.en.gaps, /unknown, not clean/);
});
