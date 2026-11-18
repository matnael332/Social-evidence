import { describe, expect, it } from 'vitest';
import { detectPlatform, platformName } from '../src/platform/detect';

describe('detectPlatform', () => {
  it.each([
    ['https://www.facebook.com/groups/123456/posts/789', 'facebook'],
    ['https://facebook.com/some.page', 'facebook'],
    ['https://m.facebook.com/story.php?story_fbid=1&id=2', 'facebook'],
    ['https://fb.com/some.page', 'facebook'],
    ['https://www.tiktok.com/@someone/video/123', 'tiktok'],
    ['https://vm.tiktok.com/abc/', 'tiktok'],
    ['https://www.instagram.com/p/abc123/', 'instagram'],
    ['https://example.org/article?id=5#top', 'website'],
    ['http://localhost:5173/demo', 'website'],
  ] as const)('%s → %s', (url, platform) => {
    expect(detectPlatform(url)).toBe(platform);
  });

  it('ignores case, ports and a trailing dot in the host name', () => {
    expect(detectPlatform('HTTPS://WWW.FACEBOOK.COM/Groups/1')).toBe('facebook');
    expect(detectPlatform('https://www.instagram.com:443/p/x/')).toBe('instagram');
    expect(detectPlatform('https://www.tiktok.com./@someone')).toBe('tiktok');
  });

  it('treats lookalike hosts as plain websites', () => {
    expect(detectPlatform('https://facebook.com.evil.example/login')).toBe('website');
    expect(detectPlatform('https://notfacebook.com/')).toBe('website');
    expect(detectPlatform('https://my-instagram.com/')).toBe('website');
    expect(detectPlatform('https://tiktok.com.example.net/')).toBe('website');
  });

  it('does not match a platform name outside the host', () => {
    expect(detectPlatform('https://example.org/?next=https://www.facebook.com/')).toBe('website');
    expect(detectPlatform('https://example.org/facebook.com/page')).toBe('website');
    expect(detectPlatform('https://facebook.com@example.org/')).toBe('website');
  });

  it('refuses pages that are not http(s)', () => {
    expect(detectPlatform('chrome://extensions')).toBeNull();
    expect(detectPlatform('chrome-extension://abcdef/options/index.html')).toBeNull();
    expect(detectPlatform('file:///home/user/page.html')).toBeNull();
    expect(detectPlatform('about:blank')).toBeNull();
    expect(detectPlatform('javascript:alert(1)')).toBeNull();
  });

  it('refuses malformed input', () => {
    expect(detectPlatform('')).toBeNull();
    expect(detectPlatform('not a url')).toBeNull();
    expect(detectPlatform('www.facebook.com')).toBeNull();
  });
});

describe('platformName', () => {
  it('returns the display name', () => {
    expect(platformName('facebook')).toBe('Facebook');
    expect(platformName('tiktok')).toBe('TikTok');
    expect(platformName('instagram')).toBe('Instagram');
    expect(platformName('website')).toBe('Website');
  });
});
