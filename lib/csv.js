// Minimal RFC 4180 CSV parser and writer (quoted fields, escaped quotes, CRLF).
// No dependencies.

function tokenize(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const isBlank = (r) => r.length === 1 && r[0].trim() === '';

// Rows as objects keyed by header. Rows with the wrong number of fields are dropped.
export function parseCSV(text) {
  const rows = tokenize(text);
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// Header plus every non-blank row with its line number, for validation.
export function parseCSVTable(text) {
  const rows = tokenize(text);
  if (!rows.length) return { header: [], rows: [] };
  const header = rows.shift().map((h) => h.trim());
  const out = [];
  rows.forEach((fields, i) => {
    if (isBlank(fields)) return;
    const record = Object.fromEntries(header.map((h, j) => [h, (fields[j] ?? '').trim()]));
    out.push({ line: i + 2, fields, record });
  });
  return { header, rows: out };
}

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(columns, records) {
  return [columns.join(','), ...records.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}
