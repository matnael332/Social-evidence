/**
 * Adapter tests on hand-written pages. Every name, group and handle here is
 * invented, and the markup only imitates the features the adapters look for.
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { normalizeDateTime } from '../src/adapters/dom';
import { extractFromDocument } from '../src/adapters/index';

function page(url: string, html: string): Document {
  return new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url }).window.document;
}

function pageWithHead(url: string, head: string, body = ''): Document {
  return new JSDOM(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, { url }).window.document;
}

const read = (doc: Document) => extractFromDocument(doc, doc.location.href);

describe('normalizeDateTime', () => {
  const plusTwo = () => 120;

  it('keeps a date and a local date-time as they are', () => {
    expect(normalizeDateTime('2026-11-17')).toBe('2026-11-17');
    expect(normalizeDateTime('2026-11-17T14:20')).toBe('2026-11-17T14:20');
    expect(normalizeDateTime('2026-11-17 14:20:45')).toBe('2026-11-17T14:20');
  });

  it('shows a time with a zone as the reader sees it', () => {
    expect(normalizeDateTime('2026-11-17T12:20:00Z', plusTwo)).toBe('2026-11-17T14:20');
    expect(normalizeDateTime('2026-11-17T23:30:00.000+00:00', plusTwo)).toBe('2026-11-18T01:30');
    expect(normalizeDateTime('2026-11-17T07:20:00-0500', plusTwo)).toBe('2026-11-17T14:20');
  });

  it('gives nothing for text it does not recognize', () => {
    for (const value of ['', 'yesterday', '17/11/2026', '2026-13-45T99:99:00Z', 'November 17, 2026']) {
      expect(normalizeDateTime(value, plusTwo), value).toBe('');
    }
  });
});

describe('website adapter', () => {
  it('reads standard metadata', () => {
    const doc = pageWithHead(
      'https://news.example/articles/42',
      `<meta name="author" content="Invented Reporter">
       <meta property="og:site_name" content="Invented News">
       <meta property="article:published_time" content="2026-11-17T12:20:00">`,
      '<article><h1>Headline</h1><time datetime="2026-11-17T14:20">17 November 2026, 14:20</time></article>',
    );
    expect(read(doc)).toEqual({
      adapter: 'website',
      adapterVersion: '1',
      values: {
        publisher: 'Invented Reporter',
        groupOrPage: 'Invented News',
        publishedAtText: '17 November 2026, 14:20',
        publishedAt: '2026-11-17T14:20',
      },
    });
  });

  it('falls back to JSON-LD', () => {
    const doc = pageWithHead(
      'https://blog.example/post',
      `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},
        {"@type":"Article","author":[{"@type":"Person","name":"Invented Blogger"}],"datePublished":"2026-11-16"}]}</script>`,
    );
    expect(read(doc)?.values).toMatchObject({
      publisher: 'Invented Blogger',
      publishedAtText: '2026-11-16',
      publishedAt: '2026-11-16',
    });
  });

  it('does not take an author link for a name', () => {
    const doc = pageWithHead(
      'https://news.example/a',
      '<meta property="article:author" content="https://social.example/invented.reporter">',
      '<a rel="author" href="/people/1">Invented Reporter</a>',
    );
    expect(read(doc)?.values.publisher).toBe('Invented Reporter');
  });

  it('survives broken JSON-LD and an empty page', () => {
    const broken = pageWithHead('https://blog.example/x', '<script type="application/ld+json">{ not json</script>');
    expect(read(broken)?.values).toEqual({ publisher: '', groupOrPage: '', publishedAtText: '', publishedAt: '' });
    expect(read(page('https://blog.example/y', ''))?.adapter).toBe('website');
  });
});

describe('facebook adapter', () => {
  const groupPost = `
    <div role="banner"><a href="/groups/1234567890/">Invented Neighbours Group</a></div>
    <div role="main">
      <div role="article">
        <h2><span><a role="link" href="/groups/1234567890/user/1/">Invented Author</a></span></h2>
        <a role="link" aria-label="17 November 2026 at 14:20" href="/groups/1234567890/posts/9876543210/">1d</a>
        <div>An invented post body.</div>
      </div>
      <div role="article"><h2><a role="link" href="/x">Invented Commenter</a></h2></div>
    </div>`;

  it('reads the author, the group and the date of a group post', () => {
    const doc = page('https://www.facebook.com/groups/1234567890/posts/9876543210/', groupPost);
    expect(read(doc)).toEqual({
      adapter: 'facebook',
      adapterVersion: '1',
      values: {
        publisher: 'Invented Author',
        groupOrPage: 'Invented Neighbours Group',
        publishedAtText: '17 November 2026 at 14:20',
      },
    });
  });

  it('does not report a post date on a group feed', () => {
    const doc = page('https://www.facebook.com/groups/1234567890', groupPost);
    expect(read(doc)?.values.publishedAtText).toBe('');
    expect(read(doc)?.values.groupOrPage).toBe('Invented Neighbours Group');
  });

  it('takes the visible date when there is no label', () => {
    const doc = page(
      'https://www.facebook.com/invented.page/posts/pfbid0AbC',
      `<div role="main"><h1>Invented Page</h1><div role="article">
         <h3><strong>Invented Page</strong></h3>
         <a href="/invented.page/posts/pfbid0AbC">3 h</a></div></div>`,
    );
    expect(read(doc)?.values).toEqual({
      publisher: 'Invented Page',
      groupOrPage: 'Invented Page',
      publishedAtText: '3 h',
    });
  });

  it('returns empty values on a page it cannot read', () => {
    const doc = page('https://www.facebook.com/groups/1234567890/posts/1', '<div>Log in to continue</div>');
    expect(read(doc)?.values).toEqual({ publisher: '', groupOrPage: '', publishedAtText: '' });
  });
});

describe('tiktok adapter', () => {
  it('reads the author from the address and the name and date from the page', () => {
    const doc = page(
      'https://www.tiktok.com/@invented_user/video/7300000000000000001',
      `<span data-e2e="browse-username">invented_user</span>
       <span data-e2e="browser-nickname"><span>Invented Name</span><span> · </span><span>11-17</span></span>`,
    );
    expect(read(doc)?.values).toEqual({ publisher: 'Invented Name (@invented_user)', publishedAtText: '11-17' });
  });

  it('still gives the handle when the page tells nothing', () => {
    const doc = page('https://www.tiktok.com/@invented_user', '<div></div>');
    expect(read(doc)?.values).toEqual({ publisher: '@invented_user', publishedAtText: '' });
  });
});

describe('instagram adapter', () => {
  it('reads the date of a post from its time element', () => {
    const doc = page(
      'https://www.instagram.com/p/CAbCdEfGhIj/',
      `<article><header><a role="link" href="/invented.user/">invented.user</a></header>
       <time datetime="2026-11-17T12:20:00.000Z" title="Nov 17, 2026">1d</time></article>`,
    );
    const values = read(doc)?.values;
    expect(values?.publisher).toBe('@invented.user');
    expect(values?.publishedAtText).toBe('1d');
    expect(values?.publishedAt).toMatch(/^2026-11-1[78]T\d{2}:20$/);
  });

  it('prefers the handle in the address', () => {
    const doc = page('https://www.instagram.com/invented.user/p/CAbCdEfGhIj/', '<header><a role="link">someone.else</a></header>');
    expect(read(doc)?.values.publisher).toBe('@invented.user');
  });

  it('finds the handle in a profile title', () => {
    const doc = pageWithHead(
      'https://www.instagram.com/explore/',
      '<meta property="og:title" content="Invented Name (@invented.user) • Instagram photos and videos">',
    );
    expect(read(doc)?.values.publisher).toBe('@invented.user');
  });
});

describe('extractFromDocument', () => {
  it('returns nothing for a page that is not http(s)', () => {
    expect(extractFromDocument(page('https://example.org/', ''), 'chrome://settings')).toBeNull();
  });

  it('never throws, whatever the page looks like', () => {
    const hostile = { querySelector: () => { throw new Error('boom'); }, querySelectorAll: () => { throw new Error('boom'); } };
    expect(extractFromDocument(hostile as unknown as Document, 'https://www.facebook.com/groups/1/posts/2')).toEqual({
      adapter: 'facebook',
      adapterVersion: '1',
      values: {},
    });
  });
});
