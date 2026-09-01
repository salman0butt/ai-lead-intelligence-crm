import { z } from 'zod';

const optionalSecret = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().min(1).optional(),
);

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  API_URL: z.url(),
  NODE_ENV: z.enum(['development', 'test', 'production']),
  OPENAI_API_KEY: optionalSecret,
  GOOGLE_PLACES_API_KEY: optionalSecret,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(input: Record<string, unknown>): ServerEnv {
  return serverEnvSchema.parse(input);
}
