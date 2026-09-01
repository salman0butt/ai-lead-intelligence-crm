import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '../src/env.js';

const requiredEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  NODE_ENV: 'test' as const,
};

describe('loadServerEnv', () => {
  it('accepts required environment and keeps AI credentials optional', () => {
    const env = loadServerEnv(requiredEnv);

    expect(env.NODE_ENV).toBe('test');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env).not.toHaveProperty('GOOGLE_PLACES_API_KEY');
  });

  it('ignores obsolete Google Places credentials because browser discovery does not use them', () => {
    const env = loadServerEnv({ ...requiredEnv, GOOGLE_PLACES_API_KEY: 'obsolete-key' });

    expect(env).not.toHaveProperty('GOOGLE_PLACES_API_KEY');
  });

  it('fails fast when required configuration is missing', () => {
    expect(() => loadServerEnv({ NODE_ENV: 'production' })).toThrow();
  });
});
