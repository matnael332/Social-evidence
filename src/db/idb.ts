/**
 * IndexedDB storage. See SPEC.md §6.
 *
 * Everything the extension knows lives in this one local database. The
 * service worker, the side panel and the options page all open it directly;
 * nothing is sent anywhere.
 *
 * A note that explains the shape of the write functions: an IndexedDB
 * transaction closes as soon as the code waits for anything that is not a
 * database request. Hashing is such a wait. So every write that involves a
 * hash is prepared first, outside any transaction, and the transaction then
 * checks that the case has not changed in the meantime.
 */
import { sealEntry, type AuditEntry, type AuditEntryBody } from '../domain/audit';
import { takeSeq } from '../domain/numbering';
import {
  EMPTY_AUDIT_HEAD,
  type Case,
  type EvidenceRecord,
  type PendingCapture,
  type StoredImage,
} from '../domain/types';

export const DB_NAME = 'social-evidence';
export const DB_VERSION = 1;

const STORES = {
  cases: 'cases',
  records: 'records',
  images: 'images',
  auditLog: 'auditLog',
  settings: 'settings',
  pending: 'pending',
} as const;

/** How often a write restarts when another page changed the case first. */
const MAX_ATTEMPTS = 5;

function createSchema(db: IDBDatabase): void {
  db.createObjectStore(STORES.cases, { keyPath: 'id' });

  const records = db.createObjectStore(STORES.records, { keyPath: 'id' });
  records.createIndex('caseId', 'caseId');
  // Two records of one case can never share a running number.
  records.createIndex('caseSeq', ['caseId', 'seq'], { unique: true });

  db.createObjectStore(STORES.images, { keyPath: 'fileId' });
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
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
  // Mark the promise as handled; callers still await it.
  done.catch(() => undefined);
  return done;
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

interface SettingRow<T> {
  key: string;
  value: T;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const row = await request<SettingRow<T> | undefined>(
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

const CURRENT_CASE_KEY = 'currentCaseId';

export async function getCase(id: string): Promise<Case | undefined> {
  const db = await openDb();
  return request<Case | undefined>(db.transaction(STORES.cases).objectStore(STORES.cases).get(id));
}

/** All cases, oldest first. */
export async function listCases(): Promise<Case[]> {
  const db = await openDb();
  const cases = await request<Case[]>(
    db.transaction(STORES.cases).objectStore(STORES.cases).getAll(),
  );
  return cases.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** A new case together with the first entry of its audit chain. */
async function prepareCase(title: string, createdAt: string): Promise<{ caseRec: Case; entry: AuditEntry }> {
  const id = crypto.randomUUID();
  const entry = await sealEntry({
    caseId: id,
    n: 1,
    at: createdAt,
    action: 'case.create',
    details: { title },
    prevHash: EMPTY_AUDIT_HEAD,
  });
  const caseRec: Case = {
    id,
    title,
    createdAt,
    nextSeq: 1,
    auditCount: 1,
    auditHead: entry.hash,
    archived: false,
  };
  return { caseRec, entry };
}

export async function createCase(title: string, createdAt: string): Promise<Case> {
  const { caseRec, entry } = await prepareCase(title, createdAt);
  const db = await openDb();
  const tx = db.transaction([STORES.cases, STORES.auditLog], 'readwrite');
  tx.objectStore(STORES.cases).add(caseRec);
  tx.objectStore(STORES.auditLog).add(entry);
  await completed(tx);
  return caseRec;
}

/**
 * Returns the case captures are saved into, creating the first one on first
 * use. The check and the creation share one transaction, so two pages
 * starting at the same moment cannot both create a case.
 */
export async function ensureCurrentCase(defaultTitle: string, createdAt: string): Promise<Case> {
  const prepared = await prepareCase(defaultTitle, createdAt);

  const db = await openDb();
  const tx = db.transaction([STORES.cases, STORES.auditLog, STORES.settings], 'readwrite');
  const done = completed(tx);
  const cases = tx.objectStore(STORES.cases);
  const settings = tx.objectStore(STORES.settings);

  const current = await request<SettingRow<string> | undefined>(settings.get(CURRENT_CASE_KEY));
  const existing = current ? await request<Case | undefined>(cases.get(current.value)) : undefined;
  if (existing) {
    await done;
    return existing;
  }

  cases.add(prepared.caseRec);
  tx.objectStore(STORES.auditLog).add(prepared.entry);
  settings.put({ key: CURRENT_CASE_KEY, value: prepared.caseRec.id });
  await done;
  return prepared.caseRec;
}

/** Makes a case the one new captures are saved into. */
export async function setCurrentCase(id: string): Promise<void> {
  if (!(await getCase(id))) throw new Error(`Case ${id} does not exist`);
  await setSetting(CURRENT_CASE_KEY, id);
}

export async function getCurrentCaseId(): Promise<string | undefined> {
  return getSetting<string>(CURRENT_CASE_KEY);
}

/** Archiving only hides a case from the pickers; nothing is removed. */
export async function setCaseArchived(id: string, archived: boolean): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORES.cases, 'readwrite');
  const done = completed(tx);
  const cases = tx.objectStore(STORES.cases);
  const current = await request<Case | undefined>(cases.get(id));
  if (!current) {
    tx.abort();
    throw new Error(`Case ${id} does not exist`);
  }
  cases.put({ ...current, archived });
  await done;
}

// --------------------------------------------------------------- audit log

/** The audit chain of a case, first entry first. */
export async function listAudit(caseId: string): Promise<AuditEntry[]> {
  const db = await openDb();
  const range = IDBKeyRange.bound([caseId, 0], [caseId, Number.MAX_SAFE_INTEGER]);
  return request<AuditEntry[]>(
    db.transaction(STORES.auditLog).objectStore(STORES.auditLog).getAll(range),
  );
}

/** True when `entry` is the next link after the chain the case currently has. */
function continuesChain(caseRec: Case, entry: AuditEntry): boolean {
  return entry.n === caseRec.auditCount + 1 && entry.prevHash === caseRec.auditHead;
}

export type AuditDraft = Omit<AuditEntryBody, 'caseId' | 'n' | 'prevHash'>;

/**
 * Appends one entry to a case's audit chain. `patch` changes fields of the
 * case in the same transaction, e.g. its title on a rename.
 */
export async function appendAudit(
  caseId: string,
  draft: AuditDraft,
  patch: Partial<Pick<Case, 'title'>> = {},
): Promise<AuditEntry> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const before = await getCase(caseId);
    if (!before) throw new Error(`Case ${caseId} does not exist`);
    const entry = await sealEntry({
      ...draft,
      caseId,
      n: before.auditCount + 1,
      prevHash: before.auditHead,
    });

    const db = await openDb();
    const tx = db.transaction([STORES.cases, STORES.auditLog], 'readwrite');
    const done = completed(tx);
    const cases = tx.objectStore(STORES.cases);
    const current = await request<Case | undefined>(cases.get(caseId));
    if (!current || !continuesChain(current, entry)) {
      // Another page wrote to this case in between: start over.
      tx.abort();
      continue;
    }
    tx.objectStore(STORES.auditLog).add(entry);
    cases.put({ ...current, ...patch, auditCount: entry.n, auditHead: entry.hash });
    await done;
    return entry;
  }
  throw new Error('The audit log is busy; the entry was not written');
}

