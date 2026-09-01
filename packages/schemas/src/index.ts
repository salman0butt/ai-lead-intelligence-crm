import { z } from 'zod';

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const optionalTrimmedString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).max(max).optional(),
  );

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(120),
  workspaceName: z.string().trim().min(1).max(120),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const jobTestSchema = z.object({
  workspaceId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const createCampaignSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  country: z.string().trim().min(1).max(120),
  region: optionalTrimmedString(120),
  city: optionalTrimmedString(120),
  niche: z.string().trim().min(1).max(160),
  requestedLeadCount: z.number().int().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>;
export type JobTestInput = z.infer<typeof jobTestSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
