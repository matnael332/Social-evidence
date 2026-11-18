import { describe, expect, it } from 'vitest';
import { dataUrlToBlob } from '../src/capture/data-url';

describe('dataUrlToBlob', () => {
  it('decodes the bytes and keeps the media type', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128]);
    const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
    const blob = dataUrlToBlob(dataUrl);
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([...bytes]);
  });

  it('rejects anything that is not a base64 data URL', () => {
    expect(() => dataUrlToBlob('https://example.org/image.png')).toThrow();
    expect(() => dataUrlToBlob('data:text/plain,hello')).toThrow();
  });
});
