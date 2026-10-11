// The data rules the jury checks. Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../lib/model.js';
import { checkReading } from '../lib/limits.js';

const model = buildModel();
const R = model.readings;
const ghat = (id) => model.ghats.find((g) => g.id === id);

test('loads all 1,524 readings with a status for each', () => {
  assert.equal(R.length, 1524);
  const count = (s) => R.filter((r) => r.status === s).length;
  assert.equal(count('measured'), 1289);
  assert.equal(count('bdl'), 174);
  assert.equal(count('missing'), 61);
});

test('CPCB Class B limits are read from the criteria file', () => {
  assert.deepEqual([model.rules.DO.type, model.rules.DO.limit], ['min', 5]);
  assert.deepEqual([model.rules.BOD.type, model.rules.BOD.limit], ['max', 3]);
  assert.deepEqual([model.rules.pH.min, model.rules.pH.max], [6.5, 8.5]);
  assert.equal(model.rules.COD, undefined, 'COD has no Class B limit');
});

test('headline counts match the problem statement (42/116 DO, 100/112 BOD)', () => {
  assert.equal(model.overview.DO.failing, 42);
  assert.equal(model.overview.DO.tested, 116);
  assert.equal(model.overview.BOD.failing, 100);
  assert.equal(model.overview.BOD.tested, 112);
});

test('BDL is very low: never zero, never missing', () => {
  for (const r of R.filter((x) => x.status === 'bdl')) {
    assert.equal(r.value, null, 'BDL has no numeric value (not 0)');
    assert.notEqual(r.check.result, 'missing');
  }
  // Semantics against each kind of limit
  const rules = model.rules;
  assert.equal(checkReading({ param: 'BOD', status: 'bdl' }, rules).result, 'pass');
  assert.equal(checkReading({ param: 'DO', status: 'bdl' }, rules).result, 'fail');
  assert.equal(checkReading({ param: 'pH', status: 'bdl' }, rules).result, 'unknown');
  assert.equal(checkReading({ param: 'Pb', status: 'bdl' }, rules).result, 'info');
});

test('missing data is never treated as clean', () => {
  for (const r of R.filter((x) => x.status === 'missing')) {
    assert.equal(r.value, null);
    assert.equal(r.check.result, 'missing');
    assert.ok(r.missingReason?.en, 'every missing value explains why');
  }
  // The score only averages tests that were done: tested counts exclude missing.
  for (const g of model.ghats) {
    for (const p of ['DO', 'BOD', 'pH']) {
      const done = R.filter((r) => r.ghatId === g.id && r.param === p && r.status !== 'missing').length;
      assert.equal(g.scoreParts[p].tested, done);
    }
  }
});

test('DO = 0.0 is a real, catastrophic reading (4 at Bairagarh)', () => {
  const zeros = R.filter((r) => r.param === 'DO' && r.status === 'measured' && r.value === 0);
  assert.equal(zeros.length, 4);
  assert.ok(zeros.every((r) => r.ghatId === 'bairagarh' && r.check.result === 'fail'));
  assert.deepEqual(zeros.map((r) => r.page).sort(), [26, 28, 60, 60]);
  assert.ok(ghat('bairagarh').concerns[0].en.includes('0 mg/l in 4 tests'));
});

test('Bairagarh and Malikhedi show the missing Durga 2025 table explicitly', () => {
  for (const id of ['bairagarh', 'malikhedi']) {
    const g = ghat(id);
    assert.ok(g.notes.some((n) => n.kind === 'no-table' && n.event === '2025-Durga'));
    assert.equal(g.coverage.tables.present, 5);
    assert.equal(g.coverage.DO.tested, 13);
    assert.equal(g.coverage.DO.expected, 18);
    assert.equal(g.deploy.testing.level, 'priority');
  }
  assert.deepEqual(model.overview.noTable.map((n) => n.ghatId).sort(), ['bairagarh', 'malikhedi']);
});

test('Rani Kamlapati is flagged as a possible two-location site', () => {
  const g = ghat('kamlapati');
  assert.equal(g.confidence, 'medium');
  assert.ok(g.notes.some((n) => n.kind === 'site-uncertain'));
  assert.ok(model.ghats.filter((x) => x.id !== 'kamlapati').every((x) => x.confidence === 'high'));
});

test('every reading traces to a page inside its report', () => {
  for (const r of R) {
    const rep = model.reports[r.year];
    assert.ok(rep, `report for ${r.year}`);
    assert.ok(r.page >= 1 && r.page <= rep.pages, `${r.id} page ${r.page}`);
  }
});

test('ranking: tier first, then score; Bairagarh is #1', () => {
  assert.equal(model.ghats[0].id, 'bairagarh');
  assert.deepEqual(model.ghats.map((g) => g.rank), [1, 2, 3, 4, 5, 6, 7]);
  const order = { critical: 0, warning: 1, safe: 2, nodata: 3 };
  for (let i = 1; i < model.ghats.length; i++) {
    const a = model.ghats[i - 1];
    const b = model.ghats[i];
    assert.ok(order[a.tier] < order[b.tier] || (a.tier === b.tier && a.score >= b.score));
  }
  assert.deepEqual(model.overview.critical.sort(), ['bairagarh', 'kamlapati', 'malikhedi', 'shahpura']);
  assert.equal(model.overview.passingLatest.length, 0, 'no ghat met all limits in the latest year');
});

test('a series that is still failing is never called "better"', () => {
  const t = ghat('bairagarh').trends.DO.Durga;
  assert.equal(t.verdict, 'still-failing');
  assert.equal(t.latestMissing, true);
});

test('metals have no Class B limit and never affect the score', () => {
  for (const r of R.filter((x) => ['Cr', 'Pb', 'Zn', 'Cu'].includes(x.param) && x.status !== 'missing')) {
    assert.equal(r.check.result, 'info');
  }
});
