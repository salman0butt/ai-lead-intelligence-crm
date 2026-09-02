import type {
  BusinessDiscoveryPage,
  BusinessDiscoveryProvider,
  BusinessSearchInput,
  NormalizedBusiness,
} from './types.js';

class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Discovery provider concurrency must be a positive integer');
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }

    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export class ConcurrencyLimitedDiscoveryProvider<TRaw = unknown>
  implements BusinessDiscoveryProvider<TRaw>
{
  readonly name: string;
  private readonly semaphore: AsyncSemaphore;

  constructor(
    private readonly provider: BusinessDiscoveryProvider<TRaw>,
    concurrency: number,
  ) {
    this.name = provider.name;
    this.semaphore = new AsyncSemaphore(concurrency);
  }

  searchBusinesses(input: BusinessSearchInput): Promise<BusinessDiscoveryPage<TRaw>> {
    return this.semaphore.run(() => this.provider.searchBusinesses(input));
  }

  continueSearch(
    input: BusinessSearchInput,
    cursor: string,
  ): Promise<BusinessDiscoveryPage<TRaw>> {
    return this.semaphore.run(() => this.provider.continueSearch(input, cursor));
  }

  normalizeResult(raw: TRaw): NormalizedBusiness {
    return this.provider.normalizeResult(raw);
  }

  async close(): Promise<void> {
    await this.provider.close?.();
  }
}
