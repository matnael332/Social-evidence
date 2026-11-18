import type { Platform } from '../domain/types';
import { parseFacebookUrl } from './facebook';
import { parseInstagramUrl } from './instagram';
import { parseTikTokUrl } from './tiktok';

/**
 * Does this address belong to one post on its own page?
 *
 * `null` means the question cannot be answered from the address alone, which
 * is the case for ordinary websites.
 */
export function isPostPermalink(platform: Platform, rawUrl: string): boolean | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  switch (platform) {
    case 'facebook':
      return parseFacebookUrl(url).kind === 'post';
    case 'tiktok':
      return parseTikTokUrl(url).kind === 'post';
    case 'instagram':
      return parseInstagramUrl(url).kind === 'post';
    case 'website':
      return null;
  }
}
