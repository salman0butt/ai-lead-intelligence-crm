import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { DatabaseClient } from '@ai-crm/database';
import type { LoginInput, RegisterInput } from '@ai-crm/schemas';
import { DATABASE } from '../database/database.module.js';
import { createSessionToken, hashSessionToken } from './session-token.js';
import { hashPassword, verifyPassword } from './password.js';
import type { AuthUser } from './auth.types.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async register(input: RegisterInput) {
    const existing = await this.db.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('Email is already registered');

    const passwordHash = await hashPassword(input.password);
    const user = await this.db.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        memberships: {
          create: {
            role: 'OWNER',
            workspace: { create: { name: input.workspaceName } },
          },
        },
      },
      include: { memberships: { include: { workspace: true } } },
    });

    const token = await this.issueSession(user.id);
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
      workspaces: user.memberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        role: membership.role,
      })),
    };
  }

  async login(input: LoginInput) {
    const user = await this.db.user.findUnique({
      where: { email: input.email },
      include: { memberships: { include: { workspace: true } } },
    });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = await this.issueSession(user.id);
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
      workspaces: user.memberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        role: membership.role,
      })),
    };
  }

  async authenticateToken(token: string): Promise<AuthUser> {
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session is invalid or expired');
    }
    return { id: session.user.id, email: session.user.email, name: session.user.name };
  }

  async me(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { workspace: true } } },
    });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      workspaces: user.memberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        role: membership.role,
      })),
    };
  }

  private async issueSession(userId: string): Promise<string> {
    const token = createSessionToken();
    await this.db.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return token;
  }
}
