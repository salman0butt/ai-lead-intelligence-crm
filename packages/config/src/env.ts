import { z } from 'zod';

const optionalSecret = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().min(1).optional(),
);

const optionalString = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().min(1).optional(),
);

function booleanEnv(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === '' || value === null) return undefined;
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return value;
  }, z.boolean().default(defaultValue));
}

function integerEnv(options: { min: number; max: number; defaultValue: number }) {
  return z.preprocess((value) => {
    if (value === undefined || value === '' || value === null) return undefined;
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) return Number(value);
    return value;
  }, z.number().int().min(options.min).max(options.max).default(options.defaultValue));
}

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  API_URL: z.url(),
  NODE_ENV: z.enum(['development', 'test', 'production']),
  OPENAI_API_KEY: optionalSecret,
  DISCOVERY_AI_MODEL: optionalString,
  DISCOVERY_BROWSER_HEADLESS: booleanEnv(true),
  DISCOVERY_BROWSER_CONCURRENCY: integerEnv({ min: 1, max: 8, defaultValue: 1 }),
  DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS: integerEnv({
    min: 1,
    max: 120_000,
    defaultValue: 30_000,
  }),
  DISCOVERY_BROWSER_ACTION_TIMEOUT_MS: integerEnv({
    min: 1,
    max: 60_000,
    defaultValue: 10_000,
  }),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(input: Record<string, unknown>): ServerEnv {
  return serverEnvSchema.parse(input);
}
