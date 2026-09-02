import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DiscoveryAccessBlockedError } from '../src/browser/browser-errors.js';
import { BrowserSessionFactory } from '../src/browser/browser-session.js';
import { GoogleMapsBrowserProvider } from '../src/browser/google-maps-browser.provider.js';
import type { BrowserPageInterpreter } from '../src/browser/page-interpreter.js';

const searchInput = {
  query: 'Dentist',
  country: 'United States',
  region: 'Texas',
  city: 'Austin',
  geographicCell: 'Austin, Texas, United States',
  pageSize: 2,
};

describe('optional browser page interpretation', () => {
  let server: Server;
  let origin: string;
  let resultsHtml: string;

  beforeAll(async () => {
    resultsHtml = await readFile(
      new URL('./fixtures/maps-results-page.html', import.meta.url),
      'utf8',
    );

    server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(
        request.url === '/results'
          ? resultsHtml
          : '<!doctype html><html><head><title>Changed layout</title></head><body><main><p>Businesses are available in a layout the deterministic extractor does not recognize.</p></main></body></html>',
      );
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  function sessionFactory() {
    return new BrowserSessionFactory({
      headless: true,
      navigationTimeoutMs: 10_000,
      actionTimeoutMs: 5_000,
    });
  }

  it('does not invoke AI when deterministic rendered extraction succeeds', async () => {
    const interpret = vi.fn<BrowserPageInterpreter['interpret']>().mockResolvedValue({
      kind: 'UNKNOWN_LAYOUT',
    });
    const provider = new GoogleMapsBrowserProvider({
      sessionFactory: sessionFactory(),
      interpreter: { interpret },
      searchUrlBuilder: () => `${origin}/results`,
      scrollPauseMs: 25,
    });

    const page = await provider.searchBusinesses(searchInput);

    expect(page.results).toHaveLength(2);
    expect(interpret).not.toHaveBeenCalled();
  }, 20_000);

  it('fails closed on an unknown layout when AI interpretation is not configured', async () => {
    const provider = new GoogleMapsBrowserProvider({
      sessionFactory: sessionFactory(),
      searchUrlBuilder: () => `${origin}/unknown`,
      scrollPauseMs: 25,
    });

    await expect(provider.searchBusinesses(searchInput)).rejects.toThrow(/layout/i);
  }, 20_000);

  it('invokes the interpreter exactly once for an unknown rendered layout', async () => {
    const interpret = vi.fn<BrowserPageInterpreter['interpret']>().mockResolvedValue({
      kind: 'UNKNOWN_LAYOUT',
    });
    const provider = new GoogleMapsBrowserProvider({
      sessionFactory: sessionFactory(),
      interpreter: { interpret },
      searchUrlBuilder: () => `${origin}/unknown`,
      scrollPauseMs: 25,
    });

    await expect(provider.searchBusinesses(searchInput)).rejects.toThrow(/layout/i);

    expect(interpret).toHaveBeenCalledTimes(1);
    expect(interpret).toHaveBeenCalledWith({
      url: `${origin}/unknown`,
      title: 'Changed layout',
      visibleText: expect.stringContaining('deterministic extractor'),
      accessibilitySnapshot: expect.any(String),
    });
  }, 20_000);

  it('treats AI blocked classification as a stop condition', async () => {
    const interpret = vi.fn<BrowserPageInterpreter['interpret']>().mockResolvedValue({
      kind: 'BLOCKED_OR_CAPTCHA',
    });
    const provider = new GoogleMapsBrowserProvider({
      sessionFactory: sessionFactory(),
      interpreter: { interpret },
      searchUrlBuilder: () => `${origin}/unknown`,
      scrollPauseMs: 25,
    });

    await expect(provider.searchBusinesses(searchInput)).rejects.toBeInstanceOf(
      DiscoveryAccessBlockedError,
    );
    expect(interpret).toHaveBeenCalledTimes(1);
  }, 20_000);
});