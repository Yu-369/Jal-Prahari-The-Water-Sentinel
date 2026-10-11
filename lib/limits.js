// CPCB water-quality criteria, read from data/cpcb_water_quality_criteria.csv.
// Immersion ghats are judged against Class B (outdoor bathing, organised): people
// bathe and take holy dips at these ghats during visarjan.

const PARAM_KEY = {
  'Dissolved oxygen': 'DO',
  'BOD (5 days 20C)': 'BOD',
  pH: 'pH',
  'Electrical conductivity at 25C': 'COND',
};

export function buildRules(criteria, cls = 'B') {
  const rules = {};
  for (const c of criteria) {
    if (c.class !== cls) continue;
    const key = PARAM_KEY[c.parameter];
    if (!key) continue; // e.g. total coliform: not measured in the MPPCB visarjan reports
    if (c.limit_type === 'range') {
      const [min, max] = c.limit.split('-').map(Number);
      rules[key] = { type: 'range', min, max, text: `${min} to ${max}`, short: `${min}–${max}` };
    } else {
      const limit = Number(c.limit);
      const sign = c.limit_type === 'min' ? '≥' : '≤';
      rules[key] = { type: c.limit_type, limit, text: `${sign} ${limit}${c.unit ? ' ' + c.unit : ''}`, short: `${sign} ${limit}` };
    }
    rules[key].cls = cls;
    rules[key].use = c.designated_best_use;
  }
  return rules;
}

// Class B parameters that exist in the CPCB file but were never measured by MPPCB.
export function unmeasuredClassB(criteria) {
  return criteria.filter((c) => c.class === 'B' && !PARAM_KEY[c.parameter]).map((c) => c.parameter);
}

/**
 * Check one reading against a rule set. Returns:
 *   result: 'pass' | 'fail' | 'missing' | 'unknown' | 'info' (no limit for this parameter)
 * BDL is "very low": it passes a maximum limit, fails a minimum limit, and is
 * unknown against a range. Missing is never a pass.
 */
export function checkReading(r, rules) {
  const rule = rules[r.param];
  if (!rule) return { result: r.status === 'missing' ? 'missing' : 'info' };
  if (r.status === 'missing') return { result: 'missing' };
  if (r.status === 'bdl') {
    if (rule.type === 'max') return { result: 'pass' };
    if (rule.type === 'min') return { result: 'fail' };
    return { result: 'unknown' };
  }
  const v = r.value;
  let ok;
  if (rule.type === 'min') ok = v >= rule.limit;
  else if (rule.type === 'max') ok = v <= rule.limit;
  else ok = v >= rule.min && v <= rule.max;
  return { result: ok ? 'pass' : 'fail' };
}
