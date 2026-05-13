import { describe, expect, it } from 'vitest';
import { 
  toCanonicalJson, 
  hashCanonicalPayload, 
  signBytes, 
  verifySignature,
  base58btcEncode,
  base58btcDecode
} from '../../src/crypto/vp.js';

describe('Crypto Utilities', () => {
  describe('toCanonicalJson', () => {
    it('sorts keys in an object', () => {
      const obj = { b: 2, a: 1 };
      expect(toCanonicalJson(obj)).toBe('{"a":1,"b":2}');
    });

    it('handles nested objects', () => {
      const obj = { b: { d: 4, c: 3 }, a: 1 };
      expect(toCanonicalJson(obj)).toBe('{"a":1,"b":{"c":3,"d":4}}');
    });

    it('handles arrays', () => {
      const obj = { b: [2, 1], a: 1 };
      expect(toCanonicalJson(obj)).toBe('{"a":1,"b":[2,1]}');
    });
  });

  describe('Ed25519 flows', () => {
    it('signs and verifies correctly', async () => {
      const privateKeyHex = '00'.repeat(32);
      const publicKeyHex = '3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29'; // known public key for all-zeros private key
      const payload = { test: 'data' };
      const hash = hashCanonicalPayload(payload);
      
      const signature = await signBytes(hash, privateKeyHex);
      const isValid = await verifySignature(hash, signature, publicKeyHex);
      
      expect(isValid).toBe(true);
    });
  });

  describe('base58btc', () => {
    it('encodes and decodes correctly', () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const encoded = base58btcEncode(bytes);
      const decoded = base58btcDecode(encoded);
      expect(decoded).toEqual(bytes);
    });

    it('handles leading zeroes', () => {
      const bytes = new Uint8Array([0, 0, 72, 101, 108, 108, 111]);
      const encoded = base58btcEncode(bytes);
      expect(encoded.startsWith('11')).toBe(true);
      const decoded = base58btcDecode(encoded);
      expect(decoded).toEqual(bytes);
    });

    it('throws error for invalid base58 character', () => {
      expect(() => base58btcDecode('0')).toThrow('Invalid base58 string');
    });
  });
});
