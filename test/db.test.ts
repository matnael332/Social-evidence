import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  addPending,
  appendAudit,
  clearPending,
  closeDb,
  commitCapture,
  createCase,
  ensureCurrentCase,
  getCase,
  getCurrentCaseId,
  getImage,
  getSetting,
  listAudit,
  listCases,
  listPending,
  listRecords,
  renameCase,
  setCaseArchived,
  setCurrentCase,
  setSetting,
} from '../src/db/idb';
import { verifyChain } from '../src/domain/audit';
import { EMPTY_AUDIT_HEAD, type Case, type EvidenceRecord } from '../src/domain/types';
import { captureEntry, makePending, makeRecord } from './fixtures';

const CREATED_AT = '2026-11-18T14:00:00+02:00';
const png = (...bytes: number[]): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

/** Saves the next record of a case the way the side panel does. */
async function save(caseId: string, overrides: Partial<EvidenceRecord> = {}): Promise<EvidenceRecord> {
  const caseRec = (await getCase(caseId)) as Case;
  const seq = caseRec.nextSeq;
  const base = makeRecord(seq);
  const record = makeRecord(seq, {
    caseId,
    id: `${caseId}-record-${seq}`,
    image: { ...base.image, fileId: `${caseId}-file-${seq}` },
    ...overrides,
  });
  const audit = await captureEntry(caseRec, record);
  expect(await commitCapture({ expectedSeq: seq, record, image: png(seq), audit })).toBe(true);
  return record;
}

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('cases', () => {
  it('creates the first case once and returns it afterwards', async () => {
    const first = await ensureCurrentCase('Case 1', CREATED_AT);
    const again = await ensureCurrentCase('Another title', CREATED_AT);
    expect(first.nextSeq).toBe(1);
    expect(first.title).toBe('Case 1');
    expect(again).toEqual(first);
    expect(await listCases()).toHaveLength(1);
  });

  it('creates a single case when two pages start together', async () => {
    const [a, b] = await Promise.all([
      ensureCurrentCase('Case 1', CREATED_AT),
      ensureCurrentCase('Case 1', CREATED_AT),
    ]);
    expect(a.id).toBe(b.id);
    expect(await listCases()).toHaveLength(1);
  });

  it('starts every case with its own audit chain', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    const audit = await listAudit(caseRec.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ n: 1, action: 'case.create', prevHash: EMPTY_AUDIT_HEAD });
    expect(caseRec.auditCount).toBe(1);
    expect(caseRec.auditHead).toBe(audit[0]?.hash);
  });

  it('keeps a separate running number per case', async () => {
    const a = await createCase('Case A', CREATED_AT);
    const b = await createCase('Case B', '2026-11-18T15:00:00+02:00');
    await save(a.id);
    await save(a.id);
    await save(b.id);
    expect((await listRecords(a.id)).map((record) => record.seq)).toEqual([1, 2]);
    expect((await listRecords(b.id)).map((record) => record.seq)).toEqual([1]);
    expect((await listCases()).map((caseRec) => caseRec.title)).toEqual(['Case A', 'Case B']);
  });

  it('switches the active case', async () => {
    const first = await ensureCurrentCase('Case 1', CREATED_AT);
    const second = await createCase('Case 2', CREATED_AT);
    expect(await getCurrentCaseId()).toBe(first.id);
    await setCurrentCase(second.id);
    expect((await ensureCurrentCase('unused', CREATED_AT)).id).toBe(second.id);
    await expect(setCurrentCase('missing')).rejects.toThrow(/missing/);
  });

  it('archives and restores a case without touching its content', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    await save(caseRec.id);
    await setCaseArchived(caseRec.id, true);
    expect((await getCase(caseRec.id))?.archived).toBe(true);
    expect(await listRecords(caseRec.id)).toHaveLength(1);
    await setCaseArchived(caseRec.id, false);
    expect((await getCase(caseRec.id))?.archived).toBe(false);
  });

  it('records a rename in the audit chain', async () => {
    const caseRec = await createCase('Old name', CREATED_AT);
    await renameCase(caseRec.id, 'New name', '2026-11-18T16:00:00+02:00');

    const renamed = (await getCase(caseRec.id)) as Case;
    const audit = await listAudit(caseRec.id);
    expect(renamed.title).toBe('New name');
    expect(audit.at(-1)).toMatchObject({
      n: 2,
      action: 'case.rename',
      changes: { title: { from: 'Old name', to: 'New name' } },
    });
    expect(await verifyChain(audit, { count: renamed.auditCount, head: renamed.auditHead })).toMatchObject({ ok: true });
  });

  it('writes nothing when a rename changes nothing', async () => {
    const caseRec = await createCase('Same', CREATED_AT);
    await renameCase(caseRec.id, 'Same', CREATED_AT);
    expect(await listAudit(caseRec.id)).toHaveLength(1);
  });
});

