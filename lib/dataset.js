// Loads the MPPCB readings and turns each CSV row into a typed reading.
// Everything here is plain code: no AI is used to parse or check data.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from './csv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, '..', 'data');
export const REPORTS_DIR = path.join(here, '..', 'public', 'reports');

export const READINGS_FILE = 'bhopal_ghats_2023_2025.csv'; // original data pack, never modified
export const CURRENT_FILE = 'readings_current.csv'; // written by "Upload new report"
export const PREVIOUS_FILE = 'readings_previous.csv'; // backup of the version before the last upload
export const CRITERIA_FILE = 'cpcb_water_quality_criteria.csv';

// The columns of bhopal_ghats_2023_2025.csv. Uploaded files must have all of them.
export const CSV_COLUMNS = [
  'year', 'festival', 'site', 'water_body', 'phase', 'parameter', 'value', 'unit_assumed', 'flag',
  'value_as_printed', 'parameter_as_printed', 'site_as_printed', 'site_match_confidence', 'source_page',
];

// Ganesh is in September, Durga in October.
export const FESTIVALS = ['Ganesh', 'Durga'];

export function makeEvent(year, festival) {
  return {
    key: `${year}-${festival}`,
    year,
    festival,
    label: `${festival} ${year}`,
    short: `${festival[0]}${String(year).slice(2)}`,
    hi: `${festival === 'Ganesh' ? 'गणेश' : 'दुर्गा'} ${year}`,
  };
}

// Sort key for "2024-Durga" style event keys.
export function eventRank(key) {
  const [year, festival] = key.split('-');
  return Number(year) * 10 + FESTIVALS.indexOf(festival);
}

export function eventLabelOf(key, lang = 'en') {
  const [year, festival] = key.split('-');
  const ev = makeEvent(Number(year), festival);
  return lang === 'hi' ? ev.hi : ev.label;
}

// The festivals present in the data, in date order. An event exists only if some
// ghat has a table for it, so a festival that has not happened yet is never "missing".
export function eventsFrom(readings) {
  const keys = [...new Set(readings.map((r) => r.event))].sort((a, b) => eventRank(a) - eventRank(b));
  return keys.map((k) => makeEvent(Number(k.split('-')[0]), k.split('-')[1]));
}

const shortSpan = (ys) => (ys.length > 1 ? `${ys[0]}–${String(ys[ys.length - 1]).slice(2)}` : `${ys[0]}`);

/**
 * The analysis window: the most recent `size` years in the data. Ranking, trends
 * and the brief use these years; recent years weigh more.
 */
export function periodFor(readings, size = 3) {
  const allYears = [...new Set(readings.map((r) => r.year))].sort((a, b) => a - b);
  const years = allYears.slice(-size);
  const recentYears = years.slice(-2);
  const offset = size - years.length; // with fewer years, the latest still weighs most
  return {
    allYears,
    years,
    latest: years[years.length - 1],
    recentYears,
    span: shortSpan(years),
    recentSpan: shortSpan(recentYears),
    yearWeights: Object.fromEntries(years.map((y, i) => [y, i + 1 + offset])),
    dropped: allYears.filter((y) => !years.includes(y)),
  };
}

export const PHASES = ['pre', 'during', 'after'];

export const PHASE_LABEL = {
  pre: { en: 'before immersion', hi: 'विसर्जन से पहले', short: 'Pre' },
  during: { en: 'during immersion', hi: 'विसर्जन के दौरान', short: 'During' },
  after: { en: 'one week after', hi: 'एक सप्ताह बाद', short: 'After' },
};

export const FESTIVAL_HI = { Ganesh: 'गणेश', Durga: 'दुर्गा' };

