// "Upload new report": send a CSV to the server, show the result, reload the
// dashboard with the recomputed ranking.

import { h, el, icon } from './util.js';

const FLASH_KEY = 'jal-prahari-flash';

export function initUpload() {
  const input = el('upload-input');
  el('upload-btn').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = ''; // allow choosing the same file again after fixing it
    if (file) await upload(file);
  });

  // Message carried across the reload that follows a successful upload.
  const flash = sessionStorage.getItem(FLASH_KEY);
  if (flash) {
    sessionStorage.removeItem(FLASH_KEY);
    const { kind, message, items } = JSON.parse(flash);
    showBanner(kind, message, items);
  }
}

async function upload(file) {
  if (!/\.csv$/i.test(file.name)) {
    showBanner('error', `"${file.name}" is not a CSV file.`, ['Choose a .csv file in the same format as bhopal_ghats_2023_2025.csv. In Excel: File → Save As → CSV UTF-8.']);
    return;
  }
  const btn = el('upload-btn');
  btn.disabled = true;
  showBanner('info', `Checking ${file.name}…`);
  let out;
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-File-Name': encodeURIComponent(file.name) },
      body: file,
    });
    out = await res.json().catch(() => ({ ok: false, message: `Upload failed (HTTP ${res.status}).`, errors: [] }));
  } catch (err) {
    out = { ok: false, message: `Could not reach the server (${err.message}).`, errors: [] };
  }
  btn.disabled = false;

  if (!out.ok) {
    showBanner('error', out.message, out.errors);
    return;
  }
  sessionStorage.setItem(FLASH_KEY, JSON.stringify({ kind: 'success', message: `${file.name}: ${out.message}`, items: out.warnings }));
  location.reload();
}

export function showBanner(kind, message, items = []) {
  const box = el('banner');
  box.className = `banner ${kind}`;
  box.hidden = false;
  box.replaceChildren(
    icon(kind === 'success' ? 'ok' : kind === 'error' ? 'warning' : 'gap'),
    h('div', { class: 'banner-body' },
      h('b', {}, message),
      items?.length ? h('ul', {}, items.map((t) => h('li', {}, t))) : null,
    ),
    h('button', { class: 'banner-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => { box.hidden = true; } }, '×'),
  );
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
