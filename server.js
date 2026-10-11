// Jal Prahari server: serves the dashboard and a small JSON API.
// Run: npm start  ->  http://127.0.0.1:3000

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel } from './lib/model.js';
import { readRows, currentDataFile, CURRENT_FILE } from './lib/dataset.js';
import { ask, ghatSummary, clearCaches } from './lib/ask.js';
import { buildBrief } from './lib/brief.js';
import { prepareUpload, describeUpload, saveRows, rowsToCSV } from './lib/upload.js';
import { aiStatus } from './lib/llm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// The data in use: the last upload (data/readings_current.csv) or the data pack.
const startFile = currentDataFile();
let rows = readRows(startFile);
let model = buildModel({
  rows,
  source: { file: path.basename(startFile), uploaded: path.basename(startFile) === CURRENT_FILE, updatedAt: fs.statSync(startFile).mtime.toISOString() },
});

const app = express();
app.use(express.json({ limit: '32kb' }));

app.use('/vendor/leaflet', express.static(path.join(here, 'node_modules', 'leaflet', 'dist')));
app.use('/shared', express.static(path.join(here, 'shared'))); // pure modules used by browser and server
app.use(express.static(path.join(here, 'public')));

app.get('/api/model', (req, res) => res.json(model));

app.get('/api/status', (req, res) => {
  res.json({ ai: aiStatus(), builtAt: model.builtAt, readings: model.readings.length, source: model.source });
});

app.post('/api/ask', async (req, res) => {
  const question = String(req.body?.question ?? '').slice(0, 500);
  const ghatId = typeof req.body?.ghatId === 'string' ? req.body.ghatId : undefined;
  res.json(await ask(model, question, { ghatId }));
});

app.get('/api/summary/:ghatId', async (req, res) => {
  const out = await ghatSummary(model, req.params.ghatId);
  if (!out) return res.status(404).json({ error: 'Unknown ghat' });
  res.json(out);
});

app.post('/api/brief', async (req, res) => {
  res.json(await buildBrief(model, { useAI: req.body?.useAI !== false }));
});

// Upload new report: the CSV is the request body. All-or-nothing: if any row is
// invalid, nothing changes and the officer gets the list of problems.
app.post('/api/upload', express.text({ type: ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream'], limit: '5mb' }), (req, res) => {
  const notLoaded = 'Not loaded. The dashboard still shows the previous data. Fix the problems below and upload again.';
  const result = prepareUpload(req.body, rows);
  if (!result.ok) return res.status(400).json({ ok: false, message: notLoaded, errors: result.errors });

  let next;
  const fileName = decodeURIComponent(req.get('X-File-Name') || '').slice(0, 200) || null;
  try {
    next = buildModel({ rows: result.rows, source: { file: CURRENT_FILE, uploaded: true, uploadedName: fileName, updatedAt: new Date().toISOString() } });
  } catch (err) {
    return res.status(400).json({ ok: false, message: notLoaded, errors: [err.message] });
  }
  saveRows(result.rows);
  rows = result.rows;
  model = next;
  clearCaches();
  console.log(`Upload ${fileName ?? ''}: ${describeUpload(result.summary, model.period)}`);
  res.json({ ok: true, message: describeUpload(result.summary, model.period), warnings: result.warnings, summary: result.summary });
});

// The data in use, as a CSV: a starting point for next year's file.
app.get('/api/data.csv', (req, res) => {
  res.attachment(`jal-prahari-readings-${model.period.allYears[0]}-${model.period.allYears.at(-1)}.csv`);
  res.type('text/csv').send(rowsToCSV(rows));
});

// Express needs all four arguments to treat this as the error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  const message = err.type === 'entity.too.large' ? 'The file is too large (limit 5 MB).'
    : status === 500 ? 'Something went wrong. The data and ranking are unaffected; please retry.' : 'Bad request.';
  res.status(status).json({ ok: false, error: message, message, errors: [] });
});

app.listen(PORT, HOST, () => {
  const ai = aiStatus();
  const line = (role) => (ai[role].enabled ? `${ai[role].provider} (${ai[role].model})` : `off - built-in engine (${ai[role].reason})`);
  console.log(`Jal Prahari running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Data: ${model.source.file} - ${model.source.rows} rows, showing ${model.period.span}`);
  console.log(`  Q&A + summaries AI: ${line('fast')}`);
  console.log(`  Brief writer AI:    ${line('writer')}`);
});
