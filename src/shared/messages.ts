/** Messages exchanged between the service worker and the extension's own pages. */

export type CaptureFailure = 'unsupported-page' | 'capture-failed';

export type RuntimeMessage =
  /** "Is the side panel of this window open?" Only that panel answers, with `PanelPong`. */
  | { type: 'panel-ping'; windowId: number }
  | { type: 'capture-ready'; windowId: number; pendingId: number }
  | { type: 'capture-failed'; windowId: number; reason: CaptureFailure }
  /** A case or its records changed; open pages reload what they show. */
  | { type: 'cases-changed' };

export interface PanelPong {
  open: true;
}

/** The last failure is also stored, for a side panel that was not open yet. */
export const LAST_FAILURE_KEY = 'lastCaptureFailure';

export interface StoredFailure {
  windowId: number;
  reason: CaptureFailure;
  atMs: number;
}

const FAILURES: readonly string[] = ['unsupported-page', 'capture-failed'];

const isId = (value: unknown): value is number => Number.isSafeInteger(value);

/** Checks the shape of an incoming message. Anything unexpected is ignored by the caller. */
export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;

  switch (message.type) {
    case 'cases-changed':
      return true;
    case 'panel-ping':
      return isId(message.windowId);
    case 'capture-ready':
      return isId(message.windowId) && isId(message.pendingId);
    case 'capture-failed':
      return (
        isId(message.windowId) &&
        typeof message.reason === 'string' &&
        FAILURES.includes(message.reason)
      );
    default:
      return false;
  }
}

/** The part of `chrome.runtime.MessageSender` that decides whether a sender is trusted. */
export interface SenderLike {
  id?: string;
  /** Origin of the document or worker that sent the message. */
  origin?: string;
  url?: string;
}

/**
 * True for a message from this extension's own service worker or pages.
 *
 * A script that the extension runs inside a web page also carries the
 * extension's id, but its origin is the web page's. The extension never
 * expects messages from there, so the origin has to be the extension's own.
 */
export function isTrustedSender(sender: SenderLike, ownId: string): boolean {
  if (sender.id !== ownId) return false;
  const ownOrigin = `chrome-extension://${ownId}`;
  if (sender.origin !== undefined) return sender.origin === ownOrigin;
  return sender.url !== undefined && sender.url.startsWith(`${ownOrigin}/`);
}

/** Tells the other open pages of the extension that cases or records changed. */
export function announceChange(): void {
  const message: RuntimeMessage = { type: 'cases-changed' };
  // Rejects when no other page is open; that is fine.
  chrome.runtime.sendMessage(message).catch(() => undefined);
}
