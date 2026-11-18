import { describe, expect, it } from 'vitest';
import { sealEntry, type AuditEntry } from '../src/domain/audit';
import { sha256Hex } from '../src/domain/hash';
import { checkIntegrity, integrityOk } from '../src/domain/integrity';
import { EMPTY_AUDIT_HEAD, type Case, type EvidenceRecord } from '../src/domain/types';
import { captureEntry, makeRecord } from './fixtures';

const AT = '2026-11-18T14:00:00+02:00';

/** A case with three saved records, built the way the extension builds it. */
async function intactCase() {
  const images = new Map<string, Uint8Array<ArrayBuffer>>();
  const audit: AuditEntry[] = [
    await sealEntry({ caseId: 'case-1', n: 1, at: AT, action: 'case.create', prevHash: EMPTY_AUDIT_HEAD }),
  ];
  const records: EvidenceRecord[] = [];

  for (const seq of [1, 2, 3]) {
    const bytes = new Uint8Array([seq, seq + 1]);
    const record = makeRecord(seq, {
      image: { ...makeRecord(seq).image, sha256: await sha256Hex(bytes) },
    });
    images.set(record.image.fileId, bytes);
    audit.push(await captureEntry({ auditCount: audit.length, auditHead: audit.at(-1)!.hash }, record));
    records.push(record);
  }

  const caseRec: Case = {
    id: 'case-1',
    title: 'Case 1',
    createdAt: AT,
    nextSeq: 4,
    auditCount: audit.length,
    auditHead: audit.at(-1)!.hash,
    archived: false,
  };
  const loadImage = async (fileId: string): Promise<Blob | undefined> => {
    const bytes = images.get(fileId);
    return bytes ? new Blob([bytes]) : undefined;
  };
  return { caseRec, records, audit, images, loadImage };
}

describe('checkIntegrity', () => {
  it('passes an untouched case', async () => {
    const report = await checkIntegrity(await intactCase());
    expect(integrityOk(report)).toBe(true);
    expect(report).toMatchObject({
      imagesChecked: 3,
      entriesChecked: 4,
      missingImages: [],
      changedImages: [],
      unloggedRecords: [],
    });
  });

  it('finds an image that was changed after capture', async () => {
    const input = await intactCase();
    input.images.set('file-2', new Uint8Array([9, 9, 9]));
    const report = await checkIntegrity(input);
    expect(report.changedImages).toEqual([2]);
    expect(integrityOk(report)).toBe(false);
  });

  it('finds a missing image', async () => {
    const input = await intactCase();
    input.images.delete('file-3');
    const report = await checkIntegrity(input);
    expect(report.missingImages).toEqual([3]);
    expect(integrityOk(report)).toBe(false);
  });

  it('finds a record whose stored hash was replaced together with its image', async () => {
    const input = await intactCase();
    const forgedBytes = new Uint8Array([7, 7]);
    input.images.set('file-1', forgedBytes);
    input.records[0] = makeRecord(1, {
      image: { ...makeRecord(1).image, sha256: await sha256Hex(forgedBytes) },
    });
    // Image and record agree with each other, but not with what was logged at capture.
    const report = await checkIntegrity(input);
    expect(report.changedImages).toEqual([]);
    expect(report.unloggedRecords).toEqual([1]);
    expect(integrityOk(report)).toBe(false);
  });

  it('finds a record that was slipped in without a log entry', async () => {
    const input = await intactCase();
    input.records.push(makeRecord(4, { image: { ...makeRecord(4).image, fileId: 'file-1' } }));
    const report = await checkIntegrity(input);
    expect(report.unloggedRecords).toContain(4);
  });

  it('finds a changed audit entry', async () => {
    const input = await intactCase();
    input.audit[2] = { ...input.audit[2]!, at: '2020-01-01T00:00:00+00:00' };
    const report = await checkIntegrity(input);
    expect(report.chain).toEqual({ ok: false, n: 3, problem: 'hash' });
    expect(integrityOk(report)).toBe(false);
  });

  it('finds entries removed from the end of the log', async () => {
    const input = await intactCase();
    input.audit.pop();
    const report = await checkIntegrity(input);
    expect(report.chain).toEqual({ ok: false, n: 3, problem: 'head' });
  });

  it('checks deleted records too', async () => {
    const input = await intactCase();
    input.records[1] = { ...input.records[1]!, status: 'deleted', deletedAt: AT };
    input.images.set('file-2', new Uint8Array([0]));
    expect((await checkIntegrity(input)).changedImages).toEqual([2]);
  });
});
