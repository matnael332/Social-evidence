/**
 * Decodes a base64 `data:` URL into a Blob.
 * `captureVisibleTab` returns the screenshot in this form.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Not a base64 data URL');
  const [, mimeType = 'application/octet-stream', payload = ''] = match;

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
