/**
 * A minimal XLSX writer: one sheet, text and number cells, a bold frozen
 * header row, optional right-to-left view.
 *
 * The file is written by hand instead of through a spreadsheet library, so
 * every piece of text that goes into the XML is escaped here. Text comes from
 * web pages and is not trusted.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';

export type Cell = string | number;

export interface SheetInput {
  name: string;
  headers: readonly string[];
  rows: ReadonlyArray<readonly Cell[]>;
  rightToLeft?: boolean;
  /** Column widths in characters; columns without one get a default. */
  widths?: readonly number[];
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const DEFAULT_WIDTH = 18;
const STYLE_HEADER = 1;
const STYLE_TEXT = 2;

/** Characters XML 1.0 does not allow at all, lone surrogates included. */
const INVALID_XML = /[^\x09\x0A\x0D\x20-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu;

/** Escapes text for use as XML character data or inside an attribute. */
export function xmlText(value: string): string {
  return value
    .replace(INVALID_XML, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** "A", "B" … "Z", "AA", "AB" … for a 0-based column index. */
export function columnName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError(`Invalid column: ${index}`);
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** Sheet names may not hold a few characters and are limited to 31. */
export function sheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return cleaned === '' ? 'Sheet1' : cleaned;
}

function cellXml(value: Cell, ref: string, style: number): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Cell ${ref} is not a finite number`);
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  // An inline string is always text: a spreadsheet never evaluates it as a formula.
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function rowXml(cells: readonly Cell[], rowNumber: number, style: number): string {
  const xml = cells.map((cell, column) => cellXml(cell, `${columnName(column)}${rowNumber}`, style));
  return `<row r="${rowNumber}">${xml.join('')}</row>`;
}

export function sheetXml(sheet: SheetInput): string {
  const width = sheet.headers.length;
  sheet.rows.forEach((row, index) => {
    if (row.length !== width) {
      throw new RangeError(`Sheet row ${index} has ${row.length} cells, expected ${width}`);
    }
  });

  const cols = sheet.headers
    .map((_, column) => {
      const size = sheet.widths?.[column] ?? DEFAULT_WIDTH;
      return `<col min="${column + 1}" max="${column + 1}" width="${size}" customWidth="1"/>`;
    })
    .join('');
  const rows = [
    rowXml(sheet.headers, 1, STYLE_HEADER),
    ...sheet.rows.map((row, index) => rowXml(row, index + 2, STYLE_TEXT)),
  ].join('');
  const direction = sheet.rightToLeft ? ' rightToLeft="1"' : '';

  return (
    `${XML_HEADER}<worksheet xmlns="${NS_MAIN}">` +
    `<sheetViews><sheetView${direction} workbookViewId="0">` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    '</worksheet>'
  );
}

const STYLES_XML =
  `${XML_HEADER}<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font>' +
  '<font><b/><sz val="11"/><name val="Arial"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
  '<alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs></styleSheet>';

/** Builds the complete .xlsx file. */
export function buildXlsx(sheet: SheetInput): Uint8Array {
  const contentTypes =
    `${XML_HEADER}<Types xmlns="${NS_CONTENT_TYPES}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  const rootRels =
    `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE_REL}">` +
    `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>';
  const workbook =
    `${XML_HEADER}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<sheets><sheet name="${xmlText(sheetName(sheet.name))}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>';
  const workbookRels =
    `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE_REL}">` +
    `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const files: Zippable = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(STYLES_XML),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(sheet)),
  };
  return zipSync(files, { level: 6 });
}
