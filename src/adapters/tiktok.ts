/**
 * Adapter for TikTok. The handle comes from the URL, which is reliable. The
 * DOM reader relies on TikTok's `data-e2e` attributes and has not been
 * checked against the live site.
 */
import { clean, firstText, pathSegments } from './dom';
import type { ExtractedValues, PageAdapter } from './types';

export type TikTokUrlKind = 'post' | 'profile' | 'other';

export interface TikTokUrlInfo {
  kind: TikTokUrlKind;
  /** Without the leading "@". */
  handle?: string;
  postId?: string;
}

const SHORT_LINK_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

export function parseTikTokUrl(url: URL): TikTokUrlInfo {
  const [first, second, third] = pathSegments(url);

  if (first?.startsWith('@') && first.length > 1) {
    const handle = first.slice(1);
    if ((second === 'video' || second === 'photo') && third) {
      return { kind: 'post', handle, postId: third };
    }
    return second === undefined ? { kind: 'profile', handle } : { kind: 'other', handle };
  }
  // Short share links redirect to a single video.
  if (first === 't' && second) return { kind: 'post' };
  if (SHORT_LINK_HOSTS.has(url.hostname) && first) return { kind: 'post' };
  return { kind: 'other' };
}

export const tiktokAdapter: PageAdapter = {
  id: 'tiktok',
  version: '1',

  extract(doc: Document, url: URL): ExtractedValues {
    const info = parseTikTokUrl(url);
    const handle =
      info.handle ??
      firstText(doc, ['[data-e2e="browse-username"]', '[data-e2e="video-author-uniqueid"]']).replace(/^@/, '');

    // On a video page the nickname element holds "Name · date" in separate spans.
    const nicknameBox = doc.querySelector('[data-e2e="browser-nickname"]');
    const spans = nicknameBox ? [...nicknameBox.querySelectorAll('span')] : [];
    const nickname =
      clean(spans[0]?.textContent) ||
      firstText(doc, ['[data-e2e="video-author-nickname"]', '[data-e2e="user-subtitle"]']);
    const dateText = spans.length >= 3 ? clean(spans.at(-1)?.textContent) : '';

    const tag = handle ? `@${handle}` : '';
    const publisher = nickname && tag ? `${nickname} (${tag})` : nickname || tag;

    return {
      publisher,
      publishedAtText: info.kind === 'post' && /\d/.test(dateText) ? dateText : '',
    };
  },
};
