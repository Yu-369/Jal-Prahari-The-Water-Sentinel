// The optional AI path, exercised against a local mock of an OpenAI-style
// endpoint (no real API key or network). Proves that AI output is checked:
// unknown citations are stripped, invented numbers are flagged, and brief fields
// with invented numbers fall back to the template.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildModel } from '../lib/model.js';
import { ask } from '../lib/ask.js';
import { buildBrief, templateNarrative, briefFacts } from '../lib/brief.js';

const model = buildModel();
let server;
let reply = '';

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }], time_info: { total_time: 0.18 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.CEREBRAS_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.CEREBRAS_API_KEY = 'test-key';
  process.env.FAST_AI_PROVIDER = 'cerebras';
  process.env.WRITER_AI_PROVIDER = 'cerebras';
});

after(() => {
  server.close();
  for (const k of ['CEREBRAS_BASE_URL', 'CEREBRAS_API_KEY', 'FAST_AI_PROVIDER', 'WRITER_AI_PROVIDER']) delete process.env[k];
});

test('AI answer: verified numbers pass, invented numbers are flagged, fake citations removed', async () => {
  reply = 'Bairagarh read 0 mg/l DO in 4 tests [bairagarh-2023-D] [made-up-id].\n- BOD reached 99.9 mg/l [R0054]';
  const a = await ask(model, 'Which ghat had zero oxygen?');
  assert.equal(a.engine, 'cerebras');
  assert.equal(a.serverMs, 180);
  const all = a.blocks.flatMap((b) => (b.type === 'p' ? [b.text] : b.items)).join(' ');
  assert.ok(!all.includes('made-up-id'), 'unknown citation stripped');
  assert.ok(all.includes('[bairagarh-2023-D]'), 'real citation kept');
  assert.deepEqual(a.verification.unmatched, ['99.9']);
});

test('brief: AI fields with invented numbers are replaced by the template', async () => {
  const now = new Date('2026-10-11T06:00:00Z');
  const tpl = templateNarrative(briefFacts(model, now));
  const ai = { en: { ...tpl.en, summary: 'Reworded summary: 42 of 116 DO tests failed.', aeration: 'Send 12 aerators to Bairagarh.' }, hi: { ...tpl.hi } };
  reply = JSON.stringify(ai);
  const b = await buildBrief(model, { now });
  assert.equal(b.engine.name, 'cerebras');
  assert.equal(b.narrative.en.summary, 'Reworded summary: 42 of 116 DO tests failed.');
  assert.equal(b.narrative.en.aeration, tpl.en.aeration, 'invented "12" rejected');
  assert.ok(b.engine.replaced.some((r) => r.field === 'en.aeration' && r.unmatched.includes('12')));
});

test('AI failure falls back to the built-in answer', async () => {
  reply = 'not used';
  process.env.CEREBRAS_BASE_URL = 'http://127.0.0.1:1'; // nothing listens here
  const a = await ask(model, 'Where is data missing?');
  assert.equal(a.engine, 'built-in');
  assert.ok(a.aiError);
});
