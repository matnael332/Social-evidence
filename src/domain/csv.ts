/**
 * CSV writer for the evidence table.
 *
 * - UTF-8 with a byte order mark, so Excel opens Hebrew correctly.
 * - RFC 4180 quoting, CRLF line endings.
 * - Formula-injection guard: text copied from a web page must never be
 *   evaluated by a spreadsheet.
 */

export const UTF8_BOM = '\uFEFF';

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Prefixes an apostrophe when a spreadsheet would treat the cell as a formula. */
export function guardFormula(value: string): string {
  const first = value.charAt(0);
  return FORMULA_TRIGGERS.has(first) ? `'${value}` : value;
}

/** Quotes a cell when it contains a comma, a quote or a line break. */
export function escapeCsvCell(value: string): string {
  const guarded = guardFormula(value);
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** Builds the full CSV text, BOM included. Every row must match the header width. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const lines = [headers, ...rows].map((row, index) => {
    if (row.length !== headers.length) {
      throw new RangeError(
        `CSV row ${index} has ${row.length} cells, expected ${headers.length}`,
      );
    }
    return row.map(escapeCsvCell).join(',');
  });
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
