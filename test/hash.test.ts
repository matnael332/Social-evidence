import { describe, expect, it } from 'vitest';
import { bytesToHex, sha256Hex } from '../src/domain/hash';

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

describe('sha256Hex', () => {
  // Published test vectors (FIPS 180-4 examples).
  it('hashes the empty input', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc"', async () => {
    expect(await sha256Hex(encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes a two-block message', async () => {
    expect(
      await sha256Hex(encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('accepts an ArrayBuffer as well as a typed array', async () => {
    const bytes = encode('abc');
    expect(await sha256Hex(bytes.buffer)).toBe(await sha256Hex(bytes));
  });

  it('changes when a single bit changes', async () => {
    const original = new Uint8Array([1, 2, 3, 4]);
    const altered = new Uint8Array([1, 2, 3, 5]);
    expect(await sha256Hex(original)).not.toBe(await sha256Hex(altered));
  });
});

describe('bytesToHex', () => {
  it('writes two lowercase digits per byte', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });
});
