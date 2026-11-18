/**
 * Everything an adapter returns was read from a web page, so it is treated
 * as hostile input: only known fields, only strings, no control characters,
 * bounded length.
 */
import {
  EXTRACTED_FIELDS,
  type ExtractedField,
  type ExtractedInfo,
  type Platform,
} from '../domain/types';

const MAX_LENGTH: Record<ExtractedField, number> = {
  publisher: 200,
  groupOrPage: 200,
  publishedAtText: 120,
  // Longer than a valid value on purpose: a date with a timezone must fail
  // the format check, not be cut down into a date that looks valid.
  publishedAt: 40,
};

const PLATFORMS: readonly string[] = ['facebook', 'tiktok', 'instagram', 'website'];
const NORMALIZED_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const VERSION = /^[\w.-]{1,20}$/;

/** C0 and C1 control characters, including tabs and line breaks. */
const CONTROL = /[\x00-\x1F\x7F-\x9F]/g;
/**
 * Characters that change the direction of the text around them. A page could
 * use them to make a name read differently from what is stored.
 */
const DIRECTION_OVERRIDES = /[\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;

/** One line of plain text, at most `maxLength` characters. Anything but a string becomes ''. */
export function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(CONTROL, ' ')
    .replace(DIRECTION_OVERRIDES, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, maxLength).join('').trim();
}

/** An extraction with no values, for pages where nothing was read. */
export function emptyExtraction(platform: Platform): ExtractedInfo {
  return { adapter: platform, adapterVersion: '0', values: {} };
}

/**
 * Turns whatever came back from the page into a safe `ExtractedInfo`.
 * `platform` is the one the extension detected itself; the page's claim about
 * it is ignored.
 */
export function sanitizeExtracted(raw: unknown, platform: Platform): ExtractedInfo {
  const result = emptyExtraction(platform);
  if (typeof raw !== 'object' || raw === null) return result;
  const input = raw as Record<string, unknown>;

  if (typeof input.adapter !== 'string' || !PLATFORMS.includes(input.adapter)) return result;
  if (typeof input.adapterVersion === 'string' && VERSION.test(input.adapterVersion)) {
    result.adapterVersion = input.adapterVersion;
  }

  const values = input.values;
  if (typeof values !== 'object' || values === null) return result;
  for (const field of EXTRACTED_FIELDS) {
    const text = sanitizeText((values as Record<string, unknown>)[field], MAX_LENGTH[field]);
    if (text === '') continue;
    if (field === 'publishedAt' && !NORMALIZED_DATE.test(text)) continue;
    result.values[field] = text;
  }
  return result;
}
