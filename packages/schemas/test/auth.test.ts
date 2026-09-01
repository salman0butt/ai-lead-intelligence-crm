import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema, workspaceCreateSchema } from '../src/index.js';

describe('shared request schemas', () => {
  it('normalizes email and validates registration input', () => {
    const input = registerSchema.parse({
      email: '  USER@Example.COM ',
      password: 'correct-horse-battery-staple',
      name: 'Salman',
      workspaceName: 'My Workspace',
    });

    expect(input.email).toBe('user@example.com');
  });

  it('rejects malformed login and workspace payloads', () => {
    expect(loginSchema.safeParse({ email: 'bad', password: '' }).success).toBe(false);
    expect(workspaceCreateSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
