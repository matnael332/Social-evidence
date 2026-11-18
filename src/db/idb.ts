/**
 * IndexedDB storage. See SPEC.md §6.
 *
 * Everything the extension knows lives in this one local database. The
 * service worker, the side panel and the options page all open it directly;
 * nothing is sent anywhere.
 */
import { takeSeq } from '../domain/numbering';
import {
  EMPTY_AUDIT_HEAD,
  type Case,
  type EvidenceRecord,
  type PendingCapture,
  type StoredImage,
} from '../domain/types';

export const DB_NAME = 'post-evidence';
export const DB_VERSION = 1;

const STORES = {
  cases: 'cases',
  records: 'records',
  images: 'images',
  auditLog: 'auditLog',
  settings: 'settings',
  pending: 'pending',
} as const;

function createSchema(db: IDBDatabase): void {
  db.createObjectStore(STORES.cases, { keyPath: 'id' });

  const records = db.createObjectStore(STORES.records, { keyPath: 'id' });
  records.createIndex('caseId', 'caseId');
  // Two records of one case can never share a running number.
  records.createIndex('caseSeq', ['caseId', 'seq'], { unique: true });

  db.createObjectStore(STORES.images, { keyPath: 'fileId' });
  // Filled from stage 3 on; created now so the schema does not change later.
  db.createObjectStore(STORES.auditLog, { keyPath: ['caseId', 'n'] });
  db.createObjectStore(STORES.settings, { keyPath: 'key' });
  db.createObjectStore(STORES.pending, { keyPath: 'id', autoIncrement: true });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => createSchema(open.result);
    open.onsuccess = () => {
      const db = open.result;
      // Another page is upgrading the schema: step aside and reopen later.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    open.onerror = () => {
      dbPromise = null;
      reject(open.error);
    };
  });
  return dbPromise;
}

/** Closes the connection. Used by tests to start from a clean database. */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

// ---------------------------------------------------------------- settings

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const row = await request<{ key: string; value: T } | undefined>(
    db.transaction(STORES.settings).objectStore(STORES.settings).get(key),
  );
  return row?.value;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES.settings, 'readwrite');
  tx.objectStore(STORES.settings).put({ key, value });
  await completed(tx);
}

// ------------------------------------------------------------------- cases

export async function getCase(id: string): Promise<Case | undefined> {
  const db = await openDb();
  return request<Case | undefined>(db.transaction(STORES.cases).objectStore(STORES.cases).get(id));
}

