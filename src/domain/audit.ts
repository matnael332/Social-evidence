/**
 * The audit log of a case: an append-only chain of entries. See SPEC.md §6.5.
 *
 * Every entry carries the hash of the one before it and is itself hashed,
 * so changing, removing or reordering an entry later breaks the chain at
 * that point. The chain makes tampering detectable, not impossible: someone
 * who can rewrite the whole database can rebuild it. It has evidential value
 * only together with a copy of the hashes kept somewhere else.
 */
import { canonicalJson, type Json } from './canonicalJson';
import { sha256Hex } from './hash';
import { EMPTY_AUDIT_HEAD } from './types';

export type AuditAction =
  | 'case.create'
  | 'case.rename'
  | 'capture'
  | 'edit'
  | 'delete'
  | 'restore'
  | 'export';

/** Everything in an entry that is covered by its hash. */
export interface AuditEntryBody {
  caseId: string;
  /** 1-based position in the case's chain. */
  n: number;
  /** ISO 8601 with offset. */
  at: string;
  action: AuditAction;
  recordId?: string;
  seq?: number;
  /** On capture and delete: the hash of the record's image. */
  imageSha256?: string;
  /** On edit and rename: old and new value per changed field. */
  changes?: Record<string, { from: string; to: string }>;
  /** Free facts about the action, e.g. the number of exported records. */
  details?: Record<string, string | number>;
  /** Hash of the previous entry; 64 zeros for the first one. */
  prevHash: string;
}

export interface AuditEntry extends AuditEntryBody {
  /** SHA-256 of `entryText(body)`. */
  hash: string;
}

/**
 * The exact text that is hashed. Built from the known fields only, so a
 * stray property on a stored object can never change the result.
 */
export function entryText(entry: AuditEntryBody): string {
  const body: Record<string, Json | undefined> = {
    caseId: entry.caseId,
    n: entry.n,
    at: entry.at,
    action: entry.action,
    recordId: entry.recordId,
    seq: entry.seq,
    imageSha256: entry.imageSha256,
    changes: entry.changes,
    details: entry.details,
    prevHash: entry.prevHash,
  };
  return canonicalJson(body);
}

export async function hashEntry(entry: AuditEntryBody): Promise<string> {
  return sha256Hex(new TextEncoder().encode(entryText(entry)));
}

/** Completes an entry with its hash. */
export async function sealEntry(body: AuditEntryBody): Promise<AuditEntry> {
  return { ...body, hash: await hashEntry(body) };
}

export type ChainProblem =
  /** Entries are not numbered 1, 2, 3 … without gaps. */
  | 'order'
  /** An entry does not point at the hash of the one before it. */
  | 'link'
  /** An entry's content does not match its own hash. */
  | 'hash'
  /** The chain is intact but shorter, longer or other than the case says. */
  | 'head';

export type ChainResult =
  | { ok: true; count: number; head: string }
  | { ok: false; n: number; problem: ChainProblem };

/**
 * Checks a chain from its first entry. `expected` is what the case itself
 * records about its chain; passing it also catches entries removed from the
 * end.
 */
export async function verifyChain(
  entries: readonly AuditEntry[],
  expected?: { count: number; head: string },
): Promise<ChainResult> {
  let previousHash = EMPTY_AUDIT_HEAD;

  for (const [index, entry] of entries.entries()) {
    const n = index + 1;
    if (entry.n !== n) return { ok: false, n, problem: 'order' };
    if (entry.prevHash !== previousHash) return { ok: false, n, problem: 'link' };
    if ((await hashEntry(entry)) !== entry.hash) return { ok: false, n, problem: 'hash' };
    previousHash = entry.hash;
  }

  if (expected && (expected.count !== entries.length || expected.head !== previousHash)) {
    return { ok: false, n: entries.length, problem: 'head' };
  }
  return { ok: true, count: entries.length, head: previousHash };
}
