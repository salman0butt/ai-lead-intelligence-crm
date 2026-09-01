import type { BusinessDiscoveryProvider } from './types.js';

export class DiscoveryProviderRegistry {
  private readonly providers = new Map<string, BusinessDiscoveryProvider>();

  register(provider: BusinessDiscoveryProvider): void {
    const name = provider.name.trim();
    if (!name) throw new Error('Discovery provider name is required');
    this.providers.set(name, provider);
  }

  get(name: string): BusinessDiscoveryProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Discovery provider "${name}" is not configured`);
    return provider;
  }
}
