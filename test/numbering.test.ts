import { describe, expect, it } from 'vitest';
import { formatSeq, imageFileName, takeSeq } from '../src/domain/numbering';

describe('formatSeq', () => {
  it('pads to four digits', () => {
    expect(formatSeq(1)).toBe('0001');
    expect(formatSeq(42)).toBe('0042');
    expect(formatSeq(9999)).toBe('9999');
  });

  it('widens past 9999 instead of wrapping', () => {
    expect(formatSeq(10000)).toBe('10000');
    expect(formatSeq(123456)).toBe('123456');
  });

  it('rejects numbers that cannot be a running number', () => {
    expect(() => formatSeq(0)).toThrow(RangeError);
    expect(() => formatSeq(-3)).toThrow(RangeError);
    expect(() => formatSeq(1.5)).toThrow(RangeError);
    expect(() => formatSeq(Number.NaN)).toThrow(RangeError);
  });
});

describe('imageFileName', () => {
  it('derives the file name from the running number', () => {
    expect(imageFileName(7)).toBe('0007.png');
    expect(imageFileName(12345)).toBe('12345.png');
  });
});

describe('takeSeq', () => {
  it('hands out consecutive numbers', () => {
    let counter = { nextSeq: 1 };
    const taken: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = takeSeq(counter);
      taken.push(result.seq);
      counter = result.counter;
    }
    expect(taken).toEqual([1, 2, 3, 4]);
    expect(counter.nextSeq).toBe(5);
  });

  it('does not change the counter it was given', () => {
    const counter = { nextSeq: 8, title: 'case' };
    const result = takeSeq(counter);
    expect(counter.nextSeq).toBe(8);
    expect(result.counter).toEqual({ nextSeq: 9, title: 'case' });
  });

  it('never reuses a number after a deletion', () => {
    // Deleting a record leaves the counter alone, so the next number is new.
    let counter = { nextSeq: 1 };
    const first = takeSeq(counter);
    counter = first.counter;
    const second = takeSeq(counter);
    counter = second.counter;
    const remaining = [first.seq, second.seq].filter((seq) => seq !== 2);
    const third = takeSeq(counter);
    expect(remaining).toEqual([1]);
    expect(third.seq).toBe(3);
  });
});
