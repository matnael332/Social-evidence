import { describe, expect, it } from 'vitest';
import { isRuntimeMessage, isTrustedSender } from '../src/shared/messages';

describe('isRuntimeMessage', () => {
  it('accepts the messages the extension sends', () => {
    expect(isRuntimeMessage({ type: 'panel-ping', windowId: 3 })).toBe(true);
    expect(isRuntimeMessage({ type: 'capture-ready', windowId: 3, pendingId: 12 })).toBe(true);
    expect(isRuntimeMessage({ type: 'capture-failed', windowId: 3, reason: 'unsupported-page' })).toBe(true);
    expect(isRuntimeMessage({ type: 'cases-changed' })).toBe(true);
  });

  it('rejects unknown types and missing fields', () => {
    expect(isRuntimeMessage({ type: 'run-code', windowId: 3 })).toBe(false);
    expect(isRuntimeMessage({ type: 'capture-ready', windowId: 3 })).toBe(false);
    expect(isRuntimeMessage({ type: 'panel-ping' })).toBe(false);
    expect(isRuntimeMessage({ windowId: 3 })).toBe(false);
  });

  it('rejects fields of the wrong kind', () => {
    expect(isRuntimeMessage({ type: 'capture-ready', windowId: '3', pendingId: 12 })).toBe(false);
    expect(isRuntimeMessage({ type: 'capture-ready', windowId: 3, pendingId: 1.5 })).toBe(false);
    expect(isRuntimeMessage({ type: 'capture-failed', windowId: 3, reason: 'anything-else' })).toBe(false);
    expect(isRuntimeMessage({ type: 'capture-failed', windowId: 3, reason: { toString: () => 'capture-failed' } })).toBe(false);
  });

  it('rejects values that are not objects', () => {
    for (const value of [null, undefined, 'capture-ready', 7, true, []]) {
      expect(isRuntimeMessage(value)).toBe(false);
    }
  });
});

describe('isTrustedSender', () => {
  const OWN = 'abcdefghijklmnopabcdefghijklmnop';
  const ORIGIN = `chrome-extension://${OWN}`;

  it("trusts the extension's own service worker", () => {
    expect(isTrustedSender({ id: OWN, origin: ORIGIN, url: `${ORIGIN}/service-worker.js` }, OWN)).toBe(true);
  });

  it("trusts the extension's own pages, also when they are open in a tab", () => {
    expect(isTrustedSender({ id: OWN, origin: ORIGIN, url: `${ORIGIN}/options/index.html` }, OWN)).toBe(true);
    expect(isTrustedSender({ id: OWN, url: `${ORIGIN}/sidepanel/index.html` }, OWN)).toBe(true);
  });

  it('refuses another extension', () => {
    const other = 'ponmlkjihgfedcbaponmlkjihgfedcba';
    expect(isTrustedSender({ id: other, origin: `chrome-extension://${other}` }, OWN)).toBe(false);
    expect(isTrustedSender({ origin: ORIGIN }, OWN)).toBe(false);
  });

  it('refuses a script running inside a web page, even with the right id', () => {
    expect(isTrustedSender({ id: OWN, origin: 'https://social.example', url: 'https://social.example/post' }, OWN)).toBe(false);
    expect(isTrustedSender({ id: OWN, url: 'https://social.example/post' }, OWN)).toBe(false);
  });

  it('refuses an address that only starts like the extension', () => {
    expect(isTrustedSender({ id: OWN, url: `${ORIGIN}.evil.example/page` }, OWN)).toBe(false);
    expect(isTrustedSender({ id: OWN, origin: `${ORIGIN}.evil.example` }, OWN)).toBe(false);
  });

  it('refuses a sender that says nothing about where it runs', () => {
    expect(isTrustedSender({ id: OWN }, OWN)).toBe(false);
  });
});
