import { z } from 'zod';

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());

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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>;
