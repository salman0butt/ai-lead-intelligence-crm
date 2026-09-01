import { describe, expect, it } from 'vitest';
import { createSessionToken, hashSessionToken } from '../src/auth/session-token.js';

describe('session tokens', () => {
  it('stores a deterministic hash instead of the bearer token', () => {
    const token = createSessionToken();
    expect(token).toHaveLength(64);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });
});