// The MPPCB reports. source_page in the CSV is the physical PDF page, so
// `file#page=N` opens the exact page (checked with pdftotext).
const KNOWN_REPORTS = {
  2023: {
    year: 2023,
    title: 'MPPCB Idol Immersion Report 2023 (CPCB format)',
    pages: 87,
    file: 'reports/Idol_immer._Report_23_CPCB.pdf',
    url: 'https://www.mppcb.mp.gov.in/proc/mon/Idol_immer._Report_23_CPCB.pdf',
  },
  2024: {
    year: 2024,
    title: 'MPPCB Ganesh and Durga Visarjan Report 2024',
    pages: 118,
    file: 'reports/Ganesh_and_Durga_visarjan_report-2024.pdf',
    url: 'https://www.mppcb.mp.gov.in/proc/mon/Ganesh_and_Durga_visarjan_report-2024.pdf',
  },
  2025: {
    year: 2025,
    title: 'MPPCB Ganesh and Durga Visarjan Report 2025',
    pages: 92,
    file: 'reports/Ganesh_and_Durga_visarjan_report-2025.pdf',
    url: 'https://www.mppcb.mp.gov.in/proc/mon/Ganesh_and_Durga_visarjan_report-2025.pdf',
  },
};

// For a new year, save the report PDF under this name and page links start working.
export const reportFileName = (year) => `mppcb_visarjan_report_${year}.pdf`;

export function reportFor(year) {
  if (KNOWN_REPORTS[year]) return KNOWN_REPORTS[year];
  const name = reportFileName(year);
  const present = fs.existsSync(path.join(REPORTS_DIR, name));
  return {
    year,
    title: `MPPCB Ganesh and Durga Visarjan Report ${year}`,
    pages: null,
    file: present ? `reports/${name}` : null,
    url: null,
    expectedFile: `public/reports/${name}`,
  };
}

// Map positions come from OpenStreetMap (Nominatim / Overpass, 11 Oct 2026).
// `precision` says how close the point is to the actual ghat; none are surveyed.
export const GHATS = [
  {
    id: 'bairagarh',
    site: 'Bairagarh (Sant Hirdaram) kund',
    short: 'Bairagarh',
    hi: 'बैरागढ़ (संत हिरदाराम) कुंड',
    hiShort: 'बैरागढ़',
    waterBody: 'Upper Lake',
    waterBodyHi: 'बड़ा तालाब',
    location: { lat: 23.27446, lng: 77.33656, precision: 'locality', note: 'Bairagarh locality centre. The kund itself is not on OpenStreetMap.' },
    aliases: ['bairagarh', 'hirdaram', 'बैरागढ़', 'बैरागढ', 'हिरदाराम'],
  },
  {
    id: 'khatlapura',
    site: 'Khatlapura ghat',
    short: 'Khatlapura',
    hi: 'खटलापुरा घाट',
    hiShort: 'खटलापुरा',
    waterBody: 'Lower Lake',
    waterBodyHi: 'छोटा तालाब',
    location: { lat: 23.24852, lng: 77.40445, precision: 'water body', note: 'Placed at the Lower Lake centre. The ghat is not on OpenStreetMap; verify on the ground.' },
    aliases: ['khatlapura', 'khatla', 'खटलापुरा'],
  },
  {
    id: 'prempura',
    site: 'Prempura ghat',
    short: 'Prempura',
    hi: 'प्रेमपुरा घाट',
    hiShort: 'प्रेमपुरा',
    waterBody: 'Upper Lake',
    waterBodyHi: 'बड़ा तालाब',
    location: { lat: 23.2176, lng: 77.37549, precision: 'mapped ghat', note: 'OpenStreetMap feature "prempura ghat".' },
    aliases: ['prempura', 'प्रेमपुरा'],
  },
  {
    id: 'kamlapati',
    site: 'Rani Kamlapati ghat / Kamla Park kund',
    short: 'Rani Kamlapati',
    hi: 'रानी कमलापति घाट / कमला पार्क कुंड',
    hiShort: 'रानी कमलापति',
    waterBody: 'Lower Lake',
    waterBodyHi: 'छोटा तालाब',
    location: { lat: 23.25092, lng: 77.39784, precision: 'locality', note: 'Near Rani Kamlapati Mahal, Kamla Park. The readings may come from two different places.' },
    aliases: ['rani kamlapati', 'kamlapati', 'kamla park', 'kamla', 'lower lake ghat', 'कमलापति', 'कमला पार्क', 'कमला'],
  },
  {
    id: 'hathaikheda',
    site: 'Hathaikheda dam / kund',
    short: 'Hathaikheda',
    hi: 'हथाईखेड़ा डैम / कुंड',
    hiShort: 'हथाईखेड़ा',
    waterBody: 'Hathaikheda dam',
    waterBodyHi: 'हथाईखेड़ा डैम',
    location: { lat: 23.27155, lng: 77.49291, precision: 'water body', note: 'Hataikheda Dam reservoir on OpenStreetMap.' },
    aliases: ['hathaikheda', 'hataikheda', 'hathai', 'हथाईखेड़ा', 'हथाईखेडा', 'हथाई'],
  },
  {
    id: 'malikhedi',
    site: 'Malikhedi kund',
    short: 'Malikhedi',
    hi: 'मालीखेड़ी कुंड',
    hiShort: 'मालीखेड़ी',
    waterBody: 'Kund',
    waterBodyHi: 'कुंड',
    location: { lat: 23.2013, lng: 77.30555, precision: 'locality', note: 'Malikheri village centre on OpenStreetMap. The kund is not mapped; verify on the ground.' },
    aliases: ['malikhedi', 'maalikhedi', 'malikheri', 'malikheda', 'मालीखेड़ी', 'मालिखेड़ी', 'मालीखेडी'],
  },
  {
    id: 'shahpura',
    site: 'Shahpura lake ghat',
    short: 'Shahpura',
    hi: 'शाहपुरा झील घाट',
    hiShort: 'शाहपुरा',
    waterBody: 'Shahpura Lake',
    waterBodyHi: 'शाहपुरा झील',
    location: { lat: 23.20666, lng: 77.42124, precision: 'water body', note: 'Shahpura Lake on OpenStreetMap.' },
    aliases: ['shahpura', 'शाहपुरा'],
  },
];

