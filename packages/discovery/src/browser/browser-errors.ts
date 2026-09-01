import { DiscoveryProviderError } from '../types.js';

export class DiscoveryAccessBlockedError extends DiscoveryProviderError {
  readonly blocked = true;

  constructor(message: string, options: { rateLimited?: boolean; cause?: unknown } = {}) {
    super(message, options.rateLimited === false ? 403 : 429, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DiscoveryAccessBlockedError';
  }
}
