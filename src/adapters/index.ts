import type { Platform } from '../domain/types';
import { detectPlatform } from '../platform/detect';
import { facebookAdapter } from './facebook';
import { instagramAdapter } from './instagram';
import { tiktokAdapter } from './tiktok';
import type { PageAdapter, RawExtraction } from './types';
import { websiteAdapter } from './website';

const ADAPTERS: Record<Platform, PageAdapter> = {
  facebook: facebookAdapter,
  tiktok: tiktokAdapter,
  instagram: instagramAdapter,
  website: websiteAdapter,
};

/**
 * Runs the adapter that matches the page's address. Never throws: a page the
 * adapter cannot read simply yields no values.
 */
export function extractFromDocument(doc: Document, href: string): RawExtraction | null {
  const platform = detectPlatform(href);
  if (!platform) return null;
  const adapter = ADAPTERS[platform];
  try {
    return {
      adapter: adapter.id,
      adapterVersion: adapter.version,
      values: adapter.extract(doc, new URL(href)),
    };
  } catch {
    return { adapter: adapter.id, adapterVersion: adapter.version, values: {} };
  }
}