describe('appendAudit', () => {
  it('keeps the chain intact when two pages write at once', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    await Promise.all([
      appendAudit(caseRec.id, { at: CREATED_AT, action: 'export', details: { records: 0 } }),
      appendAudit(caseRec.id, { at: CREATED_AT, action: 'export', details: { records: 1 } }),
    ]);

    const after = (await getCase(caseRec.id)) as Case;
    const audit = await listAudit(caseRec.id);
    expect(audit.map((entry) => entry.n)).toEqual([1, 2, 3]);
    expect(await verifyChain(audit, { count: after.auditCount, head: after.auditHead })).toMatchObject({ ok: true });
  });

  it('fails for a case that does not exist', async () => {
    await expect(appendAudit('missing', { at: CREATED_AT, action: 'export' })).rejects.toThrow(/missing/);
  });
});

describe('commitCapture', () => {
  it('writes the record, the image and the audit entry, and advances the counters', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    const record = await save(caseRec.id);

    const after = (await getCase(caseRec.id)) as Case;
    const audit = await listAudit(caseRec.id);
    expect(after.nextSeq).toBe(2);
    expect(after.auditCount).toBe(2);
    expect(after.auditHead).toBe(audit[1]?.hash);
    expect(audit[1]).toMatchObject({
      action: 'capture',
      recordId: record.id,
      seq: 1,
      imageSha256: record.image.sha256,
    });
    expect(await listRecords(caseRec.id)).toEqual([record]);
    const stored = await getImage(record.image.fileId);
    expect([...new Uint8Array(await stored!.arrayBuffer())]).toEqual([1]);
    expect(await verifyChain(audit, { count: after.auditCount, head: after.auditHead })).toMatchObject({ ok: true });
  });

  it('removes the pending capture in the same step', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    const pendingId = await addPending(makePending({ windowId: 10 }));
    const record = makeRecord(1, { caseId: caseRec.id });
    const audit = await captureEntry(caseRec, record);

    await commitCapture({ expectedSeq: 1, record, image: png(1), audit, pendingId });

    expect(await listPending(10)).toEqual([]);
  });

  it('writes nothing when the number was taken in the meantime', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    const loser = makeRecord(1, {
      caseId: caseRec.id,
      id: 'loser',
      image: { ...makeRecord(1).image, fileId: 'loser-file' },
    });
    // Prepared against the case as it was, like a second window would.
    const loserAudit = await captureEntry(caseRec, loser);
    await save(caseRec.id);

    expect(await commitCapture({ expectedSeq: 1, record: loser, image: png(9), audit: loserAudit })).toBe(false);

    expect((await listRecords(caseRec.id)).map((record) => record.id)).not.toContain('loser');
    expect(await getImage('loser-file')).toBeUndefined();
    expect(await listAudit(caseRec.id)).toHaveLength(2);
    expect((await getCase(caseRec.id))?.nextSeq).toBe(2);
  });

  it('writes nothing when the audit chain moved in the meantime', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    const record = makeRecord(1, { caseId: caseRec.id });
    const staleAudit = await captureEntry(caseRec, record);
    await appendAudit(caseRec.id, { at: CREATED_AT, action: 'export' });

    expect(await commitCapture({ expectedSeq: 1, record, image: png(1), audit: staleAudit })).toBe(false);
    expect(await listRecords(caseRec.id)).toEqual([]);
    expect((await getCase(caseRec.id))?.nextSeq).toBe(1);
  });

  it('gives two simultaneous saves different outcomes, never the same number', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    const a = makeRecord(1, { caseId: caseRec.id, id: 'a', image: { ...makeRecord(1).image, fileId: 'a' } });
    const b = makeRecord(1, { caseId: caseRec.id, id: 'b', image: { ...makeRecord(1).image, fileId: 'b' } });
    const [auditA, auditB] = await Promise.all([captureEntry(caseRec, a), captureEntry(caseRec, b)]);

    const outcomes = await Promise.all([
      commitCapture({ expectedSeq: 1, record: a, image: png(1), audit: auditA }),
      commitCapture({ expectedSeq: 1, record: b, image: png(2), audit: auditB }),
    ]);

    expect(outcomes.sort()).toEqual([false, true]);
    expect(await listRecords(caseRec.id)).toHaveLength(1);
    expect(await listAudit(caseRec.id)).toHaveLength(2);
  });

  it('leaves no gap after a capture that was never saved', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    await save(caseRec.id);
    // A capture is taken and discarded here: the counter is not involved.
    await save(caseRec.id);
    expect((await listRecords(caseRec.id)).map((record) => record.seq)).toEqual([1, 2]);
  });

  it('refuses a record whose number differs from the expected one', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    const record = makeRecord(2, { caseId: caseRec.id });
    const audit = await captureEntry(caseRec, record);
    await expect(commitCapture({ expectedSeq: 1, record, image: png(1), audit })).rejects.toThrow(RangeError);
  });

  it('refuses an audit entry that describes another record', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    const record = makeRecord(1, { caseId: caseRec.id });
    const other = await captureEntry(caseRec, makeRecord(1, { caseId: caseRec.id, id: 'someone-else' }));
    await expect(commitCapture({ expectedSeq: 1, record, image: png(1), audit: other })).rejects.toThrow(RangeError);
  });

  it('fails for a case that does not exist', async () => {
    const record = makeRecord(1, { caseId: 'missing' });
    const audit = await captureEntry({ auditCount: 0, auditHead: EMPTY_AUDIT_HEAD }, record);
    await expect(commitCapture({ expectedSeq: 1, record, image: png(1), audit })).rejects.toThrow(/missing/);
  });
});

