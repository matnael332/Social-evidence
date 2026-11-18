import { platformName } from '../platform/detect';
import type { EvidenceRecord, RecordType } from './types';

/**
 * The evidence table: one row per record, in a fixed column order.
 * Header texts and record-type names come from the locale, so this module
 * holds no user-facing strings.
 */
export const TABLE_COLUMNS = [
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
] as const;

export type TableColumn = (typeof TABLE_COLUMNS)[number];

export interface TableLabels {
  columns: Record<TableColumn, string>;
  recordTypes: Record<RecordType, string>;
}

export function tableHeaders(labels: TableLabels): string[] {
  return TABLE_COLUMNS.map((column) => labels.columns[column]);
}

export function recordToRow(record: EvidenceRecord, labels: TableLabels): string[] {
  const cells: Record<TableColumn, string> = {
    seq: String(record.seq),
    capturedAt: record.capturedAt,
    publishedAtText: record.publishedAtText,
    publishedAt: record.publishedAt,
    platform: platformName(record.platform),
    url: record.url,
    publisher: record.publisher,
    echoes: record.echoes,
    groupOrPage: record.groupOrPage,
    groupAdmins: record.groupAdmins,
    keyword: record.keyword,
    recordType: labels.recordTypes[record.recordType],
    notes: record.notes,
    fileName: record.image.fileName,
    sha256: record.image.sha256,
  };
  return TABLE_COLUMNS.map((column) => cells[column]);
}
