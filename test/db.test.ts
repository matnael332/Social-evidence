import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  addPending,
  clearPending,
  closeDb,
  commitCapture,
  ensureCurrentCase,
  getCase,
  getImage,
  getSetting,
  listPending,
  listRecords,
  setSetting,
} from '../src/db/idb';
import { makePending, makeRecord } from './fixtures';

const CREATED_AT = '2026-11-18T14:00:00+02:00';
const png = (...bytes: number[]): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('ensureCurrentCase', () => {
  it('creates the first case once and returns it afterwards', async () => {
    const first = await ensureCurrentCase('Case 1', CREATED_AT);
    const again = await ensureCurrentCase('Another title', CREATED_AT);
    expect(first.nextSeq).toBe(1);
    expect(first.title).toBe('Case 1');
    expect(again).toEqual(first);
  });

  it('creates a single case when two pages start together', async () => {
    const [a, b] = await Promise.all([
      ensureCurrentCase('Case 1', CREATED_AT),
      ensureCurrentCase('Case 1', CREATED_AT),
    ]);
    expect(a.id).toBe(b.id);
  });
});

describe('commitCapture', () => {
  it('writes the record and the image and advances the counter', async () => {
    const caseRec = await ensureCurrentCase('Case 1', CREATED_AT);
    const record = makeRecord(1, { caseId: caseRec.id });

    expect(await commitCapture({ expectedSeq: 1, record, image: png(1, 2, 3) })).toBe(true);

    expect((await getCase(caseRec.id))?.nextSeq).toBe(2);
    expect(await listRecords(caseRec.id)).toEqual([record]);
    const stored = await getImage(record.image.fileId);
    expect([...new Uint8Array(await stored!.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('removes the pending capture in the same step', async () => {
    const caseRec = await ensureCurrentCase('Case 1', CREATED_AT);
    const pendingId = await addPending(makePending({ windowId: 10 }));
    const record = makeRecord(1, { caseId: caseRec.id });

    await commitCapture({ expectedSeq: 1, record, image: png(1), pendingId });

    expect(await listPending(10)).toEqual([]);
  });

  it('writes nothing when the number was taken in the meantime', async () => {
    const caseRec = await ensureCurrentCase('Case 1', CREATED_AT);
    const winner = makeRecord(1, { caseId: caseRec.id, id: 'winner' });
    const loser = makeRecord(1, {
      caseId: caseRec.id,
      id: 'loser',
      image: { ...makeRecord(1).image, fileId: 'loser-file' },
    });

    expect(await commitCapture({ expectedSeq: 1, record: winner, image: png(1) })).toBe(true);
    expect(await commitCapture({ expectedSeq: 1, record: loser, image: png(2) })).toBe(false);

    expect((await listRecords(caseRec.id)).map((record) => record.id)).toEqual(['winner']);
    expect(await getImage('loser-file')).toBeUndefined();
    expect((await getCase(caseRec.id))?.nextSeq).toBe(2);
  });

  it('gives two simultaneous saves different outcomes, never the same number', async () => {
    const caseRec = await ensureCurrentCase('Case 1', CREATED_AT);
    const a = makeRecord(1, { caseId: caseRec.id, id: 'a', image: { ...makeRecord(1).image, fileId: 'a' } });
    const b = makeRecord(1, { caseId: caseRec.id, id: 'b', image: { ...makeRecord(1).image, fileId: 'b' } });

    const outcomes = await Promise.all([
      commitCapture({ expectedSeq: 1, record: a, image: png(1) }),
      commitCapture({ expectedSeq: 1, record: b, image: png(2) }),
    ]);

    expect(outcomes.sort()).toEqual([false, true]);
    expect(await listRecords(caseRec.id)).toHaveLength(1);
  });

  it('leaves no gap after a capture that was never saved', async () => {
    const caseRec = await ensureCurrentCase('Case 1', CREATED_AT);
    await commitCapture({ expectedSeq: 1, record: makeRecord(1, { caseId: caseRec.id }), image: png(1) });
    // A capture is taken and discarded here: the counter is not involved.
    await commitCapture({ expectedSeq: 2, record: makeRecord(2, { caseId: caseRec.id }), image: png(2) });

    expect((await listRecords(caseRec.id)).map((record) => record.seq)).toEqual([1, 2]);
  });

  it('refuses a record whose number differs from the expected one', async () => {
    const caseRec = await ensureCurrentCase('Case 1', CREATED_AT);
    const record = makeRecord(2, { caseId: caseRec.id });
    await expect(commitCapture({ expectedSeq: 1, record, image: png(1) })).rejects.toThrow(RangeError);
  });

  it('fails for a case that does not exist', async () => {
    const record = makeRecord(1, { caseId: 'missing' });
    await expect(commitCapture({ expectedSeq: 1, record, image: png(1) })).rejects.toThrow(/missing/);
  });
});

describe('listRecords', () => {
  it('returns records in number order and hides deleted ones', async () => {
    const caseRec = await ensureCurrentCase('Case 1', CREATED_AT);
    for (const seq of [1, 2, 3]) {
      const status = seq === 2 ? 'deleted' : 'active';
      await commitCapture({
        expectedSeq: seq,
        record: makeRecord(seq, { caseId: caseRec.id, status }),
        image: png(seq),
      });
    }
    expect((await listRecords(caseRec.id)).map((record) => record.seq)).toEqual([1, 3]);
    expect(
      (await listRecords(caseRec.id, { includeDeleted: true })).map((record) => record.seq),
    ).toEqual([1, 2, 3]);
  });

  it('does not mix cases', async () => {
    const caseRec = await ensureCurrentCase('Case 1', CREATED_AT);
    await commitCapture({ expectedSeq: 1, record: makeRecord(1, { caseId: caseRec.id }), image: png(1) });
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
    await setSetting('stickyFields', { keyword: 'sample keyword' });
    expect(await getSetting('stickyFields')).toEqual({ keyword: 'sample keyword' });
  });
});
