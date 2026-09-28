import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload } from './decorators.js';
import { exigeEmpresa, toRole } from './roles.js';

const usuarioSelect = {
  id: true,
  nome: true,
  email: true,
  tipo_usuario: true,
  status: true,
  empresa_id: true,
  empresas: { select: { id: true, razao_social: true } },
} as const;

type UsuarioRow = {
  id: number;
  nome: string;
  email: string;
  tipo_usuario: string | null;
  status: string | null;
  empresa_id: number | null;
  empresas: { id: number; razao_social: string } | null;
};

export const ativo = (status: string | null) => (status ?? 'ATIVO') === 'ATIVO';

/** Perfil do usuário, ou null se ele não pode acessar o sistema. */
function perfil(usuario: UsuarioRow | null) {
  const role = toRole(usuario?.tipo_usuario ?? null);
  if (!usuario || !role || !ativo(usuario.status)) return null;
  if (exigeEmpresa(role) && usuario.empresa_id === null) return null;

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    role,
    empresa: usuario.empresas,
  };
}

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
    const senhaValida =
      !!usuario && (await bcrypt.compare(senha, usuario.senha_hash));
    if (!usuario || !senhaValida)
      throw new UnauthorizedException('E-mail ou senha inválidos.');

    const dados = perfil(usuario);
    if (!dados)
      throw new UnauthorizedException(
        'Acesso não liberado. Fale com o administrador.',
      );

    const payload: JwtPayload = {
      sub: dados.id,
      email: dados.email,
      role: dados.role,
      empresa_id: usuario.empresa_id,
    };
    return {
      access_token: await this.jwt.signAsync(payload),
      usuario: dados,
    };
  }

  async me(id: number) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { id },
      select: usuarioSelect,
    });
    const dados = perfil(usuario);
    if (!dados)
      throw new UnauthorizedException('Usuário inativo ou sem acesso.');

    return dados;
  }
}
