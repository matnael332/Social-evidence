/**
 * Export of one case as a ZIP file. See SPEC.md §11.
 *
 * Stage 2 writes the numbered images and the CSV table. The XLSX table, the
 * hash list and the audit log join in stage 3.
 */
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { toCsv } from './csv';
import { recordToRow, tableHeaders, type TableLabels } from './table';
import { formatFileStamp } from './time';
import type { EvidenceRecord } from './types';

export const IMAGES_DIR = 'images';
export const CSV_FILE = 'records.csv';

export interface ZipEntry {
  path: string;
  data: Uint8Array;
  /** PNG files are already compressed and are stored as they are. */
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

/** The CSV table of a case: one row per record, ordered by running number. */
export function recordsCsv(records: readonly EvidenceRecord[], labels: TableLabels): string {
  const ordered = [...records].sort((a, b) => a.seq - b.seq);
  return toCsv(
    tableHeaders(labels),
    ordered.map((record) => recordToRow(record, labels)),
  );
}

export interface CaseExportInput {
  /** Active records of the case. */
  records: readonly EvidenceRecord[];
  labels: TableLabels;
  /** Loads the stored PNG of a record. */
  loadImage: (fileId: string) => Promise<Blob | undefined>;
}

export async function exportCase(input: CaseExportInput): Promise<Blob> {
  const ordered = [...input.records].sort((a, b) => a.seq - b.seq);

  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const record of ordered) {
      const image = await input.loadImage(record.image.fileId);
      if (!image) throw new Error(`Image of record ${record.seq} is missing`);
      yield {
        path: `${IMAGES_DIR}/${record.image.fileName}`,
        data: new Uint8Array(await image.arrayBuffer()),
        compress: false,
      };
    }
    yield { path: CSV_FILE, data: strToU8(recordsCsv(ordered, input.labels)), compress: true };
  }

  return buildZip(entries());
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
