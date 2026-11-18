/** Shared data model. See SPEC.md §6. */

export type Platform = 'facebook' | 'tiktok' | 'instagram' | 'website';

export type RecordType = 'post' | 'groupAdminPage' | 'profile' | 'other';

export const RECORD_TYPES: readonly RecordType[] = ['post', 'groupAdminPage', 'profile', 'other'];

export type CaptureMode = 'visible' | 'fullpage';

/** Hash of an empty audit chain: 64 zeros. */
export const EMPTY_AUDIT_HEAD = '0'.repeat(64);

export interface Case {
  id: string;
  title: string;
  /** ISO 8601 with offset. */
  createdAt: string;
  /** Next running number. Starts at 1 and is only ever incremented. */
  nextSeq: number;
  /** Number of audit entries in this case (audit log arrives in stage 3). */
  auditCount: number;
  /** Hash of the newest audit entry. */
  auditHead: string;
  archived: boolean;
}

export interface ImageInfo {
  fileId: string;
  /** Derived from the running number, e.g. "0007.png". */
  fileName: string;
  /** SHA-256 (hex) of the final PNG bytes, information strip included. */
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  captureMode: CaptureMode;
}

export interface ExtractedInfo {
  adapter: Platform;
  adapterVersion: string;
  values: Partial<Record<'publisher' | 'groupOrPage' | 'url' | 'publishedAtText', string>>;
}

/** The fields a person types into the form. */
export interface RecordFields {
  recordType: RecordType;
  /** Direct link to the post, as confirmed by the user. */
  url: string;
  publisher: string;
  groupOrPage: string;
  /** One name per line. */
  groupAdmins: string;
  /** Profiles that shared the post, free text. */
  echoes: string;
  /** Publication date exactly as the page shows it. */
  publishedAtText: string;
  /**
   * Optional normalized publication date typed by the user:
   * "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm". Wall-clock time as read on the page;
   * no timezone is claimed.
   */
  publishedAt: string;
  keyword: string;
  notes: string;
}

export interface EvidenceRecord extends RecordFields {
  id: string;
  caseId: string;
  /** Per case, 1-based, unique, never reused. */
  seq: number;
  status: 'active' | 'deleted';
  deletedAt?: string;
  platform: Platform;
  /** Exact tab URL at the moment of capture. Never edited. */
  pageUrlAtCapture: string;
  /** ISO 8601 with offset. Never edited. */
  capturedAt: string;
  /** IANA timezone name. */
  timeZone: string;
  image: ImageInfo;
  extracted: ExtractedInfo;
  createdAt: string;
  updatedAt: string;
}

/** A PNG stored apart from its record, so lists never load pixels. */
export interface StoredImage {
  fileId: string;
  blob: Blob;
}

/** A screenshot that was taken but not saved yet. */
export interface PendingCapture {
  /** Auto-increment key; absent before the first write. */
  id?: number;
  windowId: number;
  tabId: number;
  pageUrl: string;
  platform: Platform;
  capturedAtMs: number;
  /** Minutes east of UTC at capture time. */
  offsetMinutes: number;
  timeZone: string;
  /** Size of the tab in CSS pixels when the capture started; used to derive the device pixel ratio. */
  tabWidth: number;
  tabHeight: number;
  captureMode: CaptureMode;
  image: Blob;
}

/** Form values that carry over from one saved capture to the next. */
export type StickyFields = Pick<RecordFields, 'recordType' | 'groupOrPage' | 'groupAdmins' | 'keyword'>;

export const EMPTY_STICKY: StickyFields = {
  recordType: 'post',
  groupOrPage: '',
  groupAdmins: '',
  keyword: '',
};
