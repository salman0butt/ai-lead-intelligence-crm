import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '../src/env.js';

const requiredEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  NODE_ENV: 'test' as const,
};

describe('loadServerEnv', () => {
  it('accepts required environment and leaves optional provider secrets undefined', () => {
    const env = loadServerEnv(requiredEnv);

    expect(env.NODE_ENV).toBe('test');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GOOGLE_PLACES_API_KEY).toBeUndefined();
  });

  it('normalizes a blank Google Places key to undefined', () => {
    const env = loadServerEnv({ ...requiredEnv, GOOGLE_PLACES_API_KEY: '' });

    expect(env.GOOGLE_PLACES_API_KEY).toBeUndefined();
  });

  it('accepts a configured Google Places key without exposing it to browser config', () => {
    const env = loadServerEnv({ ...requiredEnv, GOOGLE_PLACES_API_KEY: 'server-only-key' });

    expect(env.GOOGLE_PLACES_API_KEY).toBe('server-only-key');
  });

  it('fails fast when required configuration is missing', () => {
    expect(() => loadServerEnv({ NODE_ENV: 'production' })).toThrow();
  });
});
