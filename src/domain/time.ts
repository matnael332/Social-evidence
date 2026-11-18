/**
 * Timestamp formatting.
 *
 * Every function takes the UTC offset as an argument instead of reading the
 * machine's timezone, so the output is the same wherever the code runs.
 */

const pad2 = (value: number): string => String(value).padStart(2, '0');

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock fields of an instant, as seen at the given UTC offset. */
function wallClock(epochMs: number, offsetMinutes: number): WallClock {
  const shifted = new Date(epochMs + offsetMinutes * 60_000);
  if (Number.isNaN(shifted.getTime())) throw new RangeError(`Invalid time: ${epochMs}`);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** "+02:00", "-03:30", "+00:00". */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** ISO 8601 with offset, e.g. "2026-11-18T14:03:22+02:00". */
export function formatIsoWithOffset(epochMs: number, offsetMinutes: number): string {
  const t = wallClock(epochMs, offsetMinutes);
  const date = `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
  const time = `${pad2(t.hour)}:${pad2(t.minute)}:${pad2(t.second)}`;
  return `${date}T${time}${formatOffset(offsetMinutes)}`;
}

/** Text for the information strip, e.g. "2026-11-18 14:03:22 UTC+02:00 (Asia/Jerusalem)". */
export function formatStripTime(epochMs: number, offsetMinutes: number, timeZone: string): string {
  const t = wallClock(epochMs, offsetMinutes);
  const date = `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
  const time = `${pad2(t.hour)}:${pad2(t.minute)}:${pad2(t.second)}`;
  const zone = timeZone ? ` (${timeZone})` : '';
  return `${date} ${time} UTC${formatOffset(offsetMinutes)}${zone}`;
}

/** Compact stamp for file names, e.g. "2026-11-18_1403". */
export function formatFileStamp(epochMs: number, offsetMinutes: number): string {
  const t = wallClock(epochMs, offsetMinutes);
  return `${t.year}-${pad2(t.month)}-${pad2(t.day)}_${pad2(t.hour)}${pad2(t.minute)}`;
}

/** Minutes east of UTC for an instant, on the machine running the code. */
export function localOffsetMinutes(epochMs: number): number {
  return -new Date(epochMs).getTimezoneOffset();
}

/** IANA name of the machine's timezone, or an empty string if unknown. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/**
 * Joins the optional normalized publication date typed by the user.
 * A time without a date is meaningless and yields an empty string.
 */
export function joinPublishedAt(date: string, time: string): string {
  const d = date.trim();
  const t = time.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return /^\d{2}:\d{2}$/.test(t) ? `${d}T${t}` : d;
}
