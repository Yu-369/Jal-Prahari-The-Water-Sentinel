// "Upload new report": check a CSV in the same format as bhopal_ghats_2023_2025.csv,
// merge it into the current data by year, and save it. Plain code, no AI.
//
// Merge rule: years in the uploaded file replace those years; all other years are
// kept. So a file with only 2026 rows adds 2026, and a corrected 2025 file fixes 2025.

import fs from 'node:fs';
import path from 'node:path';
import { parseCSVTable, toCSV } from './csv.js';
import { validateRows, reportFor, CSV_COLUMNS, DATA_DIR, CURRENT_FILE, PREVIOUS_FILE } from './dataset.js';

const yearsOf = (rows) => [...new Set(rows.map((r) => Number(r.year)))].sort((a, b) => a - b);

export function prepareUpload(text, currentRows) {
  if (typeof text !== 'string') return { ok: false, errors: ['Could not read the file. Upload a .csv file.'] };
  if (!text.trim()) return { ok: false, errors: ['The file is empty.'] };

  const { header, rows } = parseCSVTable(text);
  const errors = validateRows(header, rows);
  if (errors.length) return { ok: false, errors };

  const uploaded = rows.map((r) => Object.fromEntries(CSV_COLUMNS.map((c) => [c, r.record[c]])));
  const upYears = yearsOf(uploaded);
  const curYears = yearsOf(currentRows);
  const kept = currentRows.filter((r) => !upYears.includes(Number(r.year)));
  // Stable sort: rows keep their file order within a year.
  const merged = [...kept, ...uploaded].sort((a, b) => Number(a.year) - Number(b.year));

  return {
    ok: true,
    rows: merged,
    summary: {
      rows: uploaded.length,
      yearsUploaded: upYears,
      yearsAdded: upYears.filter((y) => !curYears.includes(y)),
      yearsReplaced: upYears.filter((y) => curYears.includes(y)),
      yearsKept: curYears.filter((y) => !upYears.includes(y)),
      totalRows: merged.length,
    },
    warnings: upYears.map(reportFor).filter((r) => !r.file)
      .map((r) => `No PDF for the ${r.year} report yet, so its page numbers show but cannot be opened. Save the report as ${r.expectedFile} and restart.`),
  };
}

export function describeUpload(summary, period) {
  const parts = [];
  if (summary.yearsAdded.length) parts.push(`added ${summary.yearsAdded.join(', ')}`);
  if (summary.yearsReplaced.length) parts.push(`replaced ${summary.yearsReplaced.join(', ')}`);
  if (summary.yearsKept.length) parts.push(`kept ${summary.yearsKept.join(', ')}`);
  return `Loaded ${summary.rows} readings: ${parts.join('; ')}. Risk scores recomputed; the dashboard now shows ${period.span}.`;
}

// Write the merged data to data/readings_current.csv (the data-pack file is never
// touched). The version it replaces is kept as data/readings_previous.csv.
export function saveRows(rows, dir = DATA_DIR) {
  const current = path.join(dir, CURRENT_FILE);
  if (fs.existsSync(current)) fs.copyFileSync(current, path.join(dir, PREVIOUS_FILE));
  const tmp = `${current}.tmp`;
  fs.writeFileSync(tmp, toCSV(CSV_COLUMNS, rows), 'utf8');
  fs.renameSync(tmp, current);
  return current;
}

export function rowsToCSV(rows) {
  return toCSV(CSV_COLUMNS, rows);
}
