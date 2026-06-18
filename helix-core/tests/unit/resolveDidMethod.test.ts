import { describe, expect, it } from 'vitest';
import { resolveDidMethod } from '../../src/config/index.js';

describe('resolveDidMethod', () => {
  it('prefers DID_METHOD over HELIX_DID_METHOD', () => {
    expect(resolveDidMethod({ DID_METHOD: 'web', HELIX_DID_METHOD: 'hedera' })).toBe('web');
  });

  it('defaults to web when unset', () => {
    expect(resolveDidMethod({})).toBe('web');
  });

  it('rejects invalid values', () => {
    expect(() => resolveDidMethod({ DID_METHOD: 'solana' })).toThrow(/Invalid DID method/);
  });
});
