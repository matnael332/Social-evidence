import { describe, expect, it } from 'vitest';
import { escapeCsvCell, guardFormula, toCsv } from '../src/domain/csv';

const BOM = String.fromCharCode(0xfeff);

describe('escapeCsvCell', () => {
  it('leaves plain text alone', () => {
    expect(escapeCsvCell('plain text')).toBe('plain text');
    expect(escapeCsvCell('')).toBe('');
    expect(escapeCsvCell('שלום עולם')).toBe('שלום עולם');
  });

  it('quotes cells with commas, quotes or line breaks', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line one\nline two')).toBe('"line one\nline two"');
    expect(escapeCsvCell('line one\r\nline two')).toBe('"line one\r\nline two"');
  });
});

describe('guardFormula', () => {
  it.each(['=1+1', '+972501234567', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])(
    'neutralizes %j',
    (value) => {
      expect(guardFormula(value)).toBe(`'${value}`);
    },
  );

  it('leaves ordinary text and numbers alone', () => {
    expect(guardFormula('12')).toBe('12');
    expect(guardFormula('a=b')).toBe('a=b');
    expect(guardFormula('https://example.org/?a=1')).toBe('https://example.org/?a=1');
    expect(guardFormula('')).toBe('');
  });

  it('is applied before quoting', () => {
    expect(escapeCsvCell('=HYPERLINK("https://example.org","x")')).toBe(
      '"\'=HYPERLINK(""https://example.org"",""x"")"',
    );
  });
});

describe('toCsv', () => {
  it('starts with a UTF-8 byte order mark', () => {
    const csv = toCsv(['a'], [['1']]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('writes a header row and CRLF line endings', () => {
    expect(toCsv(['מספר', 'הערות'], [['1', 'ראשון'], ['2', 'שני']])).toBe(
      `${BOM}מספר,הערות\r\n1,ראשון\r\n2,שני\r\n`,
    );
  });

  it('writes only the header for an empty table', () => {
    expect(toCsv(['a', 'b'], [])).toBe(`${BOM}a,b\r\n`);
  });

  it('keeps Hebrew text with punctuation in one cell', () => {
    const csv = toCsv(['הערות'], [['הוא אמר: "שלום", והלך']]);
    expect(csv).toBe(`${BOM}הערות\r\n"הוא אמר: ""שלום"", והלך"\r\n`);
  });

  it('rejects a row of the wrong width', () => {
    expect(() => toCsv(['a', 'b'], [['only one']])).toThrow(RangeError);
  });
});
