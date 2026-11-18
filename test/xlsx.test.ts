import { strFromU8, unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { buildXlsx, columnName, sheetName, sheetXml, xmlText } from '../src/domain/xlsx';

/** Parses XML strictly; throws on anything that is not well-formed. */
function parseXml(xml: string): Document {
  return new JSDOM(xml, { contentType: 'application/xml' }).window.document;
}

const char = (code: number): string => String.fromCharCode(code);

describe('xmlText', () => {
  it('escapes the characters that have a meaning in XML', () => {
    expect(xmlText('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('escapes an ampersand before anything else', () => {
    expect(xmlText('&lt;')).toBe('&amp;lt;');
  });

  it('keeps Hebrew, emoji, tabs and line breaks', () => {
    expect(xmlText('שלום 🙂\tעולם\nשורה')).toBe('שלום 🙂\tעולם\nשורה');
  });

  it('removes characters XML does not allow', () => {
    expect(xmlText(`a${char(0)}b${char(8)}c${char(0x1f)}d`)).toBe('abcd');
    expect(xmlText(`a${char(0xfffe)}b${char(0xffff)}c`)).toBe('abc');
  });

  it('removes a lone surrogate but keeps a valid pair', () => {
    expect(xmlText(`a${char(0xd83d)}b`)).toBe('ab');
    expect(xmlText(`a${char(0xd83d)}${char(0xde42)}b`)).toBe('a🙂b');
  });
});

describe('columnName', () => {
  it('counts in letters', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
      'A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA',
    ]);
  });

  it('rejects an invalid index', () => {
    expect(() => columnName(-1)).toThrow(RangeError);
    expect(() => columnName(1.5)).toThrow(RangeError);
  });
});

describe('sheetName', () => {
  it('removes forbidden characters and limits the length', () => {
    expect(sheetName('a/b\\c:d*e?f[g]h')).toBe('a b c d e f g h');
    expect(sheetName('x'.repeat(50))).toHaveLength(31);
    expect(sheetName(' []: ')).toBe('Sheet1');
    expect(sheetName('רשומות')).toBe('רשומות');
  });
});

describe('sheetXml', () => {
  const sheet = {
    name: 'Records',
    headers: ['No.', 'Text'],
    rows: [
      [1, 'first'],
      [2, 'second'],
    ],
    rightToLeft: true,
  };

  it('is well-formed and holds every cell', () => {
    const doc = parseXml(sheetXml(sheet));
    const cells = [...doc.querySelectorAll('c')];
    expect(cells.map((cell) => cell.getAttribute('r'))).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    expect(doc.querySelectorAll('row')).toHaveLength(3);
  });

  it('writes numbers as numbers and text as inline strings', () => {
    const doc = parseXml(sheetXml(sheet));
    const a2 = doc.querySelector('c[r="A2"]');
    const b2 = doc.querySelector('c[r="B2"]');
    expect(a2?.getAttribute('t')).toBeNull();
    expect(a2?.querySelector('v')?.textContent).toBe('1');
    expect(b2?.getAttribute('t')).toBe('inlineStr');
    expect(b2?.querySelector('is > t')?.textContent).toBe('first');
  });

  it('freezes the header row and sets the direction', () => {
    const doc = parseXml(sheetXml(sheet));
    expect(doc.querySelector('sheetView')?.getAttribute('rightToLeft')).toBe('1');
    expect(doc.querySelector('pane')?.getAttribute('state')).toBe('frozen');
    expect(doc.querySelector('pane')?.getAttribute('ySplit')).toBe('1');
    expect(parseXml(sheetXml({ ...sheet, rightToLeft: false })).querySelector('sheetView')?.hasAttribute('rightToLeft')).toBe(false);
  });

  it('never turns text into a formula', () => {
    const doc = parseXml(sheetXml({ ...sheet, rows: [[1, '=HYPERLINK("https://example.org","x")']] }));
    const cell = doc.querySelector('c[r="B2"]');
    expect(cell?.getAttribute('t')).toBe('inlineStr');
    expect(cell?.querySelector('f')).toBeNull();
    expect(cell?.querySelector('is > t')?.textContent).toBe('=HYPERLINK("https://example.org","x")');
  });

  it('cannot be broken out of by page text', () => {
    const hostile = `</t></is></c><c r="Z9"><f>1+1</f></c>${char(0)}<!-- ]]> &`;
    const doc = parseXml(sheetXml({ ...sheet, headers: [hostile, 'Text'], rows: [[1, hostile]] }));
    expect(doc.querySelectorAll('c')).toHaveLength(4);
    expect(doc.querySelector('f')).toBeNull();
    expect(doc.querySelector('c[r="B2"] is > t')?.textContent).toBe(hostile.replace(char(0), ''));
  });

  it('rejects a row of the wrong width and a number that is not finite', () => {
    expect(() => sheetXml({ ...sheet, rows: [[1]] })).toThrow(RangeError);
    expect(() => sheetXml({ ...sheet, rows: [[Number.NaN, 'x']] })).toThrow(RangeError);
  });
});

describe('buildXlsx', () => {
  const files = unzipSync(
    buildXlsx({ name: 'רשומות', headers: ['מספר', 'הערות'], rows: [[1, 'ראשון']], rightToLeft: true }),
  );

  it('contains the parts a spreadsheet program needs', () => {
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('has well-formed XML in every part', () => {
    for (const [path, data] of Object.entries(files)) {
      expect(() => parseXml(strFromU8(data)), path).not.toThrow();
    }
  });

  it('names the sheet and links it to the workbook', () => {
    const workbook = parseXml(strFromU8(files['xl/workbook.xml']!));
    expect(workbook.querySelector('sheet')?.getAttribute('name')).toBe('רשומות');
    const rels = parseXml(strFromU8(files['xl/_rels/workbook.xml.rels']!));
    expect([...rels.querySelectorAll('Relationship')].map((rel) => rel.getAttribute('Target'))).toEqual([
      'worksheets/sheet1.xml',
      'styles.xml',
    ]);
  });
});
