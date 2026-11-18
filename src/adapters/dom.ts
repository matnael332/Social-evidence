/** Small helpers shared by the page adapters. */
import { formatIsoWithOffset, localOffsetMinutes } from '../domain/time';

/** Collapses runs of whitespace and trims. */
export function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Content of the first matching <meta> element that has one. */
export function metaContent(doc: Document, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const content = clean(doc.querySelector(selector)?.getAttribute('content'));
    if (content !== '') return content;
  }
  return '';
}

/** Text of the first matching element that has any. */
export function firstText(root: ParentNode, selectors: readonly string[]): string {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      const text = clean(element.textContent);
      if (text !== '') return text;
    }
  }
  return '';
}

/** Path segments of a URL, decoded, without empty parts. */
export function pathSegments(url: URL): string[] {
  return url.pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/;
const ZONED_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Turns a machine-readable date from a page (a `datetime` attribute, a meta
 * tag, JSON-LD) into the form's normalized value: "YYYY-MM-DD" or
 * "YYYY-MM-DDTHH:mm".
 *
 * A value with a timezone is converted to the wall-clock time of the machine
 * that views the page, because that is the time the page shows its reader.
 * Anything unrecognized yields an empty string.
 */
export function normalizeDateTime(
  value: string,
  offsetAt: (epochMs: number) => number = localOffsetMinutes,
): string {
  const text = value.trim();
  if (DATE_ONLY.test(text)) return text;

  const local = LOCAL_DATE_TIME.exec(text);
  if (local) return `${local[1]}T${local[2]}`;

  if (ZONED_DATE_TIME.test(text)) {
    const epochMs = Date.parse(text.replace(' ', 'T'));
    if (Number.isNaN(epochMs)) return '';
    return formatIsoWithOffset(epochMs, offsetAt(epochMs)).slice(0, 16);
  }
  return '';
}

/** Shown text and machine-readable value of the first <time datetime> element. */
export function firstTimeElement(root: ParentNode): { text: string; normalized: string } {
  for (const element of root.querySelectorAll('time[datetime]')) {
    const normalized = normalizeDateTime(element.getAttribute('datetime') ?? '');
    const text = clean(element.textContent) || clean(element.getAttribute('title'));
    if (normalized !== '' || text !== '') return { text, normalized };
  }
  return { text: '', normalized: '' };
}
