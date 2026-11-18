/**
 * Side panel: shows the screenshot that was just taken, lets the user correct
 * the details, and saves the finished record.
 */
import '@fontsource-variable/noto-sans-hebrew/wght.css';
import '../shared/base.css';
import './panel.css';

import {
  commitCapture,
  deletePending,
  ensureCurrentCase,
  getCase,
  getPending,
  getSetting,
  listPending,
  listRecords,
  setSetting,
} from '../db/idb';
import { sha256Hex } from '../domain/hash';
import { formatSeq } from '../domain/numbering';
import { buildRecord, normalizeFields, stickyFrom } from '../domain/record';
import {
  formatIsoWithOffset,
  formatStripTime,
  joinPublishedAt,
  localOffsetMinutes,
} from '../domain/time';
import {
  EMPTY_STICKY,
  RECORD_TYPES,
  type Case,
  type EvidenceRecord,
  type PendingCapture,
  type RecordFields,
  type RecordType,
  type StickyFields,
} from '../domain/types';
import { platformName } from '../platform/detect';
import { localizePage, t } from '../shared/i18n';
import {
  LAST_FAILURE_KEY,
  type CaptureFailure,
  type PanelPong,
  type RuntimeMessage,
  type StoredFailure,
} from '../shared/messages';
import { composeEvidenceImage, type ComposedImage } from '../watermark/draw';
import { stripRows, type StripRow } from '../watermark/layout';

const STICKY_KEY = 'stickyFields';
/** How many times a save restarts when another window took the number first. */
const MAX_SAVE_ATTEMPTS = 5;
/** A stored failure older than this is not shown when the panel opens. */
const FAILURE_FRESH_MS = 15_000;
const PREVIEW_DEBOUNCE_MS = 350;
const TOAST_MS = 3500;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const els = {
  caseChip: byId<HTMLSpanElement>('case-chip'),
  openManage: byId<HTMLButtonElement>('open-manage'),
  alert: byId<HTMLParagraphElement>('alert'),
  empty: byId<HTMLElement>('empty'),
  savedCount: byId<HTMLParagraphElement>('saved-count'),
  form: byId<HTMLFormElement>('capture-form'),
  preview: byId<HTMLImageElement>('preview'),
  captureNumber: byId<HTMLSpanElement>('capture-number'),
  captureFacts: byId<HTMLSpanElement>('capture-facts'),
  recordType: byId<HTMLSelectElement>('recordType'),
  url: byId<HTMLInputElement>('url'),
  publisher: byId<HTMLInputElement>('publisher'),
  groupOrPage: byId<HTMLInputElement>('groupOrPage'),
  groupAdmins: byId<HTMLTextAreaElement>('groupAdmins'),
  echoes: byId<HTMLTextAreaElement>('echoes'),
  publishedAtText: byId<HTMLInputElement>('publishedAtText'),
  publishedDate: byId<HTMLInputElement>('publishedDate'),
  publishedTime: byId<HTMLInputElement>('publishedTime'),
  keyword: byId<HTMLInputElement>('keyword'),
  notes: byId<HTMLTextAreaElement>('notes'),
  clearSticky: byId<HTMLButtonElement>('clear-sticky'),
  save: byId<HTMLButtonElement>('save'),
  discard: byId<HTMLButtonElement>('discard'),
  toast: byId<HTMLDivElement>('toast'),
};

interface State {
  windowId: number;
  caseRec: Case | null;
  sticky: StickyFields;
  pending: PendingCapture | null;
  /** True once the user typed something that is not carried over to the next capture. */
  dirty: boolean;
  saving: boolean;
  previewUrl: string | null;
  /** Guards against an older preview finishing after a newer one. */
  previewToken: number;
}

const state: State = {
  windowId: -1,
  caseRec: null,
  sticky: EMPTY_STICKY,
  pending: null,
  dirty: false,
  saving: false,
  previewUrl: null,
  previewToken: 0,
};

const nowIso = (): string => {
  const now = Date.now();
  return formatIsoWithOffset(now, localOffsetMinutes(now));
};

// ------------------------------------------------------------------- view

function render(): void {
  const hasCapture = state.pending !== null;
  els.form.hidden = !hasCapture;
  els.empty.hidden = hasCapture;
  els.caseChip.textContent = state.caseRec ? t('caseChip', state.caseRec.title) : '';
  els.save.disabled = state.saving;
  els.discard.disabled = state.saving;
  els.save.textContent = state.saving ? t('saving') : t('save');
}

function showAlert(message: string | null): void {
  els.alert.hidden = message === null;
  els.alert.textContent = message ?? '';
}

let toastTimer: number | undefined;

function showToast(message: string): void {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, TOAST_MS);
}

