import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public, type JwtPayload } from './decorators.js';

interface LoginBody {
  email?: unknown;
  senha?: unknown;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginBody) {
    if (typeof body?.email !== 'string' || typeof body?.senha !== 'string')
      throw new BadRequestException('Informe e-mail e senha.');
    return this.auth.login(body.email, body.senha);
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.me(user.sub);
  }
}
