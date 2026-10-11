// The Q&A bar. Answers come from the server: the built-in engine by default, or
// an AI model if one is configured. Response time is always shown.

import { state, h, el, api, rich, icon } from './util.js';

const PROVIDER = { cerebras: 'Cerebras', anthropic: 'Claude' };

const SUGGESTIONS = [
  'Which ghat is most at risk?',
  'Where should aeration go first?',
  'Where is data missing?',
  'Which ghat had zero oxygen?',
  'Is Shahpura getting worse?',
  'सबसे ख़तरनाक घाट कौन सा है?',
];

export function initAsk() {
  const ai = state.status.ai.fast;
  const pill = el('engine-pill');
  if (ai.enabled) {
    pill.className = 'engine-pill ai';
    pill.replaceChildren(icon('bolt'), ` ${PROVIDER[ai.provider] ?? ai.provider}`);
    pill.title = `Answers written by ${ai.model}; every number is checked against the data.`;
  } else {
    pill.textContent = 'Built-in engine · AI off';
    pill.title = 'Answers are computed directly from the readings. No AI is configured.';
  }

  el('ask-chips').replaceChildren(...SUGGESTIONS.map((q) => chip(q)));
  el('ask-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = el('ask-input').value.trim();
    if (q) askQuestion(q);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && !document.activeElement?.isContentEditable) {
      e.preventDefault();
      el('ask-input').focus();
    }
    if (e.key === 'Escape' && !el('answer').hidden && el('brief').hidden) el('answer').hidden = true;
  });
}

function chip(q) {
  const hi = /[ऀ-ॿ]/.test(q);
  return h('button', { class: 'chip', type: 'button', lang: hi ? 'hi' : null, onclick: () => askQuestion(q) }, q);
}

export async function askQuestion(question, { ghatId } = {}) {
  const input = el('ask-input');
  const box = el('answer');
  input.value = question;
  box.hidden = false;
  const hi = /[ऀ-ॿ]/.test(question);
  const qEl = h('span', { class: 'answer-q', lang: hi ? 'hi' : null }, question);
  box.replaceChildren(h('div', { class: 'answer-head' }, qEl, h('span', { class: 'thinking' }, h('i'), h('i'), h('i')), closeBtn()));
  el('ask-btn').disabled = true;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const t0 = performance.now();
  let res;
  try {
    res = await api('/api/ask', { question, ghatId: ghatId ?? state.selected });
  } catch (err) {
    box.replaceChildren(h('div', { class: 'answer-head' }, qEl, closeBtn()), h('div', { class: 'notice' }, `Could not reach the server (${err.message}). The page data is still valid.`));
    el('ask-btn').disabled = false;
    return;
  }
  const roundTrip = Math.round(performance.now() - t0);
  el('ask-btn').disabled = false;

  const engine = res.engine === 'built-in'
    ? h('span', {}, `Built-in engine · answered in ${res.ms} ms · no AI`)
    : h('span', { class: 'speed', title: res.serverMs ? `Model time ${res.serverMs} ms · round trip ${roundTrip} ms` : `Round trip ${roundTrip} ms` },
      icon('bolt'), `${PROVIDER[res.engine] ?? res.engine} · ${res.model} · ${res.ms} ms`);

  const body = h('div', { class: 'answer-body', lang: res.lang === 'hi' ? 'hi' : null }, res.blocks.map(block));
  const foot = h('div', { class: 'answer-foot' },
    res.verification ? verification(res.verification) : null,
    res.aiError ? h('span', { class: 'notice' }, `AI unavailable (${res.aiError}). Showing the built-in answer.`) : null,
    (res.followUps || []).map((q) => chip(q)),
  );
  box.replaceChildren(h('div', { class: 'answer-head' }, qEl, engine, closeBtn()), body, foot);
}

function verification(v) {
  if (!v.unmatched.length) return h('span', { class: 'verify ok' }, icon('ok'), v.total ? `All ${v.total} numbers match the source data` : 'No numbers to check');
  return h('span', { class: 'verify bad' }, icon('warning'), `Not found in the data: ${v.unmatched.join(', ')}. Check before using this answer.`);
}

function closeBtn() {
  return h('button', { class: 'answer-close', type: 'button', 'aria-label': 'Close answer', onclick: () => { el('answer').hidden = true; } }, '×');
}

function block(b) {
  if (b.type === 'p') return h('p', {}, rich(b.text));
  if (b.type === 'list') return h('ul', {}, b.items.map((t) => h('li', {}, rich(t))));
  if (b.type === 'table') {
    return h('div', { style: 'overflow-x:auto' }, h('table', {},
      h('thead', {}, h('tr', {}, b.head.map((t) => h('th', {}, t)))),
      h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, rich(c)))))),
    ));
  }
  return null;
}
