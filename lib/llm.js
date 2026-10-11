// Optional AI layer. OFF by default.
//
// Leave the provider variables blank and every feature runs on the built-in
// engine (plain code, no network). To switch AI on later, set a provider per role
// in .env:
//   FAST_AI_PROVIDER    Q&A bar and per-ghat summaries (needs low latency)
//   WRITER_AI_PROVIDER  prose for the bilingual deployment brief
// Providers: "cerebras" (CEREBRAS_API_KEY) or "anthropic" (ANTHROPIC_API_KEY).
//
// AI only ever writes words. Ranking, limit checks and every table are computed in
// code, and every number an AI writes is checked against the facts it was given.

import Anthropic from '@anthropic-ai/sdk';

const ROLE_ENV = { fast: 'FAST_AI_PROVIDER', writer: 'WRITER_AI_PROVIDER' };

const PROVIDERS = {
  cerebras: {
    keyEnv: 'CEREBRAS_API_KEY',
    model: () => process.env.CEREBRAS_MODEL || 'llama-4-scout-17b-16e-instruct',
    call: callCerebras,
  },
  anthropic: {
    keyEnv: 'ANTHROPIC_API_KEY',
    model: () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    call: callAnthropic,
  },
};

export class AIUnavailable extends Error {}

export function roleConfig(role) {
  const name = (process.env[ROLE_ENV[role]] || '').trim().toLowerCase();
  if (!name) return { enabled: false, provider: null, reason: 'not configured' };
  const p = PROVIDERS[name];
  if (!p) return { enabled: false, provider: name, reason: `unknown provider "${name}"` };
  if (!process.env[p.keyEnv]) return { enabled: false, provider: name, reason: `${p.keyEnv} is empty` };
  return { enabled: true, provider: name, model: p.model() };
}

export function aiStatus() {
  return { fast: roleConfig('fast'), writer: roleConfig('writer') };
}

/**
 * Run one completion for a role. `schema` (JSON Schema) asks for a JSON object.
 * Returns { text, provider, model, ms, serverMs }.
 */
export async function complete(role, { system, user, maxTokens = 1024, schema = null }) {
  const cfg = roleConfig(role);
  if (!cfg.enabled) throw new AIUnavailable(`AI for "${role}" is off (${cfg.reason})`);
  const t0 = performance.now();
  const out = await PROVIDERS[cfg.provider].call({ model: cfg.model, system, user, maxTokens, schema });
  return { ...out, provider: cfg.provider, model: cfg.model, ms: Math.round(performance.now() - t0) };
}

// Cerebras serves an OpenAI-style chat completions endpoint.
async function callCerebras({ model, system, user, maxTokens, schema }) {
  const base = process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: schema ? `${system}\n\nReply with one JSON object only, matching this JSON Schema:\n${JSON.stringify(schema)}` : system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTokens,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Cerebras ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const total = data.time_info?.total_time;
  return { text: data.choices?.[0]?.message?.content ?? '', serverMs: total ? Math.round(total * 1000) : null };
}

let anthropic;
async function callAnthropic({ model, system, user, maxTokens, schema }) {
  anthropic ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  try {
    const res = await anthropic.beta.messages.create({
      model,
      max_tokens: Math.max(maxTokens, 16000), // adaptive thinking shares this budget
      // Server-side fallback: if a safety classifier declines, the API retries on
      // Anthropic's recommended fallback model instead of returning a refusal.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') throw new Error('The model declined this request.');
    if (res.stop_reason === 'max_tokens') throw new Error('The model ran out of output tokens.');
    return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), serverMs: null };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Anthropic: invalid ANTHROPIC_API_KEY.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Anthropic: rate limited, try again shortly.');
    if (err instanceof Anthropic.APIError) throw new Error(`Anthropic API error ${err.status}: ${err.message}`);
    throw err;
  }
}

// Lenient JSON extraction for providers that may wrap JSON in prose or fences.
export function parseJSON(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI reply had no JSON object.');
  return JSON.parse(m[0]);
}
