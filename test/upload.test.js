// "Upload new report": validation, merge-by-year, and the moving 3-year window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRows, DATA_DIR, READINGS_FILE, CURRENT_FILE, PREVIOUS_FILE } from '../lib/dataset.js';
import { prepareUpload, saveRows, rowsToCSV } from '../lib/upload.js';
import { buildModel } from '../lib/model.js';

const ORIGINAL_FILE = path.join(DATA_DIR, READINGS_FILE);
const original = readRows(ORIGINAL_FILE);
const yearRows = (y, newYear = y) => original.filter((r) => r.year === String(y)).map((r) => ({ ...r, year: String(newYear) }));

test('rejects a file without the required columns', () => {
  const res = prepareUpload('year,site,value\n2026,Prempura ghat,5\n', original);
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /Missing columns: festival, water_body, phase/);
});

test('rejects bad rows with line numbers, and loads nothing', () => {
  const rows = yearRows(2025).slice(0, 5);
  rows[1] = { ...rows[1], site: 'Upper Lake new ghat' };
  rows[2] = { ...rows[2], value: 'abc' };
  rows[3] = { ...rows[3], source_page: '' };
  rows.push({ ...rows[0] });
  const res = prepareUpload(rowsToCSV(rows), original);
  assert.equal(res.ok, false);
  assert.equal(res.rows, undefined);
  const all = res.errors.join('\n');
  assert.match(all, /Line 3: unknown site "Upper Lake new ghat"/);
  assert.match(all, /Line 4: value "abc" is not a number/);
  assert.match(all, /Line 5: source_page "" must be a page number/);
  assert.match(all, /Line 7: duplicate of line 2/);
});

test('empty and non-CSV input are rejected', () => {
  assert.equal(prepareUpload('', original).ok, false);
  assert.equal(prepareUpload(undefined, original).ok, false);
});

test('a new year is added, older years kept, and the window moves to the latest 3 years', () => {
  const res = prepareUpload(rowsToCSV(yearRows(2025, 2026)), original);
  assert.equal(res.ok, true);
  assert.deepEqual(res.summary.yearsAdded, [2026]);
  assert.deepEqual(res.summary.yearsKept, [2023, 2024, 2025]);
  assert.equal(res.summary.totalRows, original.length + 453);
  assert.ok(res.warnings.some((w) => w.includes('public/reports/mppcb_visarjan_report_2026.pdf')));

  const model = buildModel({ rows: res.rows });
  assert.equal(model.period.span, '2024–26');
  assert.deepEqual(model.source.years, [2023, 2024, 2025, 2026]);
  assert.deepEqual(model.events.map((e) => e.key), ['2024-Ganesh', '2024-Durga', '2025-Ganesh', '2025-Durga', '2026-Ganesh', '2026-Durga']);
  assert.ok(model.readings.every((r) => r.year >= 2024), '2023 is kept in the file but not analysed');
  assert.deepEqual(model.method.yearWeights, { 2024: 1, 2025: 2, 2026: 3 });
  assert.ok(model.caveats.some((c) => c.kind === 'older-years'));
  assert.ok(model.caveats.some((c) => c.kind === 'no-pdf'));
  assert.equal(model.reports[2026].file, null);
  const bairagarh = model.ghats.find((g) => g.id === 'bairagarh');
  assert.ok(bairagarh.notes.some((n) => n.kind === 'no-table' && n.event === '2026-Durga'));
  assert.equal(bairagarh.deploy.testing.level, 'priority');
  assert.match(bairagarh.deploy.testing.en, /No Durga 2026 test on record/);
  assert.match(bairagarh.tierWhy.en, /2025–26/);
});

test('uploading one year replaces only that year', () => {
  const fixed = yearRows(2025).map((r) => (r.site === 'Shahpura lake ghat' && r.festival === 'Durga' && r.phase === 'pre' && r.parameter === 'Dissolved oxygen'
    ? { ...r, value: '6.5', value_as_printed: '6.5' } : r));
  const res = prepareUpload(rowsToCSV(fixed), original);
  assert.deepEqual(res.summary.yearsReplaced, [2025]);
  assert.equal(res.summary.totalRows, original.length);
  const shahpura = buildModel({ rows: res.rows }).ghats.find((g) => g.id === 'shahpura');
  assert.match(shahpura.tierWhy.en, /lowest 2\.8 mg\/l/, 'the corrected 2.5 is gone; 2.8 is now the lowest');
});

test('re-uploading the original file gives the same ranking', () => {
  const res = prepareUpload(fs.readFileSync(ORIGINAL_FILE, 'utf8'), original);
  assert.deepEqual(res.summary.yearsReplaced, [2023, 2024, 2025]);
  const before = buildModel({ rows: original }).ghats.map((g) => `${g.id}:${g.score}`);
  const after = buildModel({ rows: res.rows }).ghats.map((g) => `${g.id}:${g.score}`);
  assert.deepEqual(after, before);
});

test('a festival whose report is not out yet is not flagged as missing', () => {
  const ganeshOnly = yearRows(2025, 2026).filter((r) => r.festival === 'Ganesh');
  const model = buildModel({ rows: prepareUpload(rowsToCSV(ganeshOnly), original).rows });
  assert.ok(!model.events.some((e) => e.key === '2026-Durga'));
  assert.ok(!model.overview.noTable.some((n) => n.event === '2026-Durga'));
  const t = model.ghats.find((g) => g.id === 'shahpura').trends.DO.Durga;
  assert.deepEqual(t.points.map((p) => p.year), [2024, 2025]);
});

test('saveRows writes the merged file and keeps the previous version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jal-prahari-'));
  try {
    saveRows(original, dir);
    assert.ok(fs.existsSync(path.join(dir, CURRENT_FILE)));
    assert.ok(!fs.existsSync(path.join(dir, PREVIOUS_FILE)));
    const merged = prepareUpload(rowsToCSV(yearRows(2025, 2026)), original).rows;
    saveRows(merged, dir);
    assert.equal(readRows(path.join(dir, CURRENT_FILE)).length, merged.length);
    assert.equal(readRows(path.join(dir, PREVIOUS_FILE)).length, original.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