function failureMessage(reason: CaptureFailure): string {
  return reason === 'unsupported-page' ? t('errorUnsupportedPage') : t('errorCaptureFailed');
}

async function refreshSavedCount(): Promise<void> {
  if (!state.caseRec) return;
  const records = await listRecords(state.caseRec.id);
  els.savedCount.textContent = t('savedCount', String(records.length));
}

// ------------------------------------------------------------------- form

function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

function readFields(): RecordFields {
  return {
    recordType: isRecordType(els.recordType.value) ? els.recordType.value : 'post',
    url: els.url.value,
    publisher: els.publisher.value,
    groupOrPage: els.groupOrPage.value,
    groupAdmins: els.groupAdmins.value,
    echoes: els.echoes.value,
    publishedAtText: els.publishedAtText.value,
    publishedAt: joinPublishedAt(els.publishedDate.value, els.publishedTime.value),
    keyword: els.keyword.value,
    notes: els.notes.value,
  };
}

function applySticky(sticky: StickyFields): void {
  els.recordType.value = sticky.recordType;
  els.groupOrPage.value = sticky.groupOrPage;
  els.groupAdmins.value = sticky.groupAdmins;
  els.keyword.value = sticky.keyword;
}

/** Starts a fresh form for a capture: sticky values carried over, the rest empty. */
function fillForm(pending: PendingCapture): void {
  els.form.reset();
  applySticky(state.sticky);
  els.url.value = pending.pageUrl;
  state.dirty = false;
}

// ---------------------------------------------------------------- preview

function rowsFor(pending: PendingCapture, seq: number, postUrl: string): StripRow[] {
  return stripRows({
    seq: formatSeq(seq),
    pageUrl: pending.pageUrl,
    manualUrl: postUrl,
    time: formatStripTime(pending.capturedAtMs, pending.offsetMinutes, pending.timeZone),
    platform: platformName(pending.platform),
    labels: { pageUrl: t('stripPageUrlLabel'), manualUrl: t('stripManualUrlLabel') },
  });
}

function compose(pending: PendingCapture, seq: number, postUrl: string): Promise<ComposedImage> {
  return composeEvidenceImage(pending.image, rowsFor(pending, seq, postUrl), {
    width: pending.tabWidth,
    height: pending.tabHeight,
  });
}

function setPreview(blob: Blob | null): void {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = blob ? URL.createObjectURL(blob) : null;
  if (state.previewUrl) els.preview.src = state.previewUrl;
  else els.preview.removeAttribute('src');
}

/**
 * Draws the image as it will be saved. The number shown is provisional: the
 * real one is assigned when the record is saved.
 */
async function refreshPreview(): Promise<void> {
  const pending = state.pending;
  if (!pending || !state.caseRec) return;
  const token = (state.previewToken += 1);

  const current = await getCase(state.caseRec.id);
  const seq = current?.nextSeq ?? state.caseRec.nextSeq;
  const postUrl = normalizeFields(readFields(), pending.pageUrl).url;
  const composed = await compose(pending, seq, postUrl);
  if (token !== state.previewToken || state.pending !== pending) return;

  setPreview(composed.blob);
  els.captureNumber.textContent = t('provisionalNumber', formatSeq(seq));
  els.captureFacts.textContent = [
    formatStripTime(pending.capturedAtMs, pending.offsetMinutes, ''),
    platformName(pending.platform),
  ].join(' · ');
}

let previewTimer: number | undefined;

function schedulePreview(): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    void refreshPreview().catch((error: unknown) => console.error('Preview failed', error));
  }, PREVIEW_DEBOUNCE_MS);
}

// ---------------------------------------------------------------- capture

async function startCapture(pending: PendingCapture): Promise<void> {
  state.pending = pending;
  showAlert(null);
  setPreview(null);
  fillForm(pending);
  render();
  window.scrollTo({ top: 0 });
  await refreshPreview();
}

/** Takes over a new screenshot, unless the user prefers to keep the unsaved one. */
async function offerCapture(pendingId: number): Promise<void> {
  const next = await getPending(pendingId);
  if (!next) return;

  const previous = state.pending;
  if (previous && previous.id !== pendingId) {
    if (state.saving || (state.dirty && !window.confirm(t('confirmReplaceCapture')))) {
      await deletePending(pendingId);
      return;
    }
    if (previous.id !== undefined) await deletePending(previous.id);
  }
  await startCapture(next);
}

/** Picks up a screenshot taken before this panel was listening. */
async function loadWaitingCapture(): Promise<void> {
  const waiting = await listPending(state.windowId);
  const newest = waiting.at(-1);
  // Older leftovers of this window can never be saved any more.
  for (const stale of waiting.slice(0, -1)) {
    if (stale.id !== undefined) await deletePending(stale.id);
  }
  if (newest) await startCapture(newest);
}

