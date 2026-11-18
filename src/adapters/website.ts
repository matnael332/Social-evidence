/** Adapter for ordinary websites: standard metadata that many sites publish. */
import { clean, firstText, firstTimeElement, metaContent, normalizeDateTime } from './dom';
import type { ExtractedValues, PageAdapter } from './types';

/** JSON-LD blocks larger than this are skipped rather than parsed. */
const MAX_JSON_LD_LENGTH = 200_000;

interface ArticleFacts {
  author: string;
  datePublished: string;
}

function nameOf(value: unknown): string {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return nameOf(value[0]);
  if (typeof value === 'object' && value !== null) {
    return nameOf((value as Record<string, unknown>).name);
  }
  return '';
}

/** Walks a parsed JSON-LD value and returns the first author and publication date it finds. */
function findArticleFacts(node: unknown, facts: ArticleFacts, depth = 0): void {
  if (depth > 6 || typeof node !== 'object' || node === null) return;
  if (Array.isArray(node)) {
    for (const item of node) findArticleFacts(item, facts, depth + 1);
    return;
  }
  const object = node as Record<string, unknown>;
  if (facts.author === '') facts.author = nameOf(object.author);
  if (facts.datePublished === '' && typeof object.datePublished === 'string') {
    facts.datePublished = clean(object.datePublished);
  }
  findArticleFacts(object['@graph'], facts, depth + 1);
}

export function readJsonLd(doc: Document): ArticleFacts {
  const facts: ArticleFacts = { author: '', datePublished: '' };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const text = script.textContent ?? '';
    if (text.length === 0 || text.length > MAX_JSON_LD_LENGTH) continue;
    try {
      findArticleFacts(JSON.parse(text), facts);
    } catch {
      // Malformed JSON-LD is common; the other sources still apply.
    }
    if (facts.author !== '' && facts.datePublished !== '') break;
  }
  return facts;
}

const looksLikeUrl = (text: string): boolean => /^https?:\/\//i.test(text);

export const websiteAdapter: PageAdapter = {
  id: 'website',
  version: '1',

  extract(doc: Document): ExtractedValues {
    const jsonLd = readJsonLd(doc);
    const time = firstTimeElement(doc);

    const metaAuthor = metaContent(doc, ['meta[name="author"]', 'meta[property="article:author"]']);
    const publisher =
      (looksLikeUrl(metaAuthor) ? '' : metaAuthor) ||
      jsonLd.author ||
      firstText(doc, ['[rel="author"]', '[itemprop="author"]']);

    const metaDate = metaContent(doc, [
      'meta[property="article:published_time"]',
      'meta[itemprop="datePublished"]',
      'meta[name="date"]',
    ]);
    const machineDate = time.normalized || normalizeDateTime(metaDate) || normalizeDateTime(jsonLd.datePublished);

    return {
      publisher,
      groupOrPage: metaContent(doc, ['meta[property="og:site_name"]', 'meta[name="application-name"]']),
      publishedAtText: time.text || metaDate || jsonLd.datePublished,
      publishedAt: machineDate,
    };
  },
};
