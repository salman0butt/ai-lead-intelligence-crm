import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';

interface AuthenticatedRequest {
  headers: { authorization?: string };
  authUser?: AuthUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token is required');
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException('Bearer token is required');
    request.authUser = await this.authService.authenticateToken(token);
    return true;
  }
}