async function showRecentFailure(): Promise<void> {
  const failure = await getSetting<StoredFailure>(LAST_FAILURE_KEY);
  if (!failure || failure.windowId !== state.windowId) return;
  if (Date.now() - failure.atMs > FAILURE_FRESH_MS) return;
  showAlert(failureMessage(failure.reason));
}

// ------------------------------------------------------------------- save

async function saveCapture(): Promise<void> {
  const pending = state.pending;
  const caseRec = state.caseRec;
  if (!pending || !caseRec || state.saving) return;

  if (els.publishedTime.value && !els.publishedDate.value) {
    showAlert(t('errorPublishedTimeWithoutDate'));
    els.publishedDate.focus();
    return;
  }

  const fields = normalizeFields(readFields(), pending.pageUrl);
  state.saving = true;
  showAlert(null);
  render();

  try {
    let saved: EvidenceRecord | null = null;

    // The number is burned into the image, so the image is drawn first and the
    // number is confirmed when writing. If another window saved in between,
    // start over with the next number. See SPEC.md §6.4.
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS && !saved; attempt += 1) {
      const current = await getCase(caseRec.id);
      if (!current) throw new Error('The case no longer exists');
      const seq = current.nextSeq;

      const composed = await compose(pending, seq, fields.url);
      const sha256 = await sha256Hex(await composed.blob.arrayBuffer());
      const record = buildRecord({
        id: crypto.randomUUID(),
        caseId: current.id,
        seq,
        pending,
        fields,
        image: {
          fileId: crypto.randomUUID(),
          sha256,
          bytes: composed.blob.size,
          width: composed.width,
          height: composed.height,
        },
        savedAtMs: Date.now(),
      });

      const written = await commitCapture({
        expectedSeq: seq,
        record,
        image: composed.blob,
        pendingId: pending.id,
      });
      if (written) saved = record;
    }

    if (!saved) throw new Error('Could not reserve a running number');

    state.sticky = stickyFrom(saved);
    await setSetting(STICKY_KEY, state.sticky);

    state.pending = null;
    state.dirty = false;
    setPreview(null);
    showToast(t('savedToast', formatSeq(saved.seq)));
    await refreshSavedCount();
  } catch (error) {
    console.error('Save failed', error);
    showAlert(t('errorSaveFailed'));
  } finally {
    state.saving = false;
    render();
  }
}

async function discardCapture(): Promise<void> {
  const pending = state.pending;
  if (!pending || state.saving) return;
  if (state.dirty && !window.confirm(t('confirmDiscard'))) return;

  if (pending.id !== undefined) await deletePending(pending.id);
  state.pending = null;
  state.dirty = false;
  setPreview(null);
  render();
}

async function clearSticky(): Promise<void> {
  state.sticky = EMPTY_STICKY;
  applySticky(EMPTY_STICKY);
  await setSetting(STICKY_KEY, EMPTY_STICKY);
  showToast(t('stickyCleared'));
}

// ------------------------------------------------------------------- init

function bindEvents(): void {
  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveCapture();
  });
  els.discard.addEventListener('click', () => void discardCapture());
  els.clearSticky.addEventListener('click', () => void clearSticky());
  els.openManage.addEventListener('click', () => void chrome.runtime.openOptionsPage());

  els.form.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    // Sticky values survive a replaced capture anyway, so they do not count.
    if (!target.hasAttribute('data-sticky')) state.dirty = true;
    // The post link appears on the strip, so the preview follows it.
    if (target === els.url) schedulePreview();
  });

  chrome.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse: (reply: PanelPong) => void) => {
      if (message.windowId !== state.windowId) return;
      if (message.type === 'panel-ping') {
        sendResponse({ open: true });
      } else if (message.type === 'capture-ready') {
        void offerCapture(message.pendingId).catch((error: unknown) => {
          console.error('Could not load the capture', error);
          showAlert(t('errorCaptureFailed'));
        });
      } else if (message.type === 'capture-failed') {
        showAlert(failureMessage(message.reason));
      }
    },
  );
}

async function init(): Promise<void> {
  localizePage();
  els.preview.alt = t('previewAlt');

  const [currentWindow, caseRec, sticky] = await Promise.all([
    chrome.windows.getCurrent(),
    ensureCurrentCase(t('defaultCaseTitle'), nowIso()),
    getSetting<StickyFields>(STICKY_KEY),
  ]);
  state.windowId = currentWindow.id ?? -1;
  state.caseRec = caseRec;
  state.sticky = { ...EMPTY_STICKY, ...sticky };

  bindEvents();
  render();
  await refreshSavedCount();
  await showRecentFailure();
  await loadWaitingCapture();
}

void init().catch((error: unknown) => {
  console.error('Side panel failed to start', error);
  showAlert(String(error));
});
