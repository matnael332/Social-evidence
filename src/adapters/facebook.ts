/**
 * Adapter for Facebook.
 *
 * The URL parser is exact and tested. The DOM reader is a set of cautious
 * guesses: Facebook's markup uses generated class names and changes often,
 * and it has not been checked against the live site. Every value it returns
 * is shown to the user as "read from the page" and must be confirmed.
 */
import { clean, firstText, pathSegments } from './dom';
import type { ExtractedValues, PageAdapter } from './types';

export type FacebookUrlKind = 'post' | 'group' | 'profileOrPage' | 'other';

export interface FacebookUrlInfo {
  kind: FacebookUrlKind;
  groupId?: string;
  pageSlug?: string;
  postId?: string;
}

/** First path segments that are sections of the site, not a profile or a page. */
const RESERVED = new Set([
  'groups', 'watch', 'marketplace', 'events', 'gaming', 'friends', 'notifications', 'messages',
  'login', 'login.php', 'home.php', 'settings', 'help', 'pages', 'stories', 'reel', 'reels',
  'share', 'photo', 'photo.php', 'permalink.php', 'story.php', 'profile.php', 'search', 'hashtag',
  'bookmarks', 'saved', 'memories', 'ads', 'business', 'policies', 'privacy', 'legal',
]);

export function parseFacebookUrl(url: URL): FacebookUrlInfo {
  const [first, second, third, fourth] = pathSegments(url);
  const query = url.searchParams;

  if (first === 'groups' && second) {
    if ((third === 'posts' || third === 'permalink') && fourth) {
      return { kind: 'post', groupId: second, postId: fourth };
    }
    // A post opened from a group feed can also appear as ?multi_permalinks=<id>.
    const multi = query.get('multi_permalinks');
    if (multi) return { kind: 'post', groupId: second, postId: multi };
    return { kind: 'group', groupId: second };
  }

  if (first === 'permalink.php' || first === 'story.php') {
    const postId = query.get('story_fbid');
    return postId ? { kind: 'post', postId } : { kind: 'other' };
  }
  if (first === 'photo.php' || first === 'photo') {
    const postId = query.get('fbid');
    return postId ? { kind: 'post', postId } : { kind: 'other' };
  }
  if (first === 'watch') {
    const postId = query.get('v');
    return postId ? { kind: 'post', postId } : { kind: 'other' };
  }
  if (first === 'reel' && second) return { kind: 'post', postId: second };
  if (first === 'share' && (second === 'p' || second === 'v' || second === 'r') && third) {
    return { kind: 'post', postId: third };
  }
  if (first === 'profile.php') {
    return query.get('id') ? { kind: 'profileOrPage' } : { kind: 'other' };
  }

  if (first && !RESERVED.has(first.toLowerCase())) {
    if ((second === 'posts' || second === 'videos' || second === 'photos') && third) {
      return { kind: 'post', pageSlug: first, postId: fourth ?? third };
    }
    return { kind: 'profileOrPage', pageSlug: first };
  }
  return { kind: 'other' };
}

/** Link targets that lead to a single post; their link text is usually the post's date. */
const POST_LINK = /\/posts\/|\/permalink\/|story_fbid|\/videos\/|\/photo|\/reel\//;

function isGroupRootLink(anchor: HTMLAnchorElement, groupId: string, base: URL): boolean {
  try {
    const [first, second, third] = pathSegments(new URL(anchor.getAttribute('href') ?? '', base));
    return first === 'groups' && second === groupId && third === undefined;
  } catch {
    return false;
  }
}

function readGroupName(scope: ParentNode, groupId: string, base: URL): string {
  for (const anchor of scope.querySelectorAll<HTMLAnchorElement>('a[href*="/groups/"]')) {
    const text = clean(anchor.textContent);
    if (text !== '' && text.length <= 120 && isGroupRootLink(anchor, groupId, base)) return text;
  }
  return '';
}

function readPostDate(article: ParentNode): string {
  for (const anchor of article.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!POST_LINK.test(anchor.getAttribute('href') ?? '')) continue;
    // The visible date is sometimes scrambled on purpose; the label is not.
    const label = clean(anchor.getAttribute('aria-label'));
    if (label !== '' && label.length <= 60) return label;
    const text = clean(anchor.textContent);
    if (text !== '' && text.length <= 40 && /\d/.test(text)) return text;
  }
  return '';
}

export const facebookAdapter: PageAdapter = {
  id: 'facebook',
  version: '1',

  extract(doc: Document, url: URL): ExtractedValues {
    const info = parseFacebookUrl(url);
    const main: ParentNode = doc.querySelector('[role="main"]') ?? doc;
    const article: ParentNode = main.querySelector('[role="article"]') ?? main;

    const publisher = firstText(article, [
      'h2 a[role="link"]', 'h3 a[role="link"]', 'h4 a[role="link"]',
      'h2 strong', 'h3 strong', 'h4 strong',
    ]);
    const groupOrPage = info.groupId
      ? readGroupName(doc, info.groupId, url)
      : info.kind === 'profileOrPage' || info.pageSlug
        ? firstText(main, ['h1'])
        : '';

    return {
      publisher,
      groupOrPage,
      publishedAtText: info.kind === 'post' ? readPostDate(article) : '',
    };
  },
};
