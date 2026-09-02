import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '../src/env.js';

const requiredEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  NODE_ENV: 'test' as const,
};

describe('loadServerEnv', () => {
  it('accepts required environment and applies safe browser discovery defaults', () => {
    const env = loadServerEnv(requiredEnv);

    expect(env.NODE_ENV).toBe('test');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.DISCOVERY_AI_MODEL).toBeUndefined();
    expect(env.DISCOVERY_BROWSER_HEADLESS).toBe(true);
    expect(env.DISCOVERY_BROWSER_CONCURRENCY).toBe(1);
    expect(env.DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS).toBe(30_000);
    expect(env.DISCOVERY_BROWSER_ACTION_TIMEOUT_MS).toBe(10_000);
    expect(env).not.toHaveProperty('GOOGLE_PLACES_API_KEY');
  });

  it('parses explicit browser runtime settings', () => {
    const env = loadServerEnv({
      ...requiredEnv,
      DISCOVERY_BROWSER_HEADLESS: 'false',
      DISCOVERY_BROWSER_CONCURRENCY: '3',
      DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS: '45000',
      DISCOVERY_BROWSER_ACTION_TIMEOUT_MS: '15000',
    });

    expect(env.DISCOVERY_BROWSER_HEADLESS).toBe(false);
    expect(env.DISCOVERY_BROWSER_CONCURRENCY).toBe(3);
    expect(env.DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS).toBe(45_000);
    expect(env.DISCOVERY_BROWSER_ACTION_TIMEOUT_MS).toBe(15_000);
  });

  it('rejects unsafe browser runtime settings', () => {
    expect(() =>
      loadServerEnv({ ...requiredEnv, DISCOVERY_BROWSER_CONCURRENCY: '0' }),
    ).toThrow();
    expect(() =>
      loadServerEnv({ ...requiredEnv, DISCOVERY_BROWSER_CONCURRENCY: '9' }),
    ).toThrow();
    expect(() =>
      loadServerEnv({ ...requiredEnv, DISCOVERY_BROWSER_HEADLESS: 'maybe' }),
    ).toThrow();
    expect(() =>
      loadServerEnv({ ...requiredEnv, DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS: '0' }),
    ).toThrow();
  });

  it('accepts an optional discovery AI fallback model without requiring it', () => {
    const env = loadServerEnv({
      ...requiredEnv,
      OPENAI_API_KEY: 'test-key',
      DISCOVERY_AI_MODEL: 'gpt-5.6-sol',
    });

    expect(env.OPENAI_API_KEY).toBe('test-key');
    expect(env.DISCOVERY_AI_MODEL).toBe('gpt-5.6-sol');
  });

  it('ignores obsolete Google Places credentials because browser discovery does not use them', () => {
    const env = loadServerEnv({ ...requiredEnv, GOOGLE_PLACES_API_KEY: 'obsolete-key' });

    expect(env).not.toHaveProperty('GOOGLE_PLACES_API_KEY');
  });

  it('fails fast when required configuration is missing', () => {
    expect(() => loadServerEnv({ NODE_ENV: 'production' })).toThrow();
  });
});
