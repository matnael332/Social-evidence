/**
 * Options page: the home of all cases, and inside a case its records, the
 * export and the integrity check. Search, editing and deletion arrive with
 * the full management screen in stage 4.
 *
 * The page has two views and switches between them by the URL fragment:
 * "#/" for the home, "#/case/<id>" for one case.
 */
import '@fontsource-variable/noto-sans-hebrew/wght.css';
import '../shared/base.css';
import './options.css';

import {
  appendAudit,
  createCase,
  ensureCurrentCase,
  getCase,
  getImage,
  listAudit,
  listCases,
  listRecords,
  renameCase,
  setCaseArchived,
  setCurrentCase,
} from '../db/idb';
import { exportCase, exportFileName } from '../domain/export';
import { checkIntegrity, integrityOk } from '../domain/integrity';
import { formatSeq } from '../domain/numbering';
import { formatIsoWithOffset, localOffsetMinutes } from '../domain/time';
import type { Case, EvidenceRecord } from '../domain/types';
import { platformName } from '../platform/detect';
import { localizePage, t } from '../shared/i18n';
import { exportReadme, integrityLines, recordTypeLabels, tableLabels } from '../shared/labels';
import { announceChange, isRuntimeMessage, isTrustedSender } from '../shared/messages';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const els = {
  homeView: byId<HTMLElement>('home-view'),
  caseView: byId<HTMLElement>('case-view'),
  newCase: byId<HTMLButtonElement>('new-case'),
  homeAlert: byId<HTMLParagraphElement>('home-alert'),
  cards: byId<HTMLDivElement>('case-cards'),
  caseTitle: byId<HTMLHeadingElement>('case-title'),
  activeChip: byId<HTMLSpanElement>('case-active-chip'),
  archivedChip: byId<HTMLSpanElement>('case-archived-chip'),
  integrity: byId<HTMLButtonElement>('integrity'),
  exportButton: byId<HTMLButtonElement>('export'),
  caseAlert: byId<HTMLParagraphElement>('case-alert'),
  caseStatus: byId<HTMLDivElement>('case-status'),
  empty: byId<HTMLParagraphElement>('empty'),
  table: byId<HTMLTableElement>('records'),
  rows: byId<HTMLTableSectionElement>('rows'),
  nameDialog: byId<HTMLDialogElement>('name-dialog'),
  nameForm: byId<HTMLFormElement>('name-form'),
  nameTitle: byId<HTMLHeadingElement>('name-dialog-title'),
  nameInput: byId<HTMLInputElement>('name-input'),
  nameError: byId<HTMLParagraphElement>('name-error'),
  nameCancel: byId<HTMLButtonElement>('name-cancel'),
  imageDialog: byId<HTMLDialogElement>('image-dialog'),
  imageTitle: byId<HTMLElement>('image-title'),
  imageView: byId<HTMLImageElement>('image-view'),
  imageClose: byId<HTMLButtonElement>('image-close'),
};

const nowIso = (): string => {
  const now = Date.now();
  return formatIsoWithOffset(now, localOffsetMinutes(now));
};

/** "2026-11-18T14:03:22+02:00" as "2026-11-18 14:03". */
const shortTime = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { text?: string; className?: string } = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.text !== undefined) el.textContent = options.text;
  if (options.className) el.className = options.className;
  return el;
}

function button(label: string, onClick: () => void, className = 'link'): HTMLButtonElement {
  const el = element('button', { text: label, className });
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
}

/** "label value", with the value kept left-to-right so dates read correctly in a right-to-left line. */
function fact(label: string, value: string): HTMLSpanElement {
  const line = element('span', { text: `${label} ` });
  const data = element('bdi', { text: value });
  data.dir = 'ltr';
  line.append(data);
  return line;
}

function showAlert(target: HTMLElement, message: string | null): void {
  target.hidden = message === null;
  target.textContent = message ?? '';
}

// ------------------------------------------------------------ name dialog

let submitName: ((name: string) => Promise<void>) | null = null;

/** Asks for a case name; used both for a new case and for renaming one. */
function askName(title: string, initial: string, onSubmit: (name: string) => Promise<void>): void {
  els.nameTitle.textContent = title;
  els.nameInput.value = initial;
  showAlert(els.nameError, null);
  submitName = onSubmit;
  els.nameDialog.showModal();
  els.nameInput.select();
}

async function handleNameSubmit(): Promise<void> {
  const name = els.nameInput.value.trim();
  if (name === '') {
    showAlert(els.nameError, t('errorCaseNameEmpty'));
    return;
  }
  await submitName?.(name);
  els.nameDialog.close();
}

