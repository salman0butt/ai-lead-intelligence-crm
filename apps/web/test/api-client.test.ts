import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../lib/api-client.js';

describe('api client', () => {
  it('sends the bearer token without exposing server secrets', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const client = createApiClient({ baseUrl: 'http://api.test', token: 'secret-token', fetcher });

    await client.get('/auth/me');

    expect(fetcher).toHaveBeenCalledWith('http://api.test/auth/me', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
    }));
  });
});
