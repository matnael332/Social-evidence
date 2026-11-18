import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { sealEntry, type AuditEntry } from '../src/domain/audit';
import {
  auditCsv,
  buildZip,
  deletedCsv,
  exportCase,
  exportFileName,
  hashesTxt,
  recordsCsv,
} from '../src/domain/export';
import { sha256Hex } from '../src/domain/hash';
import { TABLE_COLUMNS, recordToRow, tableHeaders } from '../src/domain/table';
import { EMPTY_AUDIT_HEAD } from '../src/domain/types';
import { LABELS, makeRecord } from './fixtures';

const BOM = String.fromCharCode(0xfeff);
const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));
const sha = (bytes: number[]): Promise<string> => sha256Hex(new Uint8Array(bytes));

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

  it('orders the table by running number and leaves deleted records out', () => {
    const csv = recordsCsv(
      [makeRecord(3), makeRecord(1), makeRecord(2, { status: 'deleted' }), makeRecord(4)],
      LABELS,
    );
    const firstCells = csv
      .replace(BOM, '')
      .split('\r\n')
      .filter((line) => /^\d+,/.test(line))
      .map((line) => line.split(',')[0]);
    expect(firstCells).toEqual(['1', '3', '4']);
  });
});

describe('deletedCsv', () => {
  it('lists deleted records with their number, time and image hash', () => {
    const csv = deletedCsv([
      makeRecord(1),
      makeRecord(5, { status: 'deleted', deletedAt: '2026-11-19T09:00:00+02:00' }),
      makeRecord(2, { status: 'deleted', deletedAt: '2026-11-18T18:00:00+02:00' }),
    ]);
    expect(csv).toBe(
      `${BOM}seq,deletedAt,sha256\r\n` +
        `2,2026-11-18T18:00:00+02:00,${'a'.repeat(64)}\r\n` +
        `5,2026-11-19T09:00:00+02:00,${'a'.repeat(64)}\r\n`,
    );
  });

  it('has only the header when nothing was deleted', () => {
    expect(deletedCsv([makeRecord(1)])).toBe(`${BOM}seq,deletedAt,sha256\r\n`);
  });
});

describe('auditCsv', () => {
  it('lets a reader check each row with nothing but SHA-256', async () => {
    const first = await sealEntry({
      caseId: 'case-1',
      n: 1,
      at: '2026-11-18T14:00:00+02:00',
      action: 'case.create',
      details: { title: 'Case, "one"' },
      prevHash: EMPTY_AUDIT_HEAD,
    });
    const csv = auditCsv([first]);
    const [, row = ''] = csv.replace(BOM, '').split('\r\n');

    // The last cell is the quoted `entry` column; undo the CSV quoting.
    const quoted = row.slice(row.indexOf(',"{') + 1);
    const entry = quoted.slice(1, -1).replaceAll('""', '"');
    expect(await sha256Hex(new TextEncoder().encode(entry))).toBe(first.hash);
    expect(JSON.parse(entry)).toMatchObject({ n: 1, action: 'case.create', prevHash: EMPTY_AUDIT_HEAD });
    expect(row.startsWith(`1,2026-11-18T14:00:00+02:00,case.create,,,${EMPTY_AUDIT_HEAD},${first.hash},`)).toBe(true);
  });
});

