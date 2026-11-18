/**
 * Canonical JSON: one text for one value, whatever order its keys were
 * written in. The audit log hashes this text, so it must never vary.
 *
 * Rules: object keys sorted by code unit, no whitespace, `undefined`
 * properties left out, and only plain JSON values accepted.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

export function canonicalJson(value: Json): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot hold NaN or Infinity');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as Json)}`).join(',')}}`;
  }
  throw new TypeError(`Canonical JSON cannot hold a value of type ${typeof value}`);
}
