import { describe, expect, it } from 'vitest';
import { buildRecord, normalizeFields, stickyFrom } from '../src/domain/record';
import { CAPTURED_AT_MS, makeFields, makePending } from './fixtures';

describe('normalizeFields', () => {
  it('trims every text field', () => {
    const fields = normalizeFields(
      makeFields({ publisher: '  Invented Person ', notes: '\n note \n', keyword: ' kw ' }),
      'https://social.example/page',
    );
    expect(fields.publisher).toBe('Invented Person');
    expect(fields.notes).toBe('note');
    expect(fields.keyword).toBe('kw');
  });

  it('falls back to the captured page when the post link is empty', () => {
    const fields = normalizeFields(makeFields({ url: '   ' }), 'https://social.example/page');
    expect(fields.url).toBe('https://social.example/page');
  });

  it('keeps line breaks inside a field', () => {
    const fields = normalizeFields(makeFields(), 'https://social.example/page');
    expect(fields.groupAdmins).toBe('Invented Admin One\nInvented Admin Two');
  });
});

describe('stickyFrom', () => {
  it('keeps only the four fields that carry over', () => {
    expect(stickyFrom(makeFields({ recordType: 'profile' }))).toEqual({
      recordType: 'profile',
      groupOrPage: 'Invented Group',
      groupAdmins: 'Invented Admin One\nInvented Admin Two',
      keyword: 'sample keyword',
    });
  });
});

describe('buildRecord', () => {
  const record = buildRecord({
    id: 'record-id',
    caseId: 'case-id',
    seq: 7,
    pending: makePending(),
    fields: makeFields({ url: 'https://social.example/p/456' }),
    image: { fileId: 'file-id', sha256: 'f'.repeat(64), bytes: 1234, width: 1280, height: 784 },
    savedAtMs: CAPTURED_AT_MS + 8000,
  });

  it('numbers the record and names its file after the number', () => {
    expect(record.seq).toBe(7);
    expect(record.image.fileName).toBe('0007.png');
    expect(record.status).toBe('active');
  });

  it('keeps the captured address apart from the post link', () => {
    expect(record.pageUrlAtCapture).toBe('https://social.example/groups/demo/posts/123');
    expect(record.url).toBe('https://social.example/p/456');
  });

  it('records the capture time with its offset and timezone', () => {
    expect(record.capturedAt).toBe('2026-11-18T14:03:22+02:00');
    expect(record.timeZone).toBe('Asia/Jerusalem');
    expect(record.createdAt).toBe('2026-11-18T14:03:30+02:00');
    expect(record.updatedAt).toBe(record.createdAt);
  });

  it('carries the image facts and the capture mode', () => {
    expect(record.image).toEqual({
      fileId: 'file-id',
      fileName: '0007.png',
      sha256: 'f'.repeat(64),
      bytes: 1234,
      width: 1280,
      height: 784,
      captureMode: 'visible',
    });
  });

  it('remembers what was read from the page before any edit', () => {
    expect(record.extracted.values.url).toBe('https://social.example/groups/demo/posts/123');
  });
});
