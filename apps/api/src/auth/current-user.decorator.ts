import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth.types.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<{ authUser: AuthUser }>();
    return request.authUser;
  },
);
