/**
 * Integrity check of a case: do the stored images still match the hashes
 * taken at capture, and is the audit chain unbroken?
 */
import { verifyChain, type AuditEntry, type ChainResult } from './audit';
import { sha256Hex } from './hash';
import type { Case, EvidenceRecord } from './types';

export interface IntegrityInput {
  caseRec: Case;
  /** Every record of the case, deleted ones included. */
  records: readonly EvidenceRecord[];
  audit: readonly AuditEntry[];
  loadImage: (fileId: string) => Promise<Blob | undefined>;
}

export interface IntegrityReport {
  imagesChecked: number;
  /** Running numbers of records whose image is gone. */
  missingImages: number[];
  /** Running numbers of records whose image no longer matches its hash. */
  changedImages: number[];
  /** Running numbers of records that the audit log does not mention with the same image hash. */
  unloggedRecords: number[];
  entriesChecked: number;
  chain: ChainResult;
}

export async function checkIntegrity(input: IntegrityInput): Promise<IntegrityReport> {
  const missingImages: number[] = [];
  const changedImages: number[] = [];
  const unloggedRecords: number[] = [];

  const logged = new Set(
    input.audit
      .filter((entry) => entry.action === 'capture')
      .map((entry) => `${entry.recordId}|${entry.seq}|${entry.imageSha256}`),
  );

  const records = [...input.records].sort((a, b) => a.seq - b.seq);
  for (const record of records) {
    if (!logged.has(`${record.id}|${record.seq}|${record.image.sha256}`)) {
      unloggedRecords.push(record.seq);
    }
    const image = await input.loadImage(record.image.fileId);
    if (!image) {
      missingImages.push(record.seq);
    } else if ((await sha256Hex(await image.arrayBuffer())) !== record.image.sha256) {
      changedImages.push(record.seq);
    }
  }

  const chain = await verifyChain(input.audit, {
    count: input.caseRec.auditCount,
    head: input.caseRec.auditHead,
  });

  return {
    imagesChecked: records.length,
    missingImages,
    changedImages,
    unloggedRecords,
    entriesChecked: input.audit.length,
    chain,
  };
}

export function integrityOk(report: IntegrityReport): boolean {
  return (
    report.chain.ok &&
    report.missingImages.length === 0 &&
    report.changedImages.length === 0 &&
    report.unloggedRecords.length === 0
  );
}
