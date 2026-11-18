import { describe, expect, it } from 'vitest';
import { emptyExtraction, sanitizeExtracted, sanitizeText } from '../src/adapters/sanitize';

const char = (code: number): string => String.fromCharCode(code);

describe('sanitizeText', () => {
  it('keeps ordinary text, including Hebrew and emoji', () => {
    expect(sanitizeText('Invented Person', 200)).toBe('Invented Person');
    expect(sanitizeText('שם בדוי 🙂', 200)).toBe('שם בדוי 🙂');
  });

  it('collapses whitespace and line breaks into single spaces', () => {
    expect(sanitizeText('  a \n\n b\t\tc  ', 200)).toBe('a b c');
  });

  it('removes control characters', () => {
    expect(sanitizeText(`a${char(0)}b${char(7)}c${char(0x1b)}[31m${char(0x9f)}d`, 200)).toBe('a b c [31m d');
  });

  it('removes characters that reverse the direction of the text', () => {
    // "evil" + right-to-left override + "gpj.exe" would display as "evilexe.jpg".
    const spoofed = `evil${char(0x202e)}gpj.exe`;
    expect(sanitizeText(spoofed, 200)).toBe('evilgpj.exe');
    expect(sanitizeText(`a${char(0x2066)}b${char(0x2069)}c${char(0x202a)}d${char(0x202c)}`, 200)).toBe('abcd');
  });

  it('cuts text that is too long, by characters and not by half an emoji', () => {
    expect(sanitizeText('x'.repeat(500), 200)).toHaveLength(200);
    expect(sanitizeText('🙂🙂🙂🙂', 3)).toBe('🙂🙂🙂');
  });

  it('turns anything that is not a string into nothing', () => {
    for (const value of [null, undefined, 42, true, {}, [], () => 'x', { toString: () => 'x' }]) {
      expect(sanitizeText(value, 200)).toBe('');
    }
  });
});

describe('sanitizeExtracted', () => {
  it('passes a well-formed extraction through', () => {
    expect(
      sanitizeExtracted(
        {
          adapter: 'website',
          adapterVersion: '1',
          values: {
            publisher: 'Invented Person',
            groupOrPage: 'Invented Site',
            publishedAtText: 'yesterday at 14:20',
            publishedAt: '2026-11-17T14:20',
          },
        },
        'website',
      ),
    ).toEqual({
      adapter: 'website',
      adapterVersion: '1',
      values: {
        publisher: 'Invented Person',
        groupOrPage: 'Invented Site',
        publishedAtText: 'yesterday at 14:20',
        publishedAt: '2026-11-17T14:20',
      },
    });
  });

  it('uses the platform the extension detected, not the one the page claims', () => {
    const result = sanitizeExtracted({ adapter: 'facebook', adapterVersion: '1', values: {} }, 'website');
    expect(result.adapter).toBe('website');
  });

  it('drops fields it does not know', () => {
    const result = sanitizeExtracted(
      {
        adapter: 'website',
        adapterVersion: '1',
        values: { publisher: 'Invented Person', url: 'https://evil.example/', notes: 'x', __proto__: { polluted: true } },
      },
      'website',
    );
    expect(result.values).toEqual({ publisher: 'Invented Person' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops values that are not strings and values that end up empty', () => {
    const result = sanitizeExtracted(
      {
        adapter: 'website',
        adapterVersion: '1',
        values: { publisher: { name: 'x' }, groupOrPage: ['a'], publishedAtText: `  ${char(0)}  ` },
      },
      'website',
    );
    expect(result.values).toEqual({});
  });

  it('accepts a normalized date only in its two exact forms', () => {
    const date = (publishedAt: unknown) =>
      sanitizeExtracted({ adapter: 'website', adapterVersion: '1', values: { publishedAt } }, 'website').values.publishedAt;
    expect(date('2026-11-17')).toBe('2026-11-17');
    expect(date('2026-11-17T14:20')).toBe('2026-11-17T14:20');
    expect(date('17/11/2026')).toBeUndefined();
    expect(date('2026-11-17T14:20:00Z')).toBeUndefined();
    expect(date('<img src=x onerror=alert(1)>')).toBeUndefined();
  });

  it('keeps markup as plain text; it is never interpreted', () => {
    const result = sanitizeExtracted(
      { adapter: 'website', adapterVersion: '1', values: { publisher: '<script>alert(1)</script>' } },
      'website',
    );
    expect(result.values.publisher).toBe('<script>alert(1)</script>');
  });

  it('limits the length of every field', () => {
    const long = 'x'.repeat(5000);
    const { values } = sanitizeExtracted(
      { adapter: 'website', adapterVersion: '1', values: { publisher: long, groupOrPage: long, publishedAtText: long } },
      'website',
    );
    expect(values.publisher).toHaveLength(200);
    expect(values.groupOrPage).toHaveLength(200);
    expect(values.publishedAtText).toHaveLength(120);
  });

  it('ignores an odd adapter version', () => {
    const version = (adapterVersion: unknown) =>
      sanitizeExtracted({ adapter: 'website', adapterVersion, values: {} }, 'website').adapterVersion;
    expect(version('2.1')).toBe('2.1');
    expect(version('x'.repeat(50))).toBe('0');
    expect(version('<b>')).toBe('0');
    expect(version(3)).toBe('0');
  });

  it('returns an empty extraction for anything that is not an extraction', () => {
    for (const raw of [null, undefined, 'text', 7, [], { adapter: 'unknown', values: { publisher: 'x' } }, { adapter: 'website', values: 'x' }]) {
      expect(sanitizeExtracted(raw, 'tiktok').values).toEqual({});
      expect(sanitizeExtracted(raw, 'tiktok').adapter).toBe('tiktok');
    }
    expect(emptyExtraction('instagram')).toEqual({ adapter: 'instagram', adapterVersion: '0', values: {} });
  });
});
