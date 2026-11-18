import { layoutStrip, type MeasureText, type StripRow } from './layout';

/** Must match the family declared by the bundled font's stylesheet. */
export const STRIP_FONT_FAMILY = '"Noto Sans Hebrew Variable", "Noto Sans Hebrew", sans-serif';

const COLORS = {
  background: '#111827',
  rule: '#2563eb',
  text: '#f9fafb',
  label: '#9ca3af',
} as const;

const fontOf = (fontPx: number): string => `500 ${fontPx}px ${STRIP_FONT_FAMILY}`;

/**
 * Loads the bundled font before anything is drawn. Canvas text does not wait
 * for web fonts, so drawing too early would silently use a system font.
 */
export async function ensureStripFont(): Promise<void> {
  const font = fontOf(14);
  // One sample per subset file: Latin for URLs and digits, Hebrew for labels.
  await Promise.all([document.fonts.load(font, 'Aa0/:#'), document.fonts.load(font, 'אבג')]);
}

export interface ComposedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Device pixels per CSS pixel of a screenshot, from the size of the tab it
 * was taken in. Falls back to 1 when the tab size is unknown.
 *
 * Width and height normally give the same ratio. If the page was resized
 * between measuring the tab and taking the screenshot, one of them is too
 * small, so the larger one is used.
 */
export function screenshotScale(image: Size, tab: Size): number {
  const ratios = [image.width / tab.width, image.height / tab.height].filter(
    (ratio) => Number.isFinite(ratio) && ratio > 0,
  );
  if (ratios.length === 0) return 1;
  return Math.min(5, Math.max(0.5, Math.max(...ratios)));
}

/**
 * Returns a new PNG: the screenshot, unchanged, with the information strip
 * appended below it. No pixel of the screenshot is covered.
 *
 * `tab` is the size of the captured tab in CSS pixels; it sizes the strip so
 * its text is equally legible on standard and high-density screens.
 */
export async function composeEvidenceImage(
  screenshot: Blob,
  rows: readonly StripRow[],
  tab: Size,
): Promise<ComposedImage> {
  await ensureStripFont();
  const bitmap = await createImageBitmap(screenshot);

  try {
    const scale = screenshotScale(bitmap, tab);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');

    const measure: MeasureText = (text, fontPx) => {
      ctx.font = fontOf(fontPx);
      return ctx.measureText(text).width;
    };
    const strip = layoutStrip({ width: bitmap.width, scale, rows, measure });

    // Resizing the canvas resets its state, so all drawing happens after this.
    canvas.width = bitmap.width;
    canvas.height = bitmap.height + strip.height;

    ctx.drawImage(bitmap, 0, 0);

    ctx.save();
    ctx.translate(0, bitmap.height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, strip.width, strip.height);
    ctx.fillStyle = COLORS.rule;
    ctx.fillRect(0, 0, strip.width, Math.max(1, Math.round(2 * scale)));
    ctx.textBaseline = 'alphabetic';

    // Values: URLs, numbers and dates, always left-to-right.
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.text;
    for (const line of strip.lines) {
      ctx.font = fontOf(line.fontPx);
      ctx.fillText(line.text, line.x, line.y);
    }

    // Labels: their own right-aligned runs, so Hebrew never reorders a value.
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.label;
    for (const label of strip.labels) {
      ctx.font = fontOf(label.fontPx);
      ctx.fillText(label.text, label.x, label.y);
    }
    ctx.restore();

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))),
        'image/png',
      );
    });
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}
