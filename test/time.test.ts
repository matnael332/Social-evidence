import { describe, expect, it } from 'vitest';
import {
  formatFileStamp,
  formatIsoWithOffset,
  formatOffset,
  formatStripTime,
  joinPublishedAt,
} from '../src/domain/time';

const UTC_NOON = Date.UTC(2026, 10, 18, 12, 3, 22); // 2026-11-18T12:03:22Z

describe('formatOffset', () => {
  it('formats whole and partial hours on both sides of UTC', () => {
    expect(formatOffset(0)).toBe('+00:00');
    expect(formatOffset(120)).toBe('+02:00');
    expect(formatOffset(-300)).toBe('-05:00');
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(-210)).toBe('-03:30');
  });
});

describe('formatIsoWithOffset', () => {
  it('shows the wall-clock time at the given offset', () => {
    expect(formatIsoWithOffset(UTC_NOON, 120)).toBe('2026-11-18T14:03:22+02:00');
    expect(formatIsoWithOffset(UTC_NOON, 0)).toBe('2026-11-18T12:03:22+00:00');
    expect(formatIsoWithOffset(UTC_NOON, -480)).toBe('2026-11-18T04:03:22-08:00');
  });

  it('describes the same instant whatever the offset', () => {
    for (const offset of [-720, -210, 0, 120, 180, 345, 840]) {
      expect(new Date(formatIsoWithOffset(UTC_NOON, offset)).getTime()).toBe(UTC_NOON);
    }
  });

  it('rolls over the date near midnight', () => {
    const lateEvening = Date.UTC(2026, 11, 31, 23, 30, 0);
    expect(formatIsoWithOffset(lateEvening, 120)).toBe('2027-01-01T01:30:00+02:00');
    expect(formatIsoWithOffset(Date.UTC(2026, 2, 1, 0, 15, 0), -60)).toBe(
      '2026-02-28T23:15:00-01:00',
    );
  });

  it('keeps the two sides of a daylight-saving change apart', () => {
    // Israel moved from +03:00 to +02:00 on 2026-10-25 at 02:00 local time.
    const beforeChange = Date.UTC(2026, 9, 24, 22, 30, 0);
    const afterChange = Date.UTC(2026, 9, 24, 23, 30, 0);
    expect(formatIsoWithOffset(beforeChange, 180)).toBe('2026-10-25T01:30:00+03:00');
    expect(formatIsoWithOffset(afterChange, 120)).toBe('2026-10-25T01:30:00+02:00');
  });

  it('rejects an invalid time', () => {
    expect(() => formatIsoWithOffset(Number.NaN, 0)).toThrow(RangeError);
  });
});

describe('formatStripTime', () => {
  it('includes the offset and the timezone name', () => {
    expect(formatStripTime(UTC_NOON, 120, 'Asia/Jerusalem')).toBe(
      '2026-11-18 14:03:22 UTC+02:00 (Asia/Jerusalem)',
    );
  });

  it('omits the brackets when the timezone name is unknown', () => {
    expect(formatStripTime(UTC_NOON, 0, '')).toBe('2026-11-18 12:03:22 UTC+00:00');
  });
});

describe('formatFileStamp', () => {
  it('is safe for file names', () => {
    expect(formatFileStamp(UTC_NOON, 120)).toBe('2026-11-18_1403');
  });
});

describe('joinPublishedAt', () => {
  it('accepts a date alone or a date with a time', () => {
    expect(joinPublishedAt('2026-11-17', '')).toBe('2026-11-17');
    expect(joinPublishedAt('2026-11-17', '14:20')).toBe('2026-11-17T14:20');
  });

  it('yields nothing without a valid date', () => {
    expect(joinPublishedAt('', '')).toBe('');
    expect(joinPublishedAt('', '14:20')).toBe('');
    expect(joinPublishedAt('17/11/2026', '14:20')).toBe('');
  });

  it('ignores a malformed time', () => {
    expect(joinPublishedAt('2026-11-17', '2pm')).toBe('2026-11-17');
  });
});