// The 13 parameters, in display order: the three with a Class B limit first.
export const PARAMS = [
  { key: 'DO', name: 'Dissolved oxygen', label: 'Dissolved oxygen (DO)', hi: 'घुलित ऑक्सीजन (DO)', unit: 'mg/l', plain: 'Oxygen in the water. Fish need it.', aliases: ['dissolved oxygen', 'oxygen', ' do ', 'd.o', 'ऑक्सीजन', 'आक्सीजन', 'घुलित'] },
  { key: 'BOD', name: 'BOD', label: 'BOD', hi: 'बीओडी (BOD)', unit: 'mg/l', plain: 'Biochemical oxygen demand: how much organic waste eats oxygen.', aliases: ['bod', 'biochemical', 'organic', 'बीओडी'] },
  { key: 'pH', name: 'pH', label: 'pH', hi: 'पीएच (pH)', unit: '', plain: 'Acid or alkaline. 7 is neutral.', aliases: ['ph', 'acid', 'alkalin', 'पीएच'] },
  { key: 'COD', name: 'COD', label: 'COD', hi: 'सीओडी (COD)', unit: 'mg/l', plain: 'Chemical oxygen demand: total pollution that uses oxygen.', aliases: ['cod', 'chemical oxygen', 'सीओडी'] },
  { key: 'TURB', name: 'Turbidity', label: 'Turbidity', hi: 'गंदलापन (टर्बिडिटी)', unit: 'NTU', plain: 'Cloudiness of the water.', aliases: ['turbid', 'cloud', 'murk', 'गंदलापन', 'टर्बिडिटी'] },
  { key: 'TS', name: 'Total solids', label: 'Total solids', hi: 'कुल ठोस', unit: 'mg/l', plain: 'Everything left after the water dries.', aliases: ['total solid'] },
  { key: 'TDS', name: 'Dissolved solids', label: 'Dissolved solids', hi: 'घुलित ठोस', unit: 'mg/l', plain: 'Solids dissolved in the water.', aliases: ['dissolved solid', 'tds'] },
  { key: 'TSS', name: 'Suspended solids', label: 'Suspended solids', hi: 'निलंबित ठोस', unit: 'mg/l', plain: 'Particles floating in the water.', aliases: ['suspended', 'tss'] },
  { key: 'COND', name: 'Conductivity', label: 'Conductivity', hi: 'चालकता', unit: 'µS/cm', plain: 'Dissolved salts.', aliases: ['conductiv', 'salt', 'चालकता'] },
  { key: 'Cr', name: 'Chromium', label: 'Chromium', hi: 'क्रोमियम', unit: 'mg/l', plain: 'Heavy metal, often from idol paint.', metal: true, aliases: ['chromium', 'क्रोमियम'] },
  { key: 'Pb', name: 'Lead', label: 'Lead', hi: 'सीसा (लेड)', unit: 'mg/l', plain: 'Heavy metal, often from idol paint.', metal: true, aliases: ['lead', 'सीसा', 'लेड'] },
  { key: 'Zn', name: 'Zinc', label: 'Zinc', hi: 'जस्ता (ज़िंक)', unit: 'mg/l', plain: 'Heavy metal, often from idol paint.', metal: true, aliases: ['zinc', 'जस्ता', 'ज़िंक', 'जिंक'] },
  { key: 'Cu', name: 'Copper', label: 'Copper', hi: 'तांबा (कॉपर)', unit: 'mg/l', plain: 'Heavy metal, often from idol paint.', metal: true, aliases: ['copper', 'तांबा', 'कॉपर'] },
];

