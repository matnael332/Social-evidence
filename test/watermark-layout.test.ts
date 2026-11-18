import { describe, expect, it } from 'vitest';
import {
  STRIP_METRICS,
  layoutStrip,
  stripRows,
  wrapText,
  type MeasureText,
  type StripContent,
} from '../src/watermark/layout';

/** A fixed-width stand-in for canvas text measurement. */
const measure: MeasureText = (text, fontPx) => Array.from(text).length * fontPx * 0.6;

const content: StripContent = {
  seq: '0007',
  pageUrl: 'https://social.example/groups/demo/posts/123',
  manualUrl: 'https://social.example/groups/demo/posts/123',
  time: '2026-11-18 14:03:22 UTC+02:00 (Asia/Jerusalem)',
  platform: 'Facebook',
  labels: { pageUrl: 'page address', manualUrl: 'entered manually' },
};

const longUrl = `https://social.example/groups/demo/permalink/${'0123456789'.repeat(40)}/?ref=share`;

describe('stripRows', () => {
  it('shows the tab address and the facts line', () => {
    const rows = stripRows(content);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ text: content.pageUrl, label: 'page address' });
    expect(rows[1]?.text).toBe(
      '#0007 · 2026-11-18 14:03:22 UTC+02:00 (Asia/Jerusalem) · FACEBOOK',
    );
  });

  it('adds a labeled row when the post link differs from the tab address', () => {
    const rows = stripRows({ ...content, manualUrl: 'https://social.example/p/456' });
    expect(rows).toHaveLength(3);
    expect(rows[0]?.text).toBe(content.pageUrl);
    expect(rows[1]).toEqual({ text: 'https://social.example/p/456', label: 'entered manually' });
  });

  it('ignores surrounding whitespace and an empty post link', () => {
    expect(stripRows({ ...content, manualUrl: `  ${content.pageUrl} ` })).toHaveLength(2);
    expect(stripRows({ ...content, manualUrl: '   ' })).toHaveLength(2);
  });
});

describe('wrapText', () => {
  it('keeps every character of a long address', () => {
    const lines = wrapText(longUrl, 10, 600, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(longUrl);
  });

  it('never produces a line wider than the limit', () => {
    for (const line of wrapText(longUrl, 10, 600, measure)) {
      expect(measure(line, 10)).toBeLessThanOrEqual(600);
    }
  });

  it('prefers to break after a separator', () => {
    const lines = wrapText('https://social.example/groups/demo/posts/123456', 10, 210, measure);
    expect(lines.join('')).toBe('https://social.example/groups/demo/posts/123456');
    expect(lines[0]?.endsWith('/')).toBe(true);
  });

  it('still makes progress when not even one character fits', () => {
    expect(wrapText('abc', 10, 1, measure)).toEqual(['a', 'b', 'c']);
  });
});

describe('layoutStrip', () => {
  it('keeps a short capture at the minimum height', () => {
    const layout = layoutStrip({ width: 1280, scale: 1, rows: stripRows(content), measure });
    expect(layout.width).toBe(1280);
    expect(layout.height).toBe(STRIP_METRICS.minHeight);
    expect(layout.lines.map((line) => line.text)).toEqual([
      content.pageUrl,
      '#0007 · 2026-11-18 14:03:22 UTC+02:00 (Asia/Jerusalem) · FACEBOOK',
    ]);
    expect(layout.lines.every((line) => line.fontPx === STRIP_METRICS.fontPx)).toBe(true);
  });

  it('shrinks the font before it wraps', () => {
    const url = `https://social.example/${'a'.repeat(150)}`;
    const layout = layoutStrip({ width: 1280, scale: 1, rows: [{ text: url }], measure });
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0]?.text).toBe(url);
    expect(layout.lines[0]?.fontPx).toBeLessThan(STRIP_METRICS.fontPx);
    expect(layout.lines[0]?.fontPx).toBeGreaterThanOrEqual(STRIP_METRICS.minFontPx);
  });

  it('never truncates the address: it wraps and the strip grows', () => {
    const rows = stripRows({ ...content, pageUrl: longUrl, manualUrl: longUrl });
    const layout = layoutStrip({ width: 800, scale: 1, rows, measure });
    const urlLines = layout.lines.slice(0, -1);
    expect(urlLines.length).toBeGreaterThan(1);
    expect(urlLines.map((line) => line.text).join('')).toBe(longUrl);
    expect(layout.height).toBeGreaterThan(STRIP_METRICS.minHeight);
  });

  it('keeps all text inside the strip', () => {
    const rows = stripRows({ ...content, pageUrl: longUrl, manualUrl: 'https://social.example/p/1' });
    const layout = layoutStrip({ width: 640, scale: 1, rows, measure });
    for (const line of layout.lines) {
      expect(line.x).toBeGreaterThanOrEqual(0);
      expect(line.x + measure(line.text, line.fontPx)).toBeLessThanOrEqual(layout.width);
      expect(line.y).toBeGreaterThan(0);
      expect(line.y).toBeLessThan(layout.height);
    }
  });

  it('places each line below the previous one', () => {
    const rows = stripRows({ ...content, pageUrl: longUrl, manualUrl: 'https://social.example/p/1' });
    const layout = layoutStrip({ width: 640, scale: 1, rows, measure });
    const baselines = layout.lines.map((line) => line.y);
    expect(baselines).toEqual([...baselines].sort((a, b) => a - b));
    expect(new Set(baselines).size).toBe(baselines.length);
  });

  it('draws a label once per row, right-aligned, clear of the value', () => {
    const rows = stripRows({ ...content, manualUrl: 'https://social.example/p/456' });
    const layout = layoutStrip({ width: 1280, scale: 1, rows, measure });
    expect(layout.labels.map((label) => label.text)).toEqual(['page address', 'entered manually']);
    for (const label of layout.labels) {
      const line = layout.lines.find((candidate) => candidate.y === label.y);
      expect(line).toBeDefined();
      const labelLeft = label.x - measure(label.text, label.fontPx);
      expect(line!.x + measure(line!.text, line!.fontPx)).toBeLessThanOrEqual(labelLeft);
    }
  });

  it('drops the label rather than the value on a very narrow image', () => {
    const layout = layoutStrip({ width: 160, scale: 1, rows: stripRows(content), measure });
    expect(layout.labels).toHaveLength(0);
    expect(layout.lines.slice(0, -1).map((line) => line.text).join('')).toContain('social.example');
  });

  it('scales with the device pixel ratio', () => {
    const rows = stripRows(content);
    const single = layoutStrip({ width: 1280, scale: 1, rows, measure });
    const double = layoutStrip({ width: 2560, scale: 2, rows, measure });
    expect(double.lines[0]?.fontPx).toBe(single.lines[0]!.fontPx * 2);
    expect(double.lines.length).toBe(single.lines.length);
    // Line heights are rounded to whole pixels, so allow a pixel per line.
    expect(Math.abs(double.height - single.height * 2)).toBeLessThanOrEqual(double.lines.length);
  });

  it('falls back to scale 1 for a nonsensical scale', () => {
    const rows = stripRows(content);
    const reference = layoutStrip({ width: 1280, scale: 1, rows, measure });
    expect(layoutStrip({ width: 1280, scale: 0, rows, measure })).toEqual(reference);
    expect(layoutStrip({ width: 1280, scale: Number.NaN, rows, measure })).toEqual(reference);
  });
});
