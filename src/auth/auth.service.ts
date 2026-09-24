import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload } from './decorators.js';
import { toRole } from './roles.js';

const usuarioSelect = {
  id: true,
  nome: true,
  email: true,
  tipo_usuario: true,
  status: true,
} as const;

const ativo = (status: string | null) => (status ?? 'ATIVO') === 'ATIVO';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, senha: string) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { ...usuarioSelect, senha_hash: true },
    });
    const role = toRole(usuario?.tipo_usuario ?? null);
    const senhaValida =
      !!usuario && (await bcrypt.compare(senha, usuario.senha_hash));

    if (!usuario || !senhaValida || !role || !ativo(usuario.status))
      throw new UnauthorizedException('E-mail ou senha inválidos.');

    const payload: JwtPayload = { sub: usuario.id, email: usuario.email, role };
    return {
      access_token: await this.jwt.signAsync(payload),
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role,
      },
    };
  }

  async me(id: number) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { id },
      select: usuarioSelect,
    });
    const role = toRole(usuario?.tipo_usuario ?? null);
    if (!usuario || !role || !ativo(usuario.status))
      throw new UnauthorizedException('Usuário inativo ou inexistente.');

    return { id: usuario.id, nome: usuario.nome, email: usuario.email, role };
  }
}