describe('listRecords', () => {
  it('returns records in number order and hides deleted ones', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    await save(caseRec.id);
    await save(caseRec.id, { status: 'deleted', deletedAt: CREATED_AT });
    await save(caseRec.id);

    expect((await listRecords(caseRec.id)).map((record) => record.seq)).toEqual([1, 3]);
    expect(
      (await listRecords(caseRec.id, { includeDeleted: true })).map((record) => record.seq),
    ).toEqual([1, 2, 3]);
  });

  it('does not mix cases', async () => {
    const caseRec = await createCase('Case A', CREATED_AT);
    await save(caseRec.id);
    expect(await listRecords('another-case')).toEqual([]);
  });
});

describe('pending captures', () => {
  it('are listed per window, oldest first', async () => {
    const first = await addPending(makePending({ windowId: 10 }));
    await addPending(makePending({ windowId: 99 }));
    const third = await addPending(makePending({ windowId: 10 }));
    expect((await listPending(10)).map((capture) => capture.id)).toEqual([first, third]);
  });

  it('can all be dropped', async () => {
    await addPending(makePending({ windowId: 10 }));
    await clearPending();
    expect(await listPending(10)).toEqual([]);
  });
});

describe('settings', () => {
  it('stores and returns a value', async () => {
    expect(await getSetting('missing')).toBeUndefined();
    await setSetting('stickyFields:case-1', { keyword: 'sample keyword' });
    expect(await getSetting('stickyFields:case-1')).toEqual({ keyword: 'sample keyword' });
  });
});
