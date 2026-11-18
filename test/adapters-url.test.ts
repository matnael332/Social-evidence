import { describe, expect, it } from 'vitest';
import { parseFacebookUrl } from '../src/adapters/facebook';
import { parseInstagramUrl } from '../src/adapters/instagram';
import { isPostPermalink } from '../src/adapters/permalink';
import { parseTikTokUrl } from '../src/adapters/tiktok';

const fb = (path: string) => parseFacebookUrl(new URL(`https://www.facebook.com${path}`));
const tt = (path: string) => parseTikTokUrl(new URL(`https://www.tiktok.com${path}`));
const ig = (path: string) => parseInstagramUrl(new URL(`https://www.instagram.com${path}`));

describe('parseFacebookUrl', () => {
  it('recognizes a post inside a group', () => {
    expect(fb('/groups/1234567890/posts/9876543210/')).toEqual({ kind: 'post', groupId: '1234567890', postId: '9876543210' });
    expect(fb('/groups/invented.group/permalink/555/?comment_id=1')).toEqual({ kind: 'post', groupId: 'invented.group', postId: '555' });
    expect(fb('/groups/1234567890/?multi_permalinks=777')).toEqual({ kind: 'post', groupId: '1234567890', postId: '777' });
  });

  it('recognizes a group page that is not a single post', () => {
    expect(fb('/groups/1234567890')).toEqual({ kind: 'group', groupId: '1234567890' });
    expect(fb('/groups/1234567890/members/admins')).toEqual({ kind: 'group', groupId: '1234567890' });
    expect(fb('/groups/1234567890/posts/')).toEqual({ kind: 'group', groupId: '1234567890' });
  });

  it('recognizes posts of pages and profiles', () => {
    expect(fb('/invented.page/posts/pfbid0AbCdEf')).toEqual({ kind: 'post', pageSlug: 'invented.page', postId: 'pfbid0AbCdEf' });
    expect(fb('/invented.page/videos/123456')).toMatchObject({ kind: 'post', pageSlug: 'invented.page' });
    expect(fb('/permalink.php?story_fbid=111&id=222')).toEqual({ kind: 'post', postId: '111' });
    expect(fb('/story.php?story_fbid=111&id=222')).toEqual({ kind: 'post', postId: '111' });
    expect(fb('/photo/?fbid=333&set=a.1')).toEqual({ kind: 'post', postId: '333' });
    expect(fb('/photo.php?fbid=333')).toEqual({ kind: 'post', postId: '333' });
    expect(fb('/watch/?v=444')).toEqual({ kind: 'post', postId: '444' });
    expect(fb('/reel/555')).toEqual({ kind: 'post', postId: '555' });
    expect(fb('/share/p/AbCdEf/')).toEqual({ kind: 'post', postId: 'AbCdEf' });
  });

  it('recognizes a profile or page root', () => {
    expect(fb('/invented.page')).toEqual({ kind: 'profileOrPage', pageSlug: 'invented.page' });
    expect(fb('/invented.page/about')).toEqual({ kind: 'profileOrPage', pageSlug: 'invented.page' });
    expect(fb('/profile.php?id=100000000000001')).toEqual({ kind: 'profileOrPage' });
  });

  it('treats the feed and site sections as neither', () => {
    for (const path of ['/', '/watch', '/marketplace/item/1', '/events/1', '/permalink.php', '/photo', '/groups', '/groups/', '/share/x/1']) {
      expect(fb(path).kind, path).toBe('other');
    }
  });
});

describe('parseTikTokUrl', () => {
  it('recognizes a video or photo post and its author', () => {
    expect(tt('/@invented_user/video/7300000000000000001')).toEqual({ kind: 'post', handle: 'invented_user', postId: '7300000000000000001' });
    expect(tt('/@invented.user/photo/7300000000000000002?lang=he')).toMatchObject({ kind: 'post', handle: 'invented.user' });
  });

  it('recognizes a profile', () => {
    expect(tt('/@invented_user')).toEqual({ kind: 'profile', handle: 'invented_user' });
    expect(tt('/@invented_user/')).toEqual({ kind: 'profile', handle: 'invented_user' });
  });

  it('treats short share links as posts', () => {
    expect(tt('/t/ZAbCdEf/')).toEqual({ kind: 'post' });
    expect(parseTikTokUrl(new URL('https://vm.tiktok.com/ZAbCdEf/'))).toEqual({ kind: 'post' });
  });

  it('treats everything else as neither', () => {
    for (const path of ['/', '/foryou', '/explore', '/@', '/@invented_user/live', '/tag/sample']) {
      expect(tt(path).kind, path).toBe('other');
    }
  });
});

describe('parseInstagramUrl', () => {
  it('recognizes posts, reels and stories', () => {
    expect(ig('/p/CAbCdEfGhIj/')).toEqual({ kind: 'post', code: 'CAbCdEfGhIj' });
    expect(ig('/reel/CAbCdEfGhIj/?igsh=x')).toEqual({ kind: 'post', code: 'CAbCdEfGhIj' });
    expect(ig('/reels/CAbCdEfGhIj/')).toEqual({ kind: 'post', code: 'CAbCdEfGhIj' });
    expect(ig('/tv/CAbCdEfGhIj/')).toEqual({ kind: 'post', code: 'CAbCdEfGhIj' });
    expect(ig('/invented.user/p/CAbCdEfGhIj/')).toEqual({ kind: 'post', handle: 'invented.user', code: 'CAbCdEfGhIj' });
    expect(ig('/stories/invented.user/3200000000000000001/')).toEqual({ kind: 'post', handle: 'invented.user', code: '3200000000000000001' });
  });

  it('recognizes a profile', () => {
    expect(ig('/invented.user/')).toEqual({ kind: 'profile', handle: 'invented.user' });
  });

  it('treats everything else as neither', () => {
    for (const path of ['/', '/explore/', '/explore/tags/sample/', '/accounts/login/', '/direct/inbox/', '/p/', '/reels/', '/stories/invented.user/']) {
      expect(ig(path).kind, path).toBe('other');
    }
    expect(ig('/invented.user/tagged/')).toEqual({ kind: 'other', handle: 'invented.user' });
  });
});

describe('isPostPermalink', () => {
  it('answers for the three platforms', () => {
    expect(isPostPermalink('facebook', 'https://www.facebook.com/groups/1/posts/2')).toBe(true);
    expect(isPostPermalink('facebook', 'https://www.facebook.com/groups/1')).toBe(false);
    expect(isPostPermalink('tiktok', 'https://www.tiktok.com/@invented_user/video/1')).toBe(true);
    expect(isPostPermalink('tiktok', 'https://www.tiktok.com/foryou')).toBe(false);
    expect(isPostPermalink('instagram', 'https://www.instagram.com/p/CAbC/')).toBe(true);
    expect(isPostPermalink('instagram', 'https://www.instagram.com/')).toBe(false);
  });

  it('does not judge ordinary websites or malformed input', () => {
    expect(isPostPermalink('website', 'https://example.org/anything')).toBeNull();
    expect(isPostPermalink('facebook', 'not a url')).toBeNull();
  });
});
