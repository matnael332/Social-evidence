import { describe, expect, it } from 'vitest';
import { canonicalJson, type Json } from '../src/domain/canonicalJson';

describe('canonicalJson', () => {
  it('sorts object keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: true, c: null } })).toBe('{"a":{"c":null,"d":true},"b":1}');
  });

  it('gives the same text whatever order the keys were written in', () => {
    const one = canonicalJson({ seq: 7, action: 'capture', at: '2026-11-18T14:03:22+02:00' });
    const two = canonicalJson({ at: '2026-11-18T14:03:22+02:00', seq: 7, action: 'capture' });
    expect(one).toBe(two);
  });

  it('keeps the order of arrays', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('leaves out undefined properties', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('escapes strings the way JSON does', () => {
    expect(canonicalJson('he said "hi"\n')).toBe('"he said \\"hi\\"\\n"');
    expect(canonicalJson({ 'שם': 'ערך' })).toBe('{"שם":"ערך"}');
  });

  it('writes no whitespace', () => {
    expect(canonicalJson({ a: [1, { b: 'x y' }] })).toBe('{"a":[1,{"b":"x y"}]}');
  });

  it('can be parsed back to the same value', () => {
    const value: Json = { n: 3, list: ['a', 'b'], nested: { ok: true, none: null } };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });

  it('rejects values that JSON cannot hold', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson(undefined as unknown as Json)).toThrow(TypeError);
    expect(() => canonicalJson(new Date(0) as unknown as Json)).toThrow(TypeError);
    expect(() => canonicalJson((() => 1) as unknown as Json)).toThrow(TypeError);
  });
});
