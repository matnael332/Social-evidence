import { describe, expect, it } from 'vitest';
import {
  entryText,
  hashEntry,
  sealEntry,
  verifyChain,
  type AuditEntry,
  type AuditEntryBody,
} from '../src/domain/audit';
import { sha256Hex } from '../src/domain/hash';
import { EMPTY_AUDIT_HEAD } from '../src/domain/types';

const AT = '2026-11-18T14:03:22+02:00';

/** Builds a valid chain of the given actions. */
async function chain(length: number): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  for (let n = 1; n <= length; n += 1) {
    entries.push(
      await sealEntry({
        caseId: 'case-1',
        n,
        at: AT,
        action: n === 1 ? 'case.create' : 'capture',
        ...(n === 1 ? { details: { title: 'Case 1' } } : { recordId: `record-${n}`, seq: n - 1, imageSha256: 'a'.repeat(64) }),
        prevHash: entries.at(-1)?.hash ?? EMPTY_AUDIT_HEAD,
      }),
    );
  }
  return entries;
}

describe('sealEntry', () => {
  const body: AuditEntryBody = {
    caseId: 'case-1',
    n: 1,
    at: AT,
    action: 'case.create',
    details: { title: 'Case 1' },
    prevHash: EMPTY_AUDIT_HEAD,
  };

  it('hashes the canonical text of the entry', async () => {
    const entry = await sealEntry(body);
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.hash).toBe(await sha256Hex(new TextEncoder().encode(entryText(body))));
  });

  it('does not depend on the order of the properties', async () => {
    const reordered: AuditEntryBody = {
      prevHash: EMPTY_AUDIT_HEAD,
      details: { title: 'Case 1' },
      action: 'case.create',
      at: AT,
      n: 1,
      caseId: 'case-1',
    };
    expect(await hashEntry(reordered)).toBe(await hashEntry(body));
  });

  it('ignores properties that are not part of an entry', async () => {
    const stray = { ...body, hash: 'ignored', extra: 'ignored' } as AuditEntryBody;
    expect(await hashEntry(stray)).toBe(await hashEntry(body));
  });

  it('changes when any covered field changes', async () => {
    const original = await hashEntry(body);
    expect(await hashEntry({ ...body, at: '2026-11-18T14:03:23+02:00' })).not.toBe(original);
    expect(await hashEntry({ ...body, n: 2 })).not.toBe(original);
    expect(await hashEntry({ ...body, details: { title: 'Case 2' } })).not.toBe(original);
    expect(await hashEntry({ ...body, prevHash: 'f'.repeat(64) })).not.toBe(original);
  });
});

describe('verifyChain', () => {
  it('accepts an empty chain', async () => {
    expect(await verifyChain([])).toEqual({ ok: true, count: 0, head: EMPTY_AUDIT_HEAD });
  });

  it('accepts a valid chain and reports its head', async () => {
    const entries = await chain(4);
    expect(await verifyChain(entries)).toEqual({ ok: true, count: 4, head: entries[3]?.hash });
  });

  it('detects a changed entry', async () => {
    const entries = await chain(4);
    entries[1] = { ...(entries[1] as AuditEntry), imageSha256: 'b'.repeat(64) };
    expect(await verifyChain(entries)).toEqual({ ok: false, n: 2, problem: 'hash' });
  });

  it('detects an entry that was changed and re-hashed', async () => {
    const entries = await chain(4);
    entries[1] = await sealEntry({ ...(entries[1] as AuditEntry), imageSha256: 'b'.repeat(64) });
    // The forged entry is consistent in itself, but the next one no longer points at it.
    expect(await verifyChain(entries)).toEqual({ ok: false, n: 3, problem: 'link' });
  });

  it('detects a removed entry', async () => {
    const entries = await chain(4);
    entries.splice(1, 1);
    expect(await verifyChain(entries)).toEqual({ ok: false, n: 2, problem: 'order' });
  });

  it('detects reordered entries', async () => {
    const entries = await chain(4);
    [entries[1], entries[2]] = [entries[2] as AuditEntry, entries[1] as AuditEntry];
    expect(await verifyChain(entries)).toMatchObject({ ok: false, n: 2 });
  });

  it('detects entries cut from the end when the case knows better', async () => {
    const entries = await chain(4);
    const expected = { count: 4, head: (entries[3] as AuditEntry).hash };
    expect(await verifyChain(entries, expected)).toMatchObject({ ok: true });
    expect(await verifyChain(entries.slice(0, 3), expected)).toEqual({ ok: false, n: 3, problem: 'head' });
  });

  it('detects a chain that does not start from the beginning', async () => {
    const entries = await chain(3);
    const forgedStart = await sealEntry({ ...(entries[0] as AuditEntry), prevHash: 'c'.repeat(64) });
    expect(await verifyChain([forgedStart, ...entries.slice(1)])).toEqual({ ok: false, n: 1, problem: 'link' });
  });
});