const GHAT_BY_SITE = new Map(GHATS.map((g) => [g.site, g]));
const PARAM_BY_NAME = new Map(PARAMS.map((p) => [p.name, p]));

// Why a value is empty, in words an officer can repeat. Report remarks for * and **
// are quoted from the 2025 MPPCB report ("Temporary/Artificial kunds ...").
const MISSING_REASON = {
  '*': {
    en: 'Not sampled: the temporary kund was not yet built at pre-immersion sampling (report remark *).',
    hi: 'नमूना नहीं: पूर्व-विसर्जन नमूने के समय अस्थायी कुंड बना नहीं था (रिपोर्ट टिप्पणी *).',
  },
  '**': {
    en: 'Not sampled: the temporary kund was dismantled before post-immersion sampling (report remark **).',
    hi: 'नमूना नहीं: बाद के नमूने से पहले अस्थायी कुंड हटा दिया गया था (रिपोर्ट टिप्पणी **).',
  },
  '_': { en: 'Not sampled (printed as "_" in the report).', hi: 'नमूना नहीं (रिपोर्ट में "_" छपा है).' },
  '': { en: 'Not sampled (blank in the report).', hi: 'नमूना नहीं (रिपोर्ट में खाली).' },
};

// The readings file in use: the last upload if there is one, else the data pack.
export function currentDataFile(dir = DATA_DIR) {
  const uploaded = path.join(dir, CURRENT_FILE);
  return fs.existsSync(uploaded) ? uploaded : path.join(dir, READINGS_FILE);
}

export function readRows(file = currentDataFile()) {
  return parseCSV(fs.readFileSync(file, 'utf8'));
}

const FESTIVAL_SET = new Set(FESTIVALS);
const PHASE_SET = new Set(['pre', 'during', 'after']);

/**
 * Check rows (from parseCSVTable) before anything is loaded. Returns a list of
 * problems with CSV line numbers; an empty list means the rows are safe to use.
 */
