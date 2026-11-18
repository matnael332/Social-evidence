/**
 * Options page. In stage 2 it lists the records of the case and exports
 * them; search, editing and deletion arrive with the full management screen.
 */
import '@fontsource-variable/noto-sans-hebrew/wght.css';
import '../shared/base.css';
import './options.css';

import { ensureCurrentCase, getImage, listRecords } from '../db/idb';
import { exportCase, exportFileName } from '../domain/export';
import { formatSeq } from '../domain/numbering';
import { formatIsoWithOffset, localOffsetMinutes } from '../domain/time';
import type { Case, EvidenceRecord } from '../domain/types';
import { platformName } from '../platform/detect';
import { localizePage, t } from '../shared/i18n';
import { recordTypeLabels, tableLabels } from '../shared/labels';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const els = {
  caseChip: byId<HTMLSpanElement>('case-chip'),
  exportButton: byId<HTMLButtonElement>('export'),
  alert: byId<HTMLParagraphElement>('alert'),
  status: byId<HTMLParagraphElement>('status'),
  empty: byId<HTMLParagraphElement>('empty'),
  table: byId<HTMLTableElement>('records'),
  rows: byId<HTMLTableSectionElement>('rows'),
};

let caseRec: Case | null = null;
let records: EvidenceRecord[] = [];

function cell(text: string, className = ''): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

async function openImage(record: EvidenceRecord): Promise<void> {
  const blob = await getImage(record.image.fileId);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  // The new tab has loaded the image long before this.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function renderRows(): void {
  const typeLabels = recordTypeLabels();
  els.rows.replaceChildren(
    ...records.map((record) => {
      const tr = document.createElement('tr');

      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'link';
      view.textContent = t('viewImage');
      view.addEventListener('click', () => void openImage(record));
      const imageCell = document.createElement('td');
      imageCell.append(view);

      tr.append(
        cell(formatSeq(record.seq), 'num'),
        cell(record.capturedAt.replace('T', ' '), 'time ltr'),
        cell(platformName(record.platform)),
        cell(record.publisher),
        cell(record.groupOrPage),
        cell(record.keyword),
        cell(typeLabels[record.recordType]),
        cell(record.url, 'url ltr'),
        imageCell,
      );
      return tr;
    }),
  );

  const hasRecords = records.length > 0;
  els.table.hidden = !hasRecords;
  els.empty.hidden = hasRecords;
  els.exportButton.disabled = !hasRecords;
}

async function reload(): Promise<void> {
  if (!caseRec) return;
  records = await listRecords(caseRec.id);
  renderRows();
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function runExport(): Promise<void> {
  if (!caseRec) return;
  els.alert.hidden = true;
  els.status.hidden = true;
  els.exportButton.disabled = true;
  els.exportButton.textContent = t('exporting');

  try {
    const current = await listRecords(caseRec.id);
    const zip = await exportCase({ records: current, labels: tableLabels(), loadImage: getImage });
    const now = Date.now();
    const fileName = exportFileName(caseRec.title, now, localOffsetMinutes(now));
    download(zip, fileName);
    els.status.textContent = t('exportDone', fileName);
    els.status.hidden = false;
  } catch (error) {
    console.error('Export failed', error);
    els.alert.textContent = t('exportFailed');
    els.alert.hidden = false;
  } finally {
    els.exportButton.textContent = t('exportZip');
    els.exportButton.disabled = records.length === 0;
  }
}

async function init(): Promise<void> {
  localizePage();
  const now = Date.now();
  caseRec = await ensureCurrentCase(
    t('defaultCaseTitle'),
    formatIsoWithOffset(now, localOffsetMinutes(now)),
  );
  els.caseChip.textContent = t('caseChip', caseRec.title);

  els.exportButton.addEventListener('click', () => void runExport());
  // Pick up records saved from the side panel while this tab was in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void reload();
  });
  await reload();
}

void init().catch((error: unknown) => {
  console.error('Options page failed to start', error);
  els.alert.textContent = String(error);
  els.alert.hidden = false;
});