// ------------------------------------------------------------------- home

async function renderHome(): Promise<void> {
  const [cases, current] = await Promise.all([
    listCases(),
    ensureCurrentCase(t('defaultCaseTitle'), nowIso()),
  ]);
  const all = cases.some((caseRec) => caseRec.id === current.id) ? cases : [...cases, current];
  // The active case first, archived ones last, otherwise newest first.
  const rank = (caseRec: Case): number => (caseRec.id === current.id ? 0 : caseRec.archived ? 2 : 1);
  all.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));

  const cards = await Promise.all(
    all.map(async (caseRec) => {
      const records = await listRecords(caseRec.id);
      const isActive = caseRec.id === current.id;
      const classes = ['card', isActive ? 'card--active' : '', caseRec.archived ? 'card--archived' : ''];
      const card = element('article', { className: classes.filter(Boolean).join(' ') });

      const head = element('div', { className: 'card__head' });
      head.append(element('h2', { text: caseRec.title }));
      if (isActive) head.append(element('span', { text: t('caseActive'), className: 'chip' }));
      if (caseRec.archived) {
        head.append(element('span', { text: t('caseArchived'), className: 'chip chip--muted' }));
      }

      const last = records.at(-1);
      const facts = element('p', { className: 'card__facts' });
      facts.append(
        fact(t('caseRecords'), String(records.length)),
        last ? fact(t('caseLastCapture'), shortTime(last.capturedAt)) : element('span', { text: t('caseNoCaptures') }),
        fact(t('caseCreatedAt'), shortTime(caseRec.createdAt)),
      );

      const actions = element('div', { className: 'card__actions' });
      actions.append(
        button(t('open'), () => {
          location.hash = `#/case/${caseRec.id}`;
        }, 'primary'),
        button(t('rename'), () => {
          askName(t('renameCaseTitle'), caseRec.title, async (name) => {
            await renameCase(caseRec.id, name, nowIso());
            announceChange();
            await renderHome();
          });
        }),
      );
      if (!isActive && !caseRec.archived) {
        actions.append(
          button(t('makeActive'), () => {
            void run(els.homeAlert, async () => {
              await setCurrentCase(caseRec.id);
              announceChange();
              await renderHome();
            });
          }),
        );
      }
      actions.append(
        button(caseRec.archived ? t('unarchive') : t('archive'), () => {
          void run(els.homeAlert, async () => {
            if (isActive) {
              showAlert(els.homeAlert, t('archiveActiveBlocked'));
              return;
            }
            await setCaseArchived(caseRec.id, !caseRec.archived);
            announceChange();
            await renderHome();
          });
        }),
      );

      card.append(head, facts, actions);
      return card;
    }),
  );
  els.cards.replaceChildren(...cards);
}

// ------------------------------------------------------------------- case

let openCase: Case | null = null;
let records: EvidenceRecord[] = [];
let imageUrl: string | null = null;

function cell(text: string, className = ''): HTMLTableCellElement {
  return element('td', { text, className });
}

async function showImage(record: EvidenceRecord): Promise<void> {
  const blob = await getImage(record.image.fileId);
  if (!blob) return;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = URL.createObjectURL(blob);
  els.imageView.src = imageUrl;
  els.imageView.alt = record.image.fileName;
  els.imageTitle.textContent = `#${formatSeq(record.seq)} · ${record.image.fileName}`;
  els.imageDialog.showModal();
}