export async function renameCase(id: string, title: string, at: string): Promise<void> {
  const current = await getCase(id);
  if (!current) throw new Error(`Case ${id} does not exist`);
  if (current.title === title) return;
  await appendAudit(
    id,
    { at, action: 'case.rename', changes: { title: { from: current.title, to: title } } },
    { title },
  );
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
  /** The `capture` entry, sealed against the chain as it was when the image was drawn. */
  audit: AuditEntry;
  /** The pending capture this record was made from; removed on success. */
  pendingId?: number;
}

/**
 * Writes a finished capture: record, image, audit entry and the case
 * counters, in one transaction.
 *
 * The running number is burned into the image, so the caller reads the case,
 * prepares everything, and this function checks that neither the counter nor
 * the audit chain has moved in the meantime.
 *
 * Returns `false` without writing anything when one of them has moved. The
 * caller then starts over with the new number.
 */
export async function commitCapture(commit: CaptureCommit): Promise<boolean> {
  const { record, expectedSeq, audit } = commit;
  if (record.seq !== expectedSeq) {
    throw new RangeError(`Record number ${record.seq} does not match ${expectedSeq}`);
  }
  if (audit.caseId !== record.caseId || audit.recordId !== record.id || audit.seq !== record.seq) {
    throw new RangeError('The audit entry does not describe this record');
  }

  const db = await openDb();
  const tx = db.transaction(
    [STORES.cases, STORES.records, STORES.images, STORES.auditLog, STORES.pending],
    'readwrite',
  );
  const done = completed(tx);
  const cases = tx.objectStore(STORES.cases);

  const current = await request<Case | undefined>(cases.get(record.caseId));
  if (!current || current.nextSeq !== expectedSeq || !continuesChain(current, audit)) {
    tx.abort();
    if (!current) throw new Error(`Case ${record.caseId} does not exist`);
    return false;
  }

  cases.put({ ...takeSeq(current).counter, auditCount: audit.n, auditHead: audit.hash });
  tx.objectStore(STORES.records).add(record);
  tx.objectStore(STORES.images).add({ fileId: record.image.fileId, blob: commit.image });
  tx.objectStore(STORES.auditLog).add(audit);
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
