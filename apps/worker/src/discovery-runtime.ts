import type { ServerEnv } from '@ai-crm/config';
import {
  BrowserSessionFactory,
  ConcurrencyLimitedDiscoveryProvider,
  DiscoveryProviderRegistry,
  GoogleMapsBrowserProvider,
  OpenAiBrowserPageInterpreter,
  type BrowserPageInterpreter,
} from '@ai-crm/discovery';

function createInterpreter(env: ServerEnv): BrowserPageInterpreter | undefined {
  if (!env.OPENAI_API_KEY || !env.DISCOVERY_AI_MODEL) return undefined;

  return new OpenAiBrowserPageInterpreter({
    apiKey: env.OPENAI_API_KEY,
    model: env.DISCOVERY_AI_MODEL,
  });
}

export function createDiscoveryProviderRegistry(env: ServerEnv): DiscoveryProviderRegistry {
  const registry = new DiscoveryProviderRegistry();
  const interpreter = createInterpreter(env);
  const browserProvider = new GoogleMapsBrowserProvider({
    sessionFactory: new BrowserSessionFactory({
      headless: env.DISCOVERY_BROWSER_HEADLESS,
      navigationTimeoutMs: env.DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS,
      actionTimeoutMs: env.DISCOVERY_BROWSER_ACTION_TIMEOUT_MS,
    }),
    ...(interpreter ? { interpreter } : {}),
  });

  registry.register(
    new ConcurrencyLimitedDiscoveryProvider(
      browserProvider,
      env.DISCOVERY_BROWSER_CONCURRENCY,
    ),
  );

  return registry;
}
