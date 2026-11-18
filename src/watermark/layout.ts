/**
 * Layout of the information strip that is appended below every screenshot.
 *
 * This module only computes positions. It receives a `measure` function
 * instead of a canvas, so it can be tested without a browser.
 *
 * Rules (SPEC.md §7):
 * - Text is never truncated. A row first shrinks its font, then wraps.
 * - A row may carry a short label. The label is drawn right-aligned in its
 *   own run, so right-to-left labels never mix with left-to-right values.
 */

export type MeasureText = (text: string, fontPx: number) => number;

export interface StripRow {
  /** The value: a URL, or the "#0007 · time · PLATFORM" line. Drawn left-to-right. */
  text: string;
  /** Optional caption shown at the right edge of the row's first line. */
  label?: string;
}

export interface StripLayoutInput {
  /** Width of the screenshot in device pixels. */
  width: number;
  /** Device pixels per CSS pixel. */
  scale: number;
  rows: readonly StripRow[];
  measure: MeasureText;
}

export interface PositionedText {
  text: string;
  /** Left edge for values, right edge for labels. */
  x: number;
  /** Alphabetic baseline, relative to the top of the strip. */
  y: number;
  fontPx: number;
}

export interface StripLayout {
  width: number;
  height: number;
  lines: PositionedText[];
  labels: PositionedText[];
}

/** Sizes in CSS pixels; multiplied by `scale` at layout time. */
export const STRIP_METRICS = {
  minHeight: 64,
  padding: 10,
  fontPx: 14,
  minFontPx: 10,
  labelFontPx: 11,
  lineHeight: 1.45,
  rowGap: 4,
  labelGap: 16,
} as const;

/** Characters after which a long URL may wrap without looking broken. */
const SOFT_BREAK_AFTER = new Set(['/', '?', '&', '=', '-', '_', '.', ' ', '·', '%']);

/**
 * Splits text into lines no wider than `maxWidth`.
 * Breaks after a separator when one is near the end of the line, and inside
 * a word otherwise. Only whitespace at a line edge is dropped.
 */
export function wrapText(
  text: string,
  fontPx: number,
  maxWidth: number,
  measure: MeasureText,
): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let start = 0;

  while (start < chars.length) {
    // Longest prefix that fits; always at least one character.
    let end = start + 1;
    while (end < chars.length && measure(chars.slice(start, end + 1).join(''), fontPx) <= maxWidth) {
      end += 1;
    }

    if (end < chars.length) {
      // Prefer a separator in the last third of the line.
      const earliest = start + Math.ceil(((end - start) * 2) / 3);
      for (let cut = end; cut > earliest; cut -= 1) {
        const previous = chars[cut - 1];
        if (previous !== undefined && SOFT_BREAK_AFTER.has(previous)) {
          end = cut;
          break;
        }
      }
    }

    lines.push(chars.slice(start, end).join('').trim());
    start = end;
  }

  return lines.filter((line) => line !== '');
}

export function layoutStrip(input: StripLayoutInput): StripLayout {
  const { width, rows, measure } = input;
  const scale = Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1;
  const px = (cssPx: number): number => Math.round(cssPx * scale);

  const padding = px(STRIP_METRICS.padding);
  const baseFont = px(STRIP_METRICS.fontPx);
  const minFont = Math.min(baseFont, px(STRIP_METRICS.minFontPx));
  const labelFont = px(STRIP_METRICS.labelFontPx);
  const rowGap = px(STRIP_METRICS.rowGap);
  const labelGap = px(STRIP_METRICS.labelGap);
  const innerWidth = Math.max(1, width - 2 * padding);

  const lines: PositionedText[] = [];
  const labels: PositionedText[] = [];
  let cursorY = padding;

  rows.forEach((row, index) => {
    if (index > 0) cursorY += rowGap;

    // A label takes space on the row only if it leaves most of it to the value.
    const labelWidth = row.label ? measure(row.label, labelFont) : 0;
    const showLabel = row.label !== undefined && labelWidth + labelGap <= innerWidth / 2;
    const available = showLabel ? innerWidth - labelWidth - labelGap : innerWidth;

    // Shrink the font until the row fits on one line, down to the minimum size.
    let fontPx = baseFont;
    while (fontPx > minFont && measure(row.text, fontPx) > available) fontPx -= 1;

    const rowLines =
      measure(row.text, fontPx) <= available
        ? [row.text]
        : wrapText(row.text, fontPx, available, measure);

    const lineHeight = Math.round(fontPx * STRIP_METRICS.lineHeight);
    rowLines.forEach((text, lineIndex) => {
      const baseline = cursorY + Math.round(lineHeight * 0.75);
      lines.push({ text, x: padding, y: baseline, fontPx });
      if (lineIndex === 0 && showLabel && row.label) {
        labels.push({ text: row.label, x: width - padding, y: baseline, fontPx: labelFont });
      }
      cursorY += lineHeight;
    });
  });

  const height = Math.max(px(STRIP_METRICS.minHeight), cursorY + padding);
  return { width, height, lines, labels };
}

export interface StripContent {
  /** Running number, already formatted ("0007"). */
  seq: string;
  /** Tab URL at capture time. */
  pageUrl: string;
  /** Post link from the form. Shown only when it differs from `pageUrl`. */
  manualUrl: string;
  /** Formatted capture time with offset and timezone. */
  time: string;
  /** Platform display name. */
  platform: string;
  labels: { pageUrl: string; manualUrl: string };
}

/** Builds the rows of the strip from a capture's facts. */
export function stripRows(content: StripContent): StripRow[] {
  const rows: StripRow[] = [{ text: content.pageUrl, label: content.labels.pageUrl }];

  const manual = content.manualUrl.trim();
  if (manual !== '' && manual !== content.pageUrl.trim()) {
    rows.push({ text: manual, label: content.labels.manualUrl });
  }

  rows.push({
    text: `#${content.seq} · ${content.time} · ${content.platform.toUpperCase()}`,
  });
  return rows;
}
