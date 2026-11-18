/**
 * Adapter for Instagram. Posts carry a <time datetime> element, which gives
 * both the shown date and an exact one. The rest of the DOM reader has not
 * been checked against the live site.
 */
import { firstText, firstTimeElement, metaContent, pathSegments } from './dom';
import type { ExtractedValues, PageAdapter } from './types';

export type InstagramUrlKind = 'post' | 'profile' | 'other';

export interface InstagramUrlInfo {
  kind: InstagramUrlKind;
  handle?: string;
  code?: string;
}

const POST_SECTIONS = new Set(['p', 'reel', 'reels', 'tv']);

/** First path segments that are sections of the site, not a profile. */
const RESERVED = new Set([
  'explore', 'accounts', 'direct', 'stories', 'about', 'legal', 'developer', 'challenge',
  'web', 'emails', 'session', 'nametag', 'directory', 'locations', 'api', 'graphql',
]);

export function parseInstagramUrl(url: URL): InstagramUrlInfo {
  const [first, second, third] = pathSegments(url);
  if (!first) return { kind: 'other' };

  if (POST_SECTIONS.has(first)) {
    return second ? { kind: 'post', code: second } : { kind: 'other' };
  }
  if (first === 'stories') {
    return second && third ? { kind: 'post', handle: second, code: third } : { kind: 'other' };
  }
  if (RESERVED.has(first.toLowerCase())) return { kind: 'other' };

  // Newer links put the profile first: /<handle>/p/<code>/
  if (second && POST_SECTIONS.has(second)) {
    return third ? { kind: 'post', handle: first, code: third } : { kind: 'other', handle: first };
  }
  return second === undefined ? { kind: 'profile', handle: first } : { kind: 'other', handle: first };
}

/** "(@handle)" as it appears in a profile's page title, in any interface language. */
const HANDLE_IN_TITLE = /\(@([A-Za-z0-9._]{1,30})\)/;

export const instagramAdapter: PageAdapter = {
  id: 'instagram',
  version: '1',

  extract(doc: Document, url: URL): ExtractedValues {
    const info = parseInstagramUrl(url);
    const fromTitle = HANDLE_IN_TITLE.exec(metaContent(doc, ['meta[property="og:title"]']))?.[1];
    const handle =
      info.handle ??
      fromTitle ??
      firstText(doc, ['article header a[role="link"]', 'header a[role="link"]', 'article header a']).replace(/^@/, '');
    const time = info.kind === 'post' ? firstTimeElement(doc) : { text: '', normalized: '' };

    return {
      publisher: handle ? `@${handle}` : '',
      publishedAtText: time.text,
      publishedAt: time.normalized,
    };
  },
};
