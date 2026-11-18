/**
 * Export of one case as a ZIP file. See SPEC.md §11.
 *
 *   images/0001.png …   numbered screenshots
 *   records.csv         the evidence table
 *   records.xlsx        the same table for Excel
 *   deleted.csv         deleted records: seq, deletedAt, sha256
 *   audit-log.csv       the case's audit chain
 *   README.txt          how to verify, and the limits of the evidence
 *   hashes.txt          SHA-256 of every other file, in sha256sum format
 */
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { entryText, type AuditEntry } from './audit';
import { toCsv } from './csv';
import { sha256Hex } from './hash';
import { recordToRow, tableHeaders, type TableLabels } from './table';
import { formatFileStamp } from './time';
import type { EvidenceRecord } from './types';
import { buildXlsx, type Cell } from './xlsx';

export const IMAGES_DIR = 'images';

export const EXPORT_FILES = {
  csv: 'records.csv',
  xlsx: 'records.xlsx',
  deleted: 'deleted.csv',
  audit: 'audit-log.csv',
  readme: 'README.txt',
  hashes: 'hashes.txt',
} as const;

export interface ZipEntry {
  path: string;
  data: Uint8Array<ArrayBuffer>;
  /** PNG and XLSX files are already compressed and are stored as they are. */
  compress: boolean;
}

/** Above this size the collected chunks are folded into a Blob, which the browser can keep off the JS heap. */
const FOLD_BYTES = 16 * 1024 * 1024;

/** Writes entries into a ZIP one at a time, so only one image is in memory at once. */
export async function buildZip(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): Promise<Blob> {
  let parts: BlobPart[] = [];
  let looseBytes = 0;
  let failure: Error | null = null;

  const zip = new Zip((error, chunk) => {
    if (error) {
      failure = error;
      return;
    }
    parts.push(chunk as Uint8Array<ArrayBuffer>);
    looseBytes += chunk.length;
  });

  for await (const entry of entries) {
    const file = entry.compress
      ? new ZipDeflate(entry.path, { level: 6 })
      : new ZipPassThrough(entry.path);
    zip.add(file);
    file.push(entry.data, true);
    if (failure) throw failure;

    if (looseBytes > FOLD_BYTES) {
      parts = [new Blob(parts)];
      looseBytes = 0;
    }
  }

  zip.end();
  if (failure) throw failure;
  return new Blob(parts, { type: 'application/zip' });
}

const bySeq = (a: EvidenceRecord, b: EvidenceRecord): number => a.seq - b.seq;
const isActive = (record: EvidenceRecord): boolean => record.status === 'active';

/** The CSV table of a case: one row per active record, ordered by running number. */
export function recordsCsv(records: readonly EvidenceRecord[], labels: TableLabels): string {
  const rows = records.filter(isActive).sort(bySeq);
  return toCsv(
    tableHeaders(labels),
    rows.map((record) => recordToRow(record, labels)),
  );
}

/** Column widths of the table, in characters, in column order. */
const XLSX_WIDTHS = [8, 26, 22, 20, 12, 48, 24, 28, 28, 28, 18, 18, 40, 12, 68];

/** The same table as an XLSX file. The running number is a real number cell. */
export function recordsXlsx(
  records: readonly EvidenceRecord[],
  labels: TableLabels,
  sheet: { name: string; rightToLeft: boolean },
): Uint8Array {
  const rows = records.filter(isActive).sort(bySeq);
  return buildXlsx({
    name: sheet.name,
    rightToLeft: sheet.rightToLeft,
    headers: tableHeaders(labels),
    widths: XLSX_WIDTHS,
    rows: rows.map((record) => {
      const [, ...rest] = recordToRow(record, labels);
      return [record.seq, ...rest] satisfies Cell[];
    }),
  });
}

