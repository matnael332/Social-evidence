/**
 * Entry point of the script that is injected into the captured tab.
 *
 * It runs in the extension's isolated world, only after the user asked for a
 * capture, and only reads the document. It defines one function; the
 * extension calls it and receives a plain object.
 */
import { extractFromDocument } from './index';
import type { RawExtraction } from './types';

declare global {
  var __socialEvidenceExtract: (() => RawExtraction | null) | undefined;
}

globalThis.__socialEvidenceExtract = () => extractFromDocument(document, location.href);
