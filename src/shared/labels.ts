import type { TableLabels } from '../domain/table';
import type { RecordType } from '../domain/types';
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
