import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { jobTestSchema } from '@ai-crm/schemas';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseWithSchema } from '../validation/zod.js';
import { JobsService } from './jobs.service.js';

@Controller('jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  @Post('test')
  @HttpCode(HttpStatus.ACCEPTED)
  enqueueTest(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.jobsService.enqueueTest(user.id, parseWithSchema(jobTestSchema, body));
  }

  @Get(':jobId')
  getJob(
    @CurrentUser() user: AuthUser,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
  ) {
    return this.jobsService.getJob(user.id, jobId);
  }
}
