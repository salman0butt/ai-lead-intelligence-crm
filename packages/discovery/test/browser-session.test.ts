import { describe, expect, it, vi } from 'vitest';
import { BrowserSessionFactory } from '../src/browser/browser-session.js';

describe('BrowserSessionFactory', () => {
  it('launches an isolated browser context and applies configured timeouts', async () => {
    const setDefaultNavigationTimeout = vi.fn();
    const setDefaultTimeout = vi.fn();
    const page = { setDefaultNavigationTimeout, setDefaultTimeout };
    const newPage = vi.fn(async () => page);
    const context = { newPage };
    const newContext = vi.fn(async () => context);
    const browser = { newContext };
    const launch = vi.fn(async () => browser);

    const factory = new BrowserSessionFactory(
      {
        headless: true,
        navigationTimeoutMs: 30_000,
        actionTimeoutMs: 10_000,
      },
      { launch } as never,
    );

    const session = await factory.open();

    expect(launch).toHaveBeenCalledWith({ headless: true });
    expect(newContext).toHaveBeenCalledTimes(1);
    expect(newPage).toHaveBeenCalledTimes(1);
    expect(setDefaultNavigationTimeout).toHaveBeenCalledWith(30_000);
    expect(setDefaultTimeout).toHaveBeenCalledWith(10_000);
    expect(session).toEqual({ browser, context, page });
  });
});
