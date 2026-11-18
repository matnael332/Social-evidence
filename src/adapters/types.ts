import type { ExtractedField, Platform } from '../domain/types';

export type ExtractedValues = Partial<Record<ExtractedField, string>>;

/**
 * Reads what a page of one platform shows about a post.
 *
 * Adapters are best-effort: a field that is not found is simply missing, and
 * the user fills it in. They only read the rendered document. They never
 * click, scroll, expand or load anything.
 */
export interface PageAdapter {
  id: Platform;
  /** Bumped whenever selectors change; stored on every record. */
  version: string;
  extract(doc: Document, url: URL): ExtractedValues;
}

/** What the injected script hands back to the extension. Untrusted until sanitized. */
export interface RawExtraction {
  adapter: Platform;
  adapterVersion: string;
  values: ExtractedValues;
}
