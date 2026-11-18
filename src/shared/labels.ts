import type { ChainProblem } from '../domain/audit';
import { integrityOk, type IntegrityReport } from '../domain/integrity';
import type { TableLabels } from '../domain/table';
import type { RecordType } from '../domain/types';
import { UTF8_BOM } from '../domain/csv';
import { t } from './i18n';

export function recordTypeLabels(): Record<RecordType, string> {
  return {
    post: t('recordTypePost'),
    groupAdminPage: t('recordTypeGroupAdminPage'),
    profile: t('recordTypeProfile'),
    other: t('recordTypeOther'),
  };
}

/** Column headers and value names of the evidence table, in the UI language. */
export function tableLabels(): TableLabels {
  return {
    columns: {
      seq: t('colSeq'),
      capturedAt: t('colCapturedAt'),
      publishedAtText: t('colPublishedAtText'),
      publishedAt: t('colPublishedAt'),
      platform: t('colPlatform'),
      url: t('colUrl'),
      publisher: t('colPublisher'),
      echoes: t('colEchoes'),
      groupOrPage: t('colGroupOrPage'),
      groupAdmins: t('colGroupAdmins'),
      keyword: t('colKeyword'),
      recordType: t('colRecordType'),
      notes: t('colNotes'),
      fileName: t('colFileName'),
      sha256: t('colSha256'),
    },
    recordTypes: recordTypeLabels(),
  };
}

export interface ReadmeFacts {
  caseTitle: string;
  /** ISO 8601 with offset. */
  exportedAt: string;
  activeRecords: number;
  deletedRecords: number;
}

/** Text of the README.txt inside an export: what the files are, how to verify, and the limits. */
export function exportReadme(facts: ReadmeFacts): string {
  const lines = [
    t('readmeTitle'),
    '',
    t('readmeCase', facts.caseTitle),
    t('readmeExportedAt', facts.exportedAt),
    t('readmeCounts', [String(facts.activeRecords), String(facts.deletedRecords)]),
    '',
    t('readmeFilesHeading'),
    `- ${t('readmeFileImages')}`,
    `- ${t('readmeFileCsv')}`,
    `- ${t('readmeFileXlsx')}`,
    `- ${t('readmeFileDeleted')}`,
    `- ${t('readmeFileAudit')}`,
    `- ${t('readmeFileHashes')}`,
    '',
    t('readmeVerifyHeading'),
    `- ${t('readmeVerifyHashes')}`,
    `- ${t('readmeVerifyAudit')}`,
    '',
    t('readmeLimitsHeading'),
    `- ${t('readmeLimitClock')}`,
    `- ${t('readmeLimitHash')}`,
    `- ${t('readmeLimitSeen')}`,
    `- ${t('readmeLimitExtracted')}`,
    `- ${t('readmeLimitChain')}`,
    `- ${t('readmeLimitLegal')}`,
    '',
  ];
  // A byte order mark and CRLF line endings, so Notepad shows the Hebrew text correctly.
  return UTF8_BOM + lines.join('\r\n');
}

const CHAIN_PROBLEMS: Record<ChainProblem, string> = {
  order: 'chainProblemOrder',
  link: 'chainProblemLink',
  hash: 'chainProblemHash',
  head: 'chainProblemHead',
};

const listSeqs = (seqs: readonly number[]): string => seqs.join(', ');

/** The result of an integrity check as lines of text; the first line is the verdict. */
export function integrityLines(report: IntegrityReport): string[] {
  if (integrityOk(report)) {
    return [t('integrityOk', [String(report.imagesChecked), String(report.entriesChecked)])];
  }
  const lines = [t('integrityFailed')];
  if (report.missingImages.length > 0) lines.push(t('integrityMissing', listSeqs(report.missingImages)));
  if (report.changedImages.length > 0) lines.push(t('integrityChanged', listSeqs(report.changedImages)));
  if (report.unloggedRecords.length > 0) lines.push(t('integrityUnlogged', listSeqs(report.unloggedRecords)));
  if (!report.chain.ok) {
    lines.push(t('integrityChain', [String(report.chain.n), t(CHAIN_PROBLEMS[report.chain.problem])]));
  }
  return lines;
}
