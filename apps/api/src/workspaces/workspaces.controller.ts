import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { workspaceCreateSchema } from '@ai-crm/schemas';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { parseWithSchema } from '../validation/zod.js';
import { WorkspacesService } from './workspaces.service.js';

@Controller('workspaces')
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(@Inject(WorkspacesService) private readonly workspacesService: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.workspacesService.listForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseWithSchema(workspaceCreateSchema, body);
    return this.workspacesService.create(user.id, input.name);
  }

  @Get(':workspaceId/dashboard')
  dashboard(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.workspacesService.getDashboard(user.id, workspaceId);
  }
}
