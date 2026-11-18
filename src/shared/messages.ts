/** Messages sent from the service worker to the extension's own pages. */

export type CaptureFailure = 'unsupported-page' | 'capture-failed';

export type RuntimeMessage =
  /** "Is the side panel of this window open?" Only that panel answers, with `PanelPong`. */
  | { type: 'panel-ping'; windowId: number }
  | { type: 'capture-ready'; windowId: number; pendingId: number }
  | { type: 'capture-failed'; windowId: number; reason: CaptureFailure };

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
