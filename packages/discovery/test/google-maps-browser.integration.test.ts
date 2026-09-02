import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiscoveryAccessBlockedError } from '../src/browser/browser-errors.js';
import { BrowserSessionFactory } from '../src/browser/browser-session.js';
import { decodeGoogleMapsCursor } from '../src/browser/cursor.js';
import { GoogleMapsBrowserProvider } from '../src/browser/google-maps-browser.provider.js';

const searchInput = {
  query: 'Dentist',
  country: 'United States',
  region: 'Texas',
  city: 'Austin',
  geographicCell: 'Austin, Texas, United States',
  pageSize: 2,
};

describe('GoogleMapsBrowserProvider with real Chromium', () => {
  let server: Server;
  let origin: string;
  let resultsHtml: string;
  let blockedHtml: string;

  beforeAll(async () => {
    [resultsHtml, blockedHtml] = await Promise.all([
      readFile(new URL('./fixtures/maps-results-page.html', import.meta.url), 'utf8'),
      readFile(new URL('./fixtures/maps-blocked-page.html', import.meta.url), 'utf8'),
    ]);

    server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(request.url === '/blocked' ? blockedHtml : resultsHtml);
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

  function createProvider(path = '/results') {
    return new GoogleMapsBrowserProvider({
      sessionFactory: new BrowserSessionFactory({
        headless: true,
        navigationTimeoutMs: 10_000,
        actionTimeoutMs: 5_000,
      }),
      searchUrlBuilder: () => `${origin}${path}`,
      scrollPauseMs: 25,
    });
  }

  it('extracts rendered cards and resumes from a durable cursor in a fresh browser session', async () => {
    const firstProvider = createProvider();
    const firstPage = await firstProvider.searchBusinesses(searchInput);

    expect(firstPage.results.map((result) => result.name)).toEqual([
      'Example Dental',
      'Family Smiles',
    ]);
    expect(firstPage.results.map((result) => result.formattedAddress)).toEqual([
      '123 Main St, Austin, TX',
      '456 Congress Ave, Austin, TX',
    ]);
    expect(firstPage.nextCursor).not.toBeNull();

    const cursor = decodeGoogleMapsCursor(firstPage.nextCursor!);
    expect(cursor.seenIds).toHaveLength(2);
    expect(cursor.scrollRounds).toBe(0);

    const resumedProvider = createProvider();
    const secondPage = await resumedProvider.continueSearch(searchInput, firstPage.nextCursor!);

    expect(secondPage.results).toHaveLength(1);
    expect(secondPage.results[0]).toMatchObject({
      name: 'Austin Orthodontics',
      category: 'Orthodontist',
      formattedAddress: '789 Lamar Blvd, Austin, TX',
      latitude: 30.3,
      longitude: -97.9,
    });
    expect(secondPage.nextCursor).toBeNull();
  }, 20_000);

  it('stops on a rendered CAPTCHA/access-block page instead of interacting with it', async () => {
    const provider = createProvider('/blocked');

    await expect(provider.searchBusinesses(searchInput)).rejects.toBeInstanceOf(
      DiscoveryAccessBlockedError,
    );
  }, 20_000);
});
