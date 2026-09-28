import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  IS_PUBLIC_KEY,
  ROLES_KEY,
  type AuthenticatedRequest,
  type JwtPayload,
} from './decorators.js';
import { PerfilService } from './perfil.service.js';
import type { Role } from './roles.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly perfis: PerfilService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token)
      throw new UnauthorizedException('Token não informado.');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
    // perfil e empresa atuais: o token pode ser anterior a uma troca de
    // perfil/empresa ou à desativação do usuário
    const perfil = await this.perfis.atual(payload.sub);
    if (!perfil)
      throw new UnauthorizedException('Usuário inativo ou sem acesso.');
    request.user = perfil;

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles && !roles.includes(request.user.role))
      throw new ForbiddenException('Seu perfil não tem acesso a este recurso.');

    return true;
  }
}
