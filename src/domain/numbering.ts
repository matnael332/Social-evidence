/** Running numbers and the file names derived from them. See SPEC.md §6.4. */

const MIN_DIGITS = 4;

function assertValidSeq(seq: number): void {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(`Invalid running number: ${seq}`);
  }
}

/** Zero-padded running number: four digits minimum, wider only past 9999. */
export function formatSeq(seq: number): string {
  assertValidSeq(seq);
  return String(seq).padStart(MIN_DIGITS, '0');
}

/** File name of a record's image inside an export, e.g. "0007.png". */
export function imageFileName(seq: number): string {
  return `${formatSeq(seq)}.png`;
}

export interface SeqCounter {
  /** Next running number to hand out. */
  nextSeq: number;
}

/**
 * Takes the next running number from a counter.
 *
 * The counter only ever moves forward. Deleting a record does not touch it,
 * so a number is never handed out twice.
 */
export function takeSeq<T extends SeqCounter>(counter: T): { seq: number; counter: T } {
  assertValidSeq(counter.nextSeq);
  return { seq: counter.nextSeq, counter: { ...counter, nextSeq: counter.nextSeq + 1 } };
}