function renderRows(): void {
  const typeLabels = recordTypeLabels();
  els.rows.replaceChildren(
    ...records.map((record) => {
      const tr = element('tr');
      const imageCell = element('td');
      imageCell.append(button(t('viewImage'), () => void showImage(record)));
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

function showStatus(lines: readonly string[] | null, bad = false): void {
  els.caseStatus.hidden = lines === null;
  els.caseStatus.classList.toggle('status--bad', bad);
  els.caseStatus.replaceChildren(...(lines ?? []).map((line) => element('p', { text: line })));
}

async function renderCase(caseId: string): Promise<void> {
  const [caseRec, current] = await Promise.all([
    getCase(caseId),
    ensureCurrentCase(t('defaultCaseTitle'), nowIso()),
  ]);
  if (!caseRec) {
    openCase = null;
    els.caseTitle.textContent = '';
    showAlert(els.caseAlert, t('caseNotFound'));
    records = [];
    renderRows();
    return;
  }
  openCase = caseRec;
  els.caseTitle.textContent = t('caseTitlePrefix', caseRec.title);
  els.activeChip.hidden = caseRec.id !== current.id;
  els.archivedChip.hidden = !caseRec.archived;
  records = await listRecords(caseRec.id);
  renderRows();
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function runExport(): Promise<void> {
  const caseRec = openCase;
  if (!caseRec) return;
  showAlert(els.caseAlert, null);
  showStatus(null);
  els.exportButton.disabled = true;
  els.exportButton.textContent = t('exporting');

  try {
    const now = Date.now();
    const offset = localOffsetMinutes(now);
    const exportedAt = formatIsoWithOffset(now, offset);
    const fileName = exportFileName(caseRec.title, now, offset);
    const all = await listRecords(caseRec.id, { includeDeleted: true });
    const active = all.filter((record) => record.status === 'active');

    // Logged before the archive is built, so the exported log includes this export.
    await appendAudit(caseRec.id, {
      at: exportedAt,
      action: 'export',
      details: { records: active.length, deleted: all.length - active.length, file: fileName },
    });

    const result = await exportCase({
      records: all,
      audit: await listAudit(caseRec.id),
      labels: tableLabels(),
      sheet: { name: t('sheetName'), rightToLeft: t('uiDir') === 'rtl' },
      readme: exportReadme({
        caseTitle: caseRec.title,
        exportedAt,
        activeRecords: active.length,
        deletedRecords: all.length - active.length,
      }),
      loadImage: getImage,
    });
    download(result.blob, fileName);

    const lines = [t('exportDone', fileName)];
    if (result.changedImages.length > 0) {
      lines.push(t('exportChangedImages', result.changedImages.join(', ')));
    }
    showStatus(lines, result.changedImages.length > 0);
    announceChange();
  } catch (error) {
    console.error('Export failed', error);
    showAlert(els.caseAlert, t('exportFailed'));
  } finally {
    els.exportButton.textContent = t('exportZip');
    els.exportButton.disabled = records.length === 0;
  }
}

async function runIntegrityCheck(): Promise<void> {
  const caseRec = openCase ? await getCase(openCase.id) : null;
  if (!caseRec) return;
  showAlert(els.caseAlert, null);
  els.integrity.disabled = true;
  els.integrity.textContent = t('checking');
  try {
    const report = await checkIntegrity({
      caseRec,
      records: await listRecords(caseRec.id, { includeDeleted: true }),
      audit: await listAudit(caseRec.id),
      loadImage: getImage,
    });
    showStatus(integrityLines(report), !integrityOk(report));
  } finally {
    els.integrity.textContent = t('checkIntegrity');
    els.integrity.disabled = false;
  }
}

// ----------------------------------------------------------------- routing

/** Runs an action and shows its failure in the given alert instead of losing it. */
async function run(alert: HTMLElement, action: () => Promise<void>): Promise<void> {
  try {
    showAlert(alert, null);
    await action();
  } catch (error) {
    console.error(error);
    showAlert(alert, String(error));
  }
}

const CASE_ROUTE = /^#\/case\/([0-9a-f-]{36})$/;

async function route(): Promise<void> {
  const caseId = CASE_ROUTE.exec(location.hash)?.[1];
  els.homeView.hidden = caseId !== undefined;
  els.caseView.hidden = caseId === undefined;
  if (caseId === undefined) {
    await run(els.homeAlert, renderHome);
  } else {
    showStatus(null);
    await run(els.caseAlert, () => renderCase(caseId));
  }
}

function bindEvents(): void {
  window.addEventListener('hashchange', () => void route());
  // Pick up records saved from the side panel while this tab was in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void route();
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isTrustedSender(sender, chrome.runtime.id) || !isRuntimeMessage(message)) return;
    if (message.type === 'cases-changed') void route();
  });

  els.newCase.addEventListener('click', () => {
    askName(t('newCase'), '', async (name) => {
      const caseRec = await createCase(name, nowIso());
      await setCurrentCase(caseRec.id);
      announceChange();
      await renderHome();
    });
  });
  els.nameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleNameSubmit().catch((error: unknown) => showAlert(els.nameError, String(error)));
  });
  els.nameCancel.addEventListener('click', () => els.nameDialog.close());

  els.exportButton.addEventListener('click', () => void runExport());
  els.integrity.addEventListener('click', () => void run(els.caseAlert, runIntegrityCheck));
  els.imageClose.addEventListener('click', () => els.imageDialog.close());
  els.imageDialog.addEventListener('close', () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
    els.imageView.removeAttribute('src');
  });
}

localizePage();
bindEvents();
void route();