export function validateRows(header, rows) {
  const errors = [];
  const missingCols = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missingCols.length) {
    errors.push(`Missing column${missingCols.length > 1 ? 's' : ''}: ${missingCols.join(', ')}. Use the same columns as bhopal_ghats_2023_2025.csv.`);
    return errors;
  }
  if (!rows.length) return ['The file has no data rows.'];

  const seen = new Map();
  for (const { line, fields, record: r } of rows) {
    const add = (msg) => errors.push(`Line ${line}: ${msg}`);
    if (fields.length !== header.length) { add(`expected ${header.length} values, found ${fields.length}.`); continue; }
    const year = Number(r.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) add(`year "${r.year}" is not a valid year.`);
    if (!FESTIVAL_SET.has(r.festival)) add(`festival "${r.festival}" must be Ganesh or Durga.`);
    if (!GHAT_BY_SITE.has(r.site)) add(`unknown site "${r.site}". Use one of the 7 standard ghat names.`);
    if (!PHASE_SET.has(r.phase)) add(`phase "${r.phase}" must be pre, during or after.`);
    if (!PARAM_BY_NAME.has(r.parameter)) add(`unknown parameter "${r.parameter}".`);
    if (r.value !== '' && !Number.isFinite(Number(r.value))) add(`value "${r.value}" is not a number (leave it empty and use the flag column for BDL or not sampled).`);
    const page = Number(r.source_page);
    if (!Number.isInteger(page) || page < 1) add(`source_page "${r.source_page}" must be a page number, so the reading can be traced.`);
    const key = [r.year, r.festival, r.site, r.phase, r.parameter].join('|');
    if (seen.has(key)) add(`duplicate of line ${seen.get(key)} (same year, festival, site, phase and parameter).`);
    else seen.set(key, line);
    if (errors.length >= 25) { errors.push('Stopped after 25 problems.'); break; }
  }
  return errors;
}

/**
 * Reading status:
 *  - measured: a number was printed (0.0 is a real reading, never an error)
 *  - bdl:      below detection limit (BDL / ND) - very low, NOT zero, NOT missing
 *  - missing:  not sampled (blank, _, -, *, **) - unknown, NEVER clean
 */
export function toReadings(rows) {
  // A blank cell in a column whose pH cell carries * or ** shares that remark.
  const columnRemark = new Map();
  for (const r of rows) {
    if (r.flag === '*' || r.flag === '**') columnRemark.set(`${r.site}|${r.year}|${r.festival}|${r.phase}`, r.flag);
  }

  return rows.map((r, i) => {
    const ghat = GHAT_BY_SITE.get(r.site);
    const param = PARAM_BY_NAME.get(r.parameter);
    if (!ghat) throw new Error(`Unknown site in CSV row ${i + 2}: ${r.site}`);
    if (!param) throw new Error(`Unknown parameter in CSV row ${i + 2}: ${r.parameter}`);

    let status;
    let value = null;
    if (r.value !== '') {
      status = 'measured';
      value = Number(r.value);
      if (!Number.isFinite(value)) throw new Error(`Bad number in CSV row ${i + 2}: ${r.value}`);
    } else if (r.flag === 'BDL' || r.flag === 'ND') {
      status = 'bdl';
    } else {
      status = 'missing';
    }

    let missingReason = null;
    if (status === 'missing') {
      const printed = r.value_as_printed;
      const key = printed === '*' || printed === '**' || printed === '_' ? printed
        : columnRemark.get(`${r.site}|${r.year}|${r.festival}|${r.phase}`) ?? '';
      missingReason = MISSING_REASON[key] ?? MISSING_REASON[''];
    }

    const year = Number(r.year);
    return {
      id: `R${String(i + 1).padStart(4, '0')}`,
      csvRow: i + 2, // line number in the CSV file, header is line 1
      ghatId: ghat.id,
      year,
      festival: r.festival,
      event: `${year}-${r.festival}`,
      phase: r.phase,
      param: param.key,
      unit: r.unit_assumed,
      status,
      value,
      printed: r.value_as_printed || r.value || (status === 'bdl' ? r.flag : ''),
      flag: r.flag,
      parameterPrinted: r.parameter_as_printed,
      sitePrinted: r.site_as_printed,
      confidence: r.site_match_confidence,
      page: Number(r.source_page),
      table: tableId(ghat.id, year, r.festival),
      missingReason,
    };
  });
}

export function tableId(ghatId, year, festival) {
  return `${ghatId}-${year}-${festival[0]}`;
}

export function loadCriteria(dir = DATA_DIR) {
  return parseCSV(fs.readFileSync(path.join(dir, CRITERIA_FILE), 'utf8'));
}
