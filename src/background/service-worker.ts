/**
 * Service worker: reacts to the toolbar icon and the keyboard shortcut,
 * takes the screenshot, and hands it to the side panel.
 *
 * It never acts on its own. Every capture starts from a user gesture, which
 * is also what makes Chrome grant `activeTab` for the tab in question.
 */
import { emptyExtraction, sanitizeExtracted } from '../adapters/sanitize';
import { dataUrlToBlob } from '../capture/data-url';
import { addPending, clearPending, setSetting } from '../db/idb';
import { localOffsetMinutes, localTimeZone } from '../domain/time';
import type { ExtractedInfo, PendingCapture, Platform } from '../domain/types';
import { detectPlatform } from '../platform/detect';
import {
  LAST_FAILURE_KEY,
  type CaptureFailure,
  type PanelPong,
  type RuntimeMessage,
  type StoredFailure,
} from '../shared/messages';

const COMMAND_CAPTURE_VISIBLE = 'capture-visible';

/**
 * Opening the side panel narrows the page a few hundred milliseconds after
 * `sidePanel.open()` returns. These bound the wait for that to happen.
 */
const RESIZE_POLL_MS = 50;
const RESIZE_TIMEOUT_MS = 1500;
/** Unchanged size readings required before the page counts as settled. */
const SETTLED_READS = 2;
/**
 * Chrome allows two `captureVisibleTab` calls per second. Spacing requests
 * this far apart keeps a quick double press inside that quota.
 */
const SCREENSHOT_INTERVAL_MS = 600;

/** Windows with a capture in progress; a second trigger is ignored. */
const capturing = new Set<number>();

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function notify(message: RuntimeMessage): void {
  // Rejects when no extension page is open to listen; the side panel also
  // reads the result from the database when it loads.
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function reportFailure(windowId: number, reason: CaptureFailure): Promise<void> {
  const failure: StoredFailure = { windowId, reason, atMs: Date.now() };
  await setSetting(LAST_FAILURE_KEY, failure).catch(() => undefined);
  notify({ type: 'capture-failed', windowId, reason });
}

/** Asks the side panel of a window whether it is there. No answer means it is not. */
function pingPanel(windowId: number): Promise<boolean> {
  const ping: RuntimeMessage = { type: 'panel-ping', windowId };
  return chrome.runtime.sendMessage(ping).then(
    (reply: PanelPong | undefined) => reply?.open === true,
    () => false,
  );
}

const sameSize = (a: chrome.tabs.Tab, b: chrome.tabs.Tab): boolean =>
  a.width === b.width && a.height === b.height;

/**
 * Waits for the page to take its new size after the side panel opened.
 *
 * A screenshot requested while the page is being resized fails or shows a
 * half-finished layout, so the capture waits until the size has changed and
 * then stopped changing. If it never changes, the capture goes ahead anyway.
 */
async function waitForResize(before: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  const tabId = before.id;
  if (tabId === undefined) return before;
  const deadline = Date.now() + RESIZE_TIMEOUT_MS;

  let current = await chrome.tabs.get(tabId);
  while (sameSize(current, before) && Date.now() < deadline) {
    await delay(RESIZE_POLL_MS);
    current = await chrome.tabs.get(tabId);
  }

  let settledReads = 1;
  while (settledReads < SETTLED_READS && Date.now() < deadline) {
    await delay(RESIZE_POLL_MS);
    const next = await chrome.tabs.get(tabId);
    settledReads = sameSize(next, current) ? settledReads + 1 : 1;
    current = next;
  }
  return current;
}

/** When the last screenshot was requested, to stay inside Chrome's quota. */
let lastScreenshotAtMs = 0;

async function requestScreenshot(windowId: number): Promise<{ dataUrl: string; capturedAtMs: number }> {
  const wait = lastScreenshotAtMs + SCREENSHOT_INTERVAL_MS - Date.now();
  if (wait > 0) await delay(wait);
  const capturedAtMs = Date.now();
  lastScreenshotAtMs = capturedAtMs;
  return { dataUrl: await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }), capturedAtMs };
}

/** Takes the screenshot, with one retry: a capture can fail while the page is still repainting. */
async function takeScreenshot(windowId: number): Promise<{ dataUrl: string; capturedAtMs: number }> {
  try {
    return await requestScreenshot(windowId);
  } catch (error) {
    console.warn('Screenshot failed, retrying once', error);
    return requestScreenshot(windowId);
  }
}

/** The page-side reader, built as one self-contained file. */
const ADAPTER_FILE = 'adapter.js';

/**
 * Reads the post's details from the page that was just captured.
 *
 * The reader runs in the extension's isolated world of that one tab, which
 * `activeTab` allows only because the user asked for this capture. It runs
 * after the screenshot, so it cannot affect what the screenshot shows.
 * Whatever comes back is page content and goes through the sanitizer.
 */
async function readPageDetails(tabId: number, platform: Platform): Promise<ExtractedInfo> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [ADAPTER_FILE] });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      // Self-contained on purpose: this function is sent to the page as text.
      func: () => globalThis.__socialEvidenceExtract?.() ?? null,
    });
    return sanitizeExtracted(injection?.result, platform);
  } catch (error) {
    // The capture is still valid without the details; the user types them in.
    console.warn('Page details could not be read', error);
    return emptyExtraction(platform);
  }
}

async function captureVisible(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  const windowId = tab.windowId;
  if (capturing.has(windowId)) return;
  capturing.add(windowId);

  // Both calls are made before the first `await`:
  //
  // - The side panel can only be opened during the user gesture of this
  //   event, and the gesture does not survive an asynchronous gap. Opening it
  //   after the screenshot is therefore not possible.
  // - The ping is sent first, so only a panel that was already open answers.
  const panelWasOpen = pingPanel(windowId);
  const panelOpened = chrome.sidePanel.open({ windowId }).catch((error: unknown) => {
    console.warn('Side panel could not be opened', error);
  });

  try {
    await panelOpened;
    // The screenshot always shows the page as it is displayed beside the
    // panel. With the panel already open nothing is about to move.
    const current = (await panelWasOpen) ? await chrome.tabs.get(tabId) : await waitForResize(tab);

    const pageUrl = current.url ?? tab.url ?? '';
    const platform = detectPlatform(pageUrl);
    if (!platform) {
      // Browser pages, local files and the like cannot be captured.
      await reportFailure(windowId, 'unsupported-page');
      return;
    }

    const { dataUrl, capturedAtMs } = await takeScreenshot(windowId);
    const extracted = await readPageDetails(tabId, platform);
    const pending: PendingCapture = {
      windowId,
      tabId,
      pageUrl,
      platform,
      capturedAtMs,
      offsetMinutes: localOffsetMinutes(capturedAtMs),
      timeZone: localTimeZone(),
      tabWidth: current.width ?? 0,
      tabHeight: current.height ?? 0,
      captureMode: 'visible',
      extracted,
      image: dataUrlToBlob(dataUrl),
    };
    const pendingId = await addPending(pending);
    notify({ type: 'capture-ready', windowId, pendingId });
  } catch (error) {
    console.error('Capture failed', error);
    await reportFailure(windowId, 'capture-failed');
  } finally {
    capturing.delete(windowId);
  }
}

chrome.action.onClicked.addListener((tab) => {
  void captureVisible(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === COMMAND_CAPTURE_VISIBLE) void captureVisible(tab);
});

// Window ids do not survive a browser restart, so unsaved captures from the
// previous session can no longer be matched to a side panel.
chrome.runtime.onStartup.addListener(() => {
  void clearPending().catch(() => undefined);
});
