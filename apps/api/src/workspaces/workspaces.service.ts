import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient } from '@ai-crm/database';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class WorkspacesService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async listForUser(userId: string) {
    const memberships = await this.db.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => ({
      id: membership.workspace.id,
      name: membership.workspace.name,
      role: membership.role,
    }));
  }

  async create(userId: string, name: string) {
    const workspace = await this.db.workspace.create({
      data: { name, members: { create: { userId, role: 'OWNER' } } },
    });
    return { id: workspace.id, name: workspace.name, role: 'OWNER' as const };
  }

  async getDashboard(userId: string, workspaceId: string) {
    const membership = await this.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });
    if (!membership) throw new ForbiddenException('Workspace access denied');

    return {
      workspace: { id: membership.workspace.id, name: membership.workspace.name },
      role: membership.role,
      status: 'ready',
    };
  }
}
