// Resource allocator: the rules the officer relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../lib/model.js';
import { allocate, cleanCounts, dataStatus, RESOURCES } from '../shared/allocate.js';

const model = buildModel();
const row = (a, id) => a.rows.find((r) => r.id === id);

test('ghats with insufficient data need testing first (Bairagarh, Malikhedi only)', () => {
  const flagged = model.ghats.filter((g) => dataStatus(g, model.events).testFirst).map((g) => g.id).sort();
  assert.deepEqual(flagged, ['bairagarh', 'malikhedi']);
});

test('default 3 / 2 / 4: the plan an officer would see', () => {
  const a = allocate(model, { aeration: 3, testing: 2, cleaning: 4 });
  // Aeration follows oxygen risk among critical ghats; Shahpura is the one left short.
  assert.deepEqual(['bairagarh', 'malikhedi', 'kamlapati'].map((id) => row(a, id).alloc.aeration), [1, 1, 1]);
  assert.equal(row(a, 'shahpura').state.aeration, 'short');
  // Testing kits go first to the ghats that need testing.
  assert.equal(row(a, 'bairagarh').alloc.testing, 1);
  assert.equal(row(a, 'malikhedi').alloc.testing, 1);
  assert.deepEqual(a.totals.testing.uncovered.sort(), ['kamlapati', 'shahpura']);
  // Cleaning crews are held back where data is missing; Hathaikheda's BOD earns one.
  assert.equal(row(a, 'bairagarh').state.cleaning, 'held');
  assert.equal(row(a, 'malikhedi').state.cleaning, 'held');
  assert.deepEqual(['shahpura', 'kamlapati', 'hathaikheda'].map((id) => row(a, id).alloc.cleaning), [2, 1, 1]);
  assert.equal(a.shortTotal, 3);
});

test('no aeration where oxygen was never a problem', () => {
  for (const n of [1, 5, 20, 99]) {
    const a = allocate(model, { aeration: n, testing: 0, cleaning: 0 });
    assert.equal(row(a, 'hathaikheda').alloc.aeration, 0);
    assert.equal(row(a, 'hathaikheda').state.aeration, 'not-needed');
  }
});

test('every ghat gets a testing kit before any ghat gets a second', () => {
  const a = allocate(model, { aeration: 0, testing: 7, cleaning: 0 });
  assert.ok(a.rows.every((r) => r.alloc.testing === 1));
});

test('critical ghats get at least one when there are enough units', () => {
  const a = allocate(model, { aeration: 4, testing: 4, cleaning: 2 });
  for (const r of a.rows.filter((x) => x.tier === 'critical')) {
    assert.ok(r.alloc.aeration >= 1, `${r.id} aeration`);
    assert.ok(r.alloc.testing >= 1, `${r.id} testing`);
    if (!r.testFirst) assert.ok(r.alloc.cleaning >= 1, `${r.id} cleaning`);
  }
  assert.equal(a.shortTotal, 0);
});

test('extra units follow the matching risk (oxygen for aeration)', () => {
  const a = allocate(model, { aeration: 40, testing: 0, cleaning: 0 });
  const by = (id) => row(a, id).alloc.aeration;
  assert.ok(by('bairagarh') >= by('malikhedi') && by('malikhedi') >= by('kamlapati') && by('kamlapati') >= by('prempura'));
});

test('invariants hold for any counts: nothing lost, nothing to ineligible ghats', () => {
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 300; i++) {
    const counts = { aeration: rand(25), testing: rand(25), cleaning: rand(25) };
    const a = allocate(model, counts);
    for (const r of RESOURCES) {
      const t = a.totals[r.key];
      assert.equal(t.allocated + t.unplaced, counts[r.key], `${r.key} accounted for`);
      assert.equal(a.rows.reduce((s, x) => s + x.alloc[r.key], 0), t.allocated);
      assert.equal(t.short, Math.max(0, t.firstNeeded - counts[r.key]));
    }
    for (const x of a.rows) {
      if (x.testFirst) assert.equal(x.alloc.cleaning, 0, 'no crew before testing');
      for (const r of RESOURCES) assert.ok(x.alloc[r.key] >= 0 && Number.isInteger(x.alloc[r.key]));
    }
  }
});

test('counts are cleaned: negatives, text and huge numbers', () => {
  assert.deepEqual(cleanCounts({ aeration: -3, testing: 'abc', cleaning: 1e6 }), { aeration: 0, testing: 0, cleaning: 99 });
  assert.deepEqual(cleanCounts({ aeration: '2.9' }), { aeration: 2, testing: 0, cleaning: 0 });
  const zero = allocate(model, { aeration: 0, testing: 0, cleaning: 0 });
  assert.ok(zero.rows.every((r) => Object.values(r.alloc).every((n) => n === 0)));
  assert.ok(zero.lines.every((l) => l.en && l.hi));
});
