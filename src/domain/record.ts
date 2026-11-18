import { imageFileName } from './numbering';
import { formatIsoWithOffset } from './time';
import type {
  EvidenceRecord,
  ImageInfo,
  PendingCapture,
  RecordFields,
  StickyFields,
} from './types';

/** Trims every text field. An empty post link falls back to the captured page's address. */
export function normalizeFields(fields: RecordFields, pageUrl: string): RecordFields {
  return {
    recordType: fields.recordType,
    url: fields.url.trim() || pageUrl,
    publisher: fields.publisher.trim(),
    groupOrPage: fields.groupOrPage.trim(),
    groupAdmins: fields.groupAdmins.trim(),
    echoes: fields.echoes.trim(),
    publishedAtText: fields.publishedAtText.trim(),
    publishedAt: fields.publishedAt.trim(),
    keyword: fields.keyword.trim(),
    notes: fields.notes.trim(),
  };
}

/** The values that carry over to the next capture. */
export function stickyFrom(fields: RecordFields): StickyFields {
  return {
    recordType: fields.recordType,
    groupOrPage: fields.groupOrPage,
    groupAdmins: fields.groupAdmins,
    keyword: fields.keyword,
  };
}

export interface NewRecordInput {
  id: string;
  caseId: string;
  seq: number;
  pending: PendingCapture;
  fields: RecordFields;
  image: Omit<ImageInfo, 'fileName' | 'captureMode'>;
  /** Time of saving, in milliseconds since the epoch. */
  savedAtMs: number;
}

/** Assembles the stored record from a capture, the form and the final image. */
export function buildRecord(input: NewRecordInput): EvidenceRecord {
  const { pending, seq } = input;
  const savedAt = formatIsoWithOffset(input.savedAtMs, pending.offsetMinutes);

  return {
    ...normalizeFields(input.fields, pending.pageUrl),
    id: input.id,
    caseId: input.caseId,
    seq,
    status: 'active',
    platform: pending.platform,
    pageUrlAtCapture: pending.pageUrl,
    capturedAt: formatIsoWithOffset(pending.capturedAtMs, pending.offsetMinutes),
    timeZone: pending.timeZone,
    image: {
      ...input.image,
      fileName: imageFileName(seq),
      captureMode: pending.captureMode,
    },
    extracted: pending.extracted,
    createdAt: savedAt,
    updatedAt: savedAt,
  };
}