describe('hashesTxt', () => {
  it('uses the format of sha256sum', () => {
    expect(
      hashesTxt([
        { path: 'images/0001.png', sha256: 'a'.repeat(64) },
        { path: 'records.csv', sha256: 'b'.repeat(64) },
      ]),
    ).toBe(`${'a'.repeat(64)}  images/0001.png\n${'b'.repeat(64)}  records.csv\n`);
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
  const images = new Map<string, number[]>([
    ['file-1', [10, 11]],
    ['file-2', [20, 21, 22]],
    ['file-3', [30]],
  ]);
  const loadImage = async (fileId: string): Promise<Blob | undefined> => {
    const bytes = images.get(fileId);
    return bytes ? new Blob([new Uint8Array(bytes)], { type: 'image/png' }) : undefined;
  };

  async function fixture() {
    const records = [
      makeRecord(2, { image: { ...makeRecord(2).image, sha256: await sha([20, 21, 22]) } }),
      makeRecord(1, { image: { ...makeRecord(1).image, sha256: await sha([10, 11]) } }),
      makeRecord(3, { status: 'deleted', deletedAt: '2026-11-18T18:00:00+02:00' }),
    ];
    const audit: AuditEntry[] = [
      await sealEntry({
        caseId: 'case-1',
        n: 1,
        at: '2026-11-18T14:00:00+02:00',
        action: 'case.create',
        prevHash: EMPTY_AUDIT_HEAD,
      }),
    ];
    return { records, audit, labels: LABELS, sheet: { name: 'Records', rightToLeft: false }, readme: 'README text', loadImage };
  }

  it('writes every file of the export', async () => {
    const result = await exportCase(await fixture());
    const files = await unzip(result.blob);
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'audit-log.csv',
      'deleted.csv',
      'hashes.txt',
      'images/0001.png',
      'images/0002.png',
      'records.csv',
      'records.xlsx',
    ]);
    expect(result.changedImages).toEqual([]);
  });

  it('numbers the images to match the table and leaves deleted records out', async () => {
    const files = await unzip((await exportCase(await fixture())).blob);
    expect([...files['images/0001.png']!]).toEqual([10, 11]);
    expect([...files['images/0002.png']!]).toEqual([20, 21, 22]);
    expect(files['images/0003.png']).toBeUndefined();

    // Checked on the raw bytes: text decoders drop a leading byte order mark.
    expect([...files['records.csv']!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = strFromU8(files['records.csv']!);
    expect(csv).toContain(',0001.png,');
    expect(csv).toContain(',0002.png,');
    expect(csv).not.toContain(',0003.png,');
    expect(strFromU8(files['deleted.csv']!)).toContain('3,2026-11-18T18:00:00+02:00,');
  });

  it('lists the hash of every other file in hashes.txt', async () => {
    const files = await unzip((await exportCase(await fixture())).blob);
    const lines = strFromU8(files['hashes.txt']!).trimEnd().split('\n');
    const listed = new Map(lines.map((line) => [line.slice(66), line.slice(0, 64)]));

    expect([...listed.keys()].sort()).toEqual(
      Object.keys(files).filter((path) => path !== 'hashes.txt').sort(),
    );
    for (const [path, hash] of listed) {
      expect(await sha256Hex(new Uint8Array(files[path]!)), path).toBe(hash);
    }
    for (const line of lines) expect(line).toMatch(/^[0-9a-f]{64}  \S+$/);
  });

  it('includes a spreadsheet with the same rows', async () => {
    const files = await unzip((await exportCase(await fixture())).blob);
    const sheet = strFromU8(unzipSync(files['records.xlsx']!)['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('0001.png');
    expect(sheet).toContain('0002.png');
    expect(sheet).not.toContain('0003.png');
  });

  it('reports an image that no longer matches the hash stored at capture', async () => {
    const input = await fixture();
    input.records[0] = makeRecord(2, { image: { ...makeRecord(2).image, sha256: 'f'.repeat(64) } });
    const result = await exportCase(input);
    expect(result.changedImages).toEqual([2]);
    // hashes.txt still describes the file as it was exported.
    const hashes = strFromU8((await unzip(result.blob))['hashes.txt']!);
    expect(hashes).toContain(`${await sha([20, 21, 22])}  images/0002.png`);
  });

  it('fails loudly when an image is missing', async () => {
    const input = await fixture();
    input.records.push(makeRecord(5));
    await expect(exportCase(input)).rejects.toThrow(/record 5/);
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
