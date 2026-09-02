import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@ai-crm/config';
import { createDiscoveryProviderRegistry } from '../src/discovery-runtime.js';

const requiredEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  NODE_ENV: 'test',
};

describe('createDiscoveryProviderRegistry', () => {
  it('registers google-maps-browser without API credentials or launching a browser', () => {
    const env = loadServerEnv(requiredEnv);
    const registry = createDiscoveryProviderRegistry(env);

    expect(registry.get('google-maps-browser').name).toBe('google-maps-browser');
  });

  it('still registers browser discovery when only generic OpenAI credentials are present', () => {
    const env = loadServerEnv({ ...requiredEnv, OPENAI_API_KEY: 'shared-key' });
    const registry = createDiscoveryProviderRegistry(env);

    expect(registry.get('google-maps-browser').name).toBe('google-maps-browser');
  });

  it('accepts optional AI layout interpretation only when both key and model are configured', () => {
    const env = loadServerEnv({
      ...requiredEnv,
      OPENAI_API_KEY: 'shared-key',
      DISCOVERY_AI_MODEL: 'gpt-test',
    });
    const registry = createDiscoveryProviderRegistry(env);

    expect(registry.get('google-maps-browser').name).toBe('google-maps-browser');
  });
});
