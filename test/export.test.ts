import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildZip, exportCase, exportFileName, recordsCsv } from '../src/domain/export';
import { TABLE_COLUMNS, recordToRow, tableHeaders } from '../src/domain/table';
import { LABELS, makeRecord } from './fixtures';

const BOM = String.fromCharCode(0xfeff);
const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe('evidence table', () => {
  it('has the agreed columns in the agreed order', () => {
    expect(TABLE_COLUMNS).toEqual([
      'seq',
      'capturedAt',
      'publishedAtText',
      'publishedAt',
      'platform',
      'url',
      'publisher',
      'echoes',
      'groupOrPage',
      'groupAdmins',
      'keyword',
      'recordType',
      'notes',
      'fileName',
      'sha256',
    ]);
    expect(tableHeaders(LABELS)).toHaveLength(TABLE_COLUMNS.length);
  });

  it('turns a record into one row', () => {
    const record = makeRecord(7, { recordType: 'profile', echoes: 'Invented Sharer' });
    expect(recordToRow(record, LABELS)).toEqual([
      '7',
      '2026-11-18T14:03:22+02:00',
      'yesterday at 14:20',
      '2026-11-17T14:20',
      'Website',
      'https://social.example/groups/demo/posts/123',
      'Invented Person',
      'Invented Sharer',
      'Invented Group',
      'Invented Admin One\nInvented Admin Two',
      'sample keyword',
      'Profile',
      '',
      '0007.png',
      'a'.repeat(64),
    ]);
  });

  it('orders the table by running number', () => {
    const csv = recordsCsv([makeRecord(3), makeRecord(1), makeRecord(2)], LABELS);
    const firstCells = csv
      .replace(BOM, '')
      .split('\r\n')
      .filter((line) => /^\d+,/.test(line))
      .map((line) => line.split(',')[0]);
    expect(firstCells).toEqual(['1', '2', '3']);
  });
});

describe('buildZip', () => {
  it('stores every entry under its path', async () => {
    const files = await unzip(
      await buildZip([
        { path: 'images/0001.png', data: new Uint8Array([1, 2, 3]), compress: false },
        { path: 'records.csv', data: new TextEncoder().encode('a,b\r\n'), compress: true },
      ]),
    );
    expect(Object.keys(files).sort()).toEqual(['images/0001.png', 'records.csv']);
    expect([...files['images/0001.png']!]).toEqual([1, 2, 3]);
    expect(strFromU8(files['records.csv']!)).toBe('a,b\r\n');
  });

  it('produces a valid archive with no entries', async () => {
    expect(Object.keys(await unzip(await buildZip([])))).toEqual([]);
  });
});

describe('exportCase', () => {
  const images = new Map<string, Uint8Array<ArrayBuffer>>([
    ['file-1', new Uint8Array([10, 11])],
    ['file-2', new Uint8Array([20, 21, 22])],
  ]);
  const loadImage = async (fileId: string): Promise<Blob | undefined> => {
    const bytes = images.get(fileId);
    return bytes ? new Blob([bytes], { type: 'image/png' }) : undefined;
  };

  it('writes numbered images that match the table', async () => {
    const records = [makeRecord(2), makeRecord(1)];
    const files = await unzip(await exportCase({ records, labels: LABELS, loadImage }));

    expect(Object.keys(files).sort()).toEqual(['images/0001.png', 'images/0002.png', 'records.csv']);
    expect([...files['images/0001.png']!]).toEqual([10, 11]);
    expect([...files['images/0002.png']!]).toEqual([20, 21, 22]);

    // Checked on the raw bytes: text decoders drop a leading byte order mark.
    expect([...files['records.csv']!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = strFromU8(files['records.csv']!);
    expect(csv).toContain(',0001.png,');
    expect(csv).toContain(',0002.png,');
  });

  it('fails loudly when an image is missing', async () => {
    const records = [makeRecord(1), makeRecord(5)];
    await expect(exportCase({ records, labels: LABELS, loadImage })).rejects.toThrow(/record 5/);
  });
});

describe('exportFileName', () => {
  const at = Date.UTC(2026, 10, 18, 12, 3, 22);

  it('joins the case name and a timestamp', () => {
    expect(exportFileName('Case 1', at, 120)).toBe('Case-1_2026-11-18_1403.zip');
  });

  it('keeps Hebrew letters', () => {
    expect(exportFileName('תיק 1', at, 120)).toBe('תיק-1_2026-11-18_1403.zip');
  });

  it('removes characters that are unsafe in file names', () => {
    expect(exportFileName('  a/b\\c: "d" <e>|?* ', at, 0)).toBe('a-b-c-d-e_2026-11-18_1203.zip');
  });

  it('falls back to a generic name', () => {
    expect(exportFileName(' /// ', at, 0)).toBe('case_2026-11-18_1203.zip');
  });
});