export async function listCases(): Promise<Case[]> {
  const db = await openDb();
  const cases = await request<Case[]>(
    db.transaction(STORES.cases).objectStore(STORES.cases).getAll(),
  );
  return cases.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const CURRENT_CASE_KEY = 'currentCaseId';

/**
 * Returns the case captures are saved into, creating the first one on first
 * use. The whole check runs in one transaction, so two pages starting at the
 * same moment cannot both create a case.
 */
export async function ensureCurrentCase(defaultTitle: string, createdAt: string): Promise<Case> {
  const db = await openDb();
  const tx = db.transaction([STORES.cases, STORES.settings], 'readwrite');
  const cases = tx.objectStore(STORES.cases);
  const settings = tx.objectStore(STORES.settings);

  const current = await request<{ key: string; value: string } | undefined>(
    settings.get(CURRENT_CASE_KEY),
  );
  let found = current ? await request<Case | undefined>(cases.get(current.value)) : undefined;

  if (!found) {
    found = {
      id: crypto.randomUUID(),
      title: defaultTitle,
      createdAt,
      nextSeq: 1,
      auditCount: 0,
      auditHead: EMPTY_AUDIT_HEAD,
      archived: false,
    };
    cases.add(found);
    settings.put({ key: CURRENT_CASE_KEY, value: found.id });
  }

  await completed(tx);
  return found;
}

// ----------------------------------------------------------------- records

/** Records of a case, ordered by running number. Deleted ones are left out by default. */
export async function listRecords(
  caseId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<EvidenceRecord[]> {
  const db = await openDb();
  const range = IDBKeyRange.bound([caseId, 0], [caseId, Number.MAX_SAFE_INTEGER]);
  const records = await request<EvidenceRecord[]>(
    db.transaction(STORES.records).objectStore(STORES.records).index('caseSeq').getAll(range),
  );
  return options.includeDeleted ? records : records.filter((record) => record.status === 'active');
}

export async function getImage(fileId: string): Promise<Blob | undefined> {
  const db = await openDb();
  const row = await request<StoredImage | undefined>(
    db.transaction(STORES.images).objectStore(STORES.images).get(fileId),
  );
  return row?.blob;
}

export interface CaptureCommit {
  /** The running number the image was drawn with. */
  expectedSeq: number;
  record: EvidenceRecord;
  image: Blob;
  /** The pending capture this record was made from; removed on success. */
  pendingId?: number;
}

/**
 * Writes a finished capture: record, image and the case counter, in one
 * transaction.
 *
 * The running number is burned into the image, and an IndexedDB transaction
 * cannot stay open while an image is drawn and hashed. So the caller reads
 * the counter, prepares everything, and this function checks that the
 * counter has not moved in the meantime.
 *
 * Returns `false` without writing anything when it has moved. The caller
 * then starts over with the new number.
 */
export async function commitCapture(commit: CaptureCommit): Promise<boolean> {
  const { record, expectedSeq } = commit;
  if (record.seq !== expectedSeq) {
    throw new RangeError(`Record number ${record.seq} does not match ${expectedSeq}`);
  }

  const db = await openDb();
  const tx = db.transaction(
    [STORES.cases, STORES.records, STORES.images, STORES.pending],
    'readwrite',
  );
  const done = completed(tx);
  // Mark the promise as handled; it is still awaited below.
  done.catch(() => undefined);
  const cases = tx.objectStore(STORES.cases);

  const current = await request<Case | undefined>(cases.get(record.caseId));
  if (!current || current.nextSeq !== expectedSeq) {
    tx.abort();
    if (!current) throw new Error(`Case ${record.caseId} does not exist`);
    return false;
  }

  cases.put(takeSeq(current).counter);
  tx.objectStore(STORES.records).add(record);
  tx.objectStore(STORES.images).add({ fileId: record.image.fileId, blob: commit.image });
  if (commit.pendingId !== undefined) tx.objectStore(STORES.pending).delete(commit.pendingId);

  await done;
  return true;
}

// ---------------------------------------------------------------- pending

/** Stores an unsaved capture and returns the id the database gave it. */
export async function addPending(capture: PendingCapture): Promise<number> {
  // The key is generated; an `id` property, even an undefined one, would be rejected.
  const { id: _generated, ...row } = capture;
  const db = await openDb();
  const tx = db.transaction(STORES.pending, 'readwrite');
  const id = await request(tx.objectStore(STORES.pending).add(row));
  await completed(tx);
  return id as number;
}

export async function getPending(id: number): Promise<PendingCapture | undefined> {
  const db = await openDb();
  return request<PendingCapture | undefined>(
    db.transaction(STORES.pending).objectStore(STORES.pending).get(id),
  );
}

/** Unsaved captures of one browser window, oldest first. */
export async function listPending(windowId: number): Promise<PendingCapture[]> {
  const db = await openDb();
  const all = await request<PendingCapture[]>(
    db.transaction(STORES.pending).objectStore(STORES.pending).getAll(),
  );
  return all.filter((capture) => capture.windowId === windowId);
}

export async function deletePending(id: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES.pending, 'readwrite');
  tx.objectStore(STORES.pending).delete(id);
  await completed(tx);
}

/** Drops every unsaved capture. Window ids do not survive a browser restart. */
export async function clearPending(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES.pending, 'readwrite');
  tx.objectStore(STORES.pending).clear();
  await completed(tx);
}
