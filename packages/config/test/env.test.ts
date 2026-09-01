import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '../src/env.js';

describe('loadServerEnv', () => {
  it('accepts the required Milestone 0 environment and leaves OpenAI optional', () => {
    const env = loadServerEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app',
      APP_URL: 'http://localhost:3000',
      API_URL: 'http://localhost:4000',
      NODE_ENV: 'test',
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('fails fast when required configuration is missing', () => {
    expect(() => loadServerEnv({ NODE_ENV: 'production' })).toThrow();
  });
});
