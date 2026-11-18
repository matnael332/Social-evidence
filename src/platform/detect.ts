import type { Platform } from '../domain/types';

const PLATFORM_HOSTS: ReadonlyArray<readonly [host: string, platform: Platform]> = [
  ['facebook.com', 'facebook'],
  ['fb.com', 'facebook'],
  ['tiktok.com', 'tiktok'],
  ['instagram.com', 'instagram'],
];

/** True when `hostname` is `domain` itself or a subdomain of it. */
function isSameOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Classifies a page by its address.
 *
 * Returns `null` for anything that is not an http(s) page (browser pages,
 * local files, malformed input): those cannot be captured.
 *
 * Matching is done on the parsed hostname with a dot boundary, so lookalikes
 * such as `facebook.com.evil.example` or `notfacebook.com` are plain websites.
 */
export function detectPlatform(rawUrl: string): Platform | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  // URL() lowercases the hostname; a fully qualified name may end with a dot.
  const hostname = url.hostname.replace(/\.$/, '');
  if (hostname === '') return null;

  for (const [host, platform] of PLATFORM_HOSTS) {
    if (isSameOrSubdomain(hostname, host)) return platform;
  }
  return 'website';
}

const PLATFORM_NAMES: Record<Platform, string> = {
  facebook: 'Facebook',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  website: 'Website',
};

/** Display name used on the information strip and in exports. */
export function platformName(platform: Platform): string {
  return PLATFORM_NAMES[platform];
}