/** Deleted records: their number, when they were deleted, and the hash of their image. */
export function deletedCsv(records: readonly EvidenceRecord[]): string {
  const rows = records.filter((record) => !isActive(record)).sort(bySeq);
  return toCsv(
    ['seq', 'deletedAt', 'sha256'],
    rows.map((record) => [String(record.seq), record.deletedAt ?? '', record.image.sha256]),
  );
}

/**
 * The audit chain as a table. The `entry` column holds the exact text that
 * was hashed, so anyone can check a row with a SHA-256 tool and no knowledge
 * of the extension.
 */
export function auditCsv(entries: readonly AuditEntry[]): string {
  return toCsv(
    ['n', 'at', 'action', 'seq', 'imageSha256', 'prevHash', 'hash', 'entry'],
    entries.map((entry) => [
      String(entry.n),
      entry.at,
      entry.action,
      entry.seq === undefined ? '' : String(entry.seq),
      entry.imageSha256 ?? '',
      entry.prevHash,
      entry.hash,
      entryText(entry),
    ]),
  );
}

/** One line per file, as `sha256sum` writes and checks them. */
export function hashesTxt(files: ReadonlyArray<{ path: string; sha256: string }>): string {
  return files.map((file) => `${file.sha256}  ${file.path}\n`).join('');
}

export interface CaseExportInput {
  /** Every record of the case, deleted ones included. */
  records: readonly EvidenceRecord[];
  audit: readonly AuditEntry[];
  labels: TableLabels;
  sheet: { name: string; rightToLeft: boolean };
  /** Text of README.txt. */
  readme: string;
  /** Loads the stored PNG of a record. */
  loadImage: (fileId: string) => Promise<Blob | undefined>;
}

export interface CaseExportResult {
  blob: Blob;
  /** Running numbers of images that no longer match the hash stored at capture. */
  changedImages: number[];
}

export async function exportCase(input: CaseExportInput): Promise<CaseExportResult> {
  const active = input.records.filter(isActive).sort(bySeq);
  const hashed: Array<{ path: string; sha256: string }> = [];
  const changedImages: number[] = [];

  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const record of active) {
      const image = await input.loadImage(record.image.fileId);
      if (!image) throw new Error(`Image of record ${record.seq} is missing`);
      const data = new Uint8Array(await image.arrayBuffer());
      const path = `${IMAGES_DIR}/${record.image.fileName}`;
      // hashes.txt describes the file as exported, whatever the record claims.
      const sha256 = await sha256Hex(data);
      if (sha256 !== record.image.sha256) changedImages.push(record.seq);
      hashed.push({ path, sha256 });
      yield { path, data, compress: false };
    }

    const documents: ZipEntry[] = [
      { path: EXPORT_FILES.csv, data: strToU8(recordsCsv(input.records, input.labels)), compress: true },
      {
        path: EXPORT_FILES.xlsx,
        data: recordsXlsx(input.records, input.labels, input.sheet) as Uint8Array<ArrayBuffer>,
        compress: false,
      },
      { path: EXPORT_FILES.deleted, data: strToU8(deletedCsv(input.records)), compress: true },
      { path: EXPORT_FILES.audit, data: strToU8(auditCsv(input.audit)), compress: true },
      { path: EXPORT_FILES.readme, data: strToU8(input.readme), compress: true },
    ];
    for (const document of documents) {
      hashed.push({ path: document.path, sha256: await sha256Hex(document.data) });
      yield document;
    }

    yield { path: EXPORT_FILES.hashes, data: strToU8(hashesTxt(hashed)), compress: true };
  }

  return { blob: await buildZip(entries()), changedImages };
}

/** "<case-slug>_<YYYY-MM-DD_HHmm>.zip". Letters of any script are kept. */
export function exportFileName(caseTitle: string, epochMs: number, offsetMinutes: number): string {
  const slug =
    caseTitle
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'case';
  return `${slug}_${formatFileStamp(epochMs, offsetMinutes)}.zip`;
}
