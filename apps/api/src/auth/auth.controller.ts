import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { loginSchema, registerSchema } from '@ai-crm/schemas';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthUser } from './auth.types.js';
import { parseWithSchema } from '../validation/zod.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: unknown) {
    return this.authService.register(parseWithSchema(registerSchema, body));
  }

  @Post('login')
  login(@Body() body: unknown) {
    return this.authService.login(parseWithSchema(loginSchema, body));
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.id);
  }
}
