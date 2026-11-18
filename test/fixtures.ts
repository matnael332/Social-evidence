/** Invented data for tests. Nothing here describes a real person, group or page. */
import { sealEntry, type AuditEntry } from '../src/domain/audit';
import type { Case, EvidenceRecord, PendingCapture, RecordFields } from '../src/domain/types';
import type { TableLabels } from '../src/domain/table';

export const CAPTURED_AT_MS = Date.UTC(2026, 10, 18, 12, 3, 22);

export function makePending(overrides: Partial<PendingCapture> = {}): PendingCapture {
  return {
    id: 1,
    windowId: 10,
    tabId: 20,
    pageUrl: 'https://social.example/groups/demo/posts/123',
    platform: 'website',
    capturedAtMs: CAPTURED_AT_MS,
    offsetMinutes: 120,
    timeZone: 'Asia/Jerusalem',
    tabWidth: 1280,
    tabHeight: 720,
    captureMode: 'visible',
    extracted: { adapter: 'website', adapterVersion: '1', values: { publisher: 'Invented Person' } },
    image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    ...overrides,
  };
}

export function makeFields(overrides: Partial<RecordFields> = {}): RecordFields {
  return {
    recordType: 'post',
    url: 'https://social.example/groups/demo/posts/123',
    publisher: 'Invented Person',
    groupOrPage: 'Invented Group',
    groupAdmins: 'Invented Admin One\nInvented Admin Two',
    echoes: '',
    publishedAtText: 'yesterday at 14:20',
    publishedAt: '2026-11-17T14:20',
    keyword: 'sample keyword',
    notes: '',
    ...overrides,
  };
}

export function makeRecord(seq: number, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    ...makeFields(),
    id: `record-${seq}`,
    caseId: 'case-1',
    seq,
    status: 'active',
    platform: 'website',
    pageUrlAtCapture: 'https://social.example/groups/demo/posts/123',
    capturedAt: '2026-11-18T14:03:22+02:00',
    timeZone: 'Asia/Jerusalem',
    image: {
      fileId: `file-${seq}`,
      fileName: `${String(seq).padStart(4, '0')}.png`,
      sha256: 'a'.repeat(64),
      bytes: 3,
      width: 1280,
      height: 784,
      captureMode: 'visible',
    },
    extracted: { adapter: 'website', adapterVersion: '1', values: {} },
    createdAt: '2026-11-18T14:03:30+02:00',
    updatedAt: '2026-11-18T14:03:30+02:00',
    ...overrides,
  };
}

/** Labels in English, so tests do not depend on a locale file. */
export const LABELS: TableLabels = {
  columns: {
    seq: 'No.',
    capturedAt: 'Captured at',
    publishedAtText: 'Published (as shown)',
    publishedAt: 'Published (normalized)',
    platform: 'Platform',
    url: 'Link',
    publisher: 'Publisher',
    echoes: 'Shared by',
    groupOrPage: 'Group or page',
    groupAdmins: 'Group admins',
    keyword: 'Keyword',
    recordType: 'Record type',
    notes: 'Notes',
    fileName: 'File name',
    sha256: 'SHA-256',
  },
  recordTypes: {
    post: 'Post',
    groupAdminPage: 'Group admins page',
    profile: 'Profile',
    other: 'Other',
  },
};

/** The `capture` audit entry for a record, continuing the chain of the given case. */
export function captureEntry(
  caseRec: Pick<Case, 'auditCount' | 'auditHead'>,
  record: EvidenceRecord,
): Promise<AuditEntry> {
  return sealEntry({
    caseId: record.caseId,
    n: caseRec.auditCount + 1,
    at: record.createdAt,
    action: 'capture',
    recordId: record.id,
    seq: record.seq,
    imageSha256: record.image.sha256,
    prevHash: caseRec.auditHead,
  });
}
