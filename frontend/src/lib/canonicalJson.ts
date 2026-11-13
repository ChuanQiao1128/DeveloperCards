/** Stable JSON object keys for comparisons; array order and values are preserved. */
export function canonicalizeJson(val: unknown): unknown {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(canonicalizeJson);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(val as Record<string, unknown>).sort()) {
    out[k] = canonicalizeJson((val as Record<string, unknown>)[k]);
  }
  return out;
}
