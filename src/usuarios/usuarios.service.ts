import { Injectable, NotFoundException } from '@nestjs/common';
import { toRole, toTipoUsuario, type Role } from '../auth/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';

const usuarioSelect = {
  id: true,
  nome: true,
  email: true,
  tipo_usuario: true,
  status: true,
} as const;

type UsuarioRow = {
  id: number;
  nome: string;
  email: string;
  tipo_usuario: string | null;
  status: string | null;
};

function toDto({ tipo_usuario, ...usuario }: UsuarioRow) {
  return { ...usuario, role: toRole(tipo_usuario) };
}

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar() {
    const usuarios = await this.prisma.usuarios.findMany({
      select: usuarioSelect,
      orderBy: { nome: 'asc' },
    });
    return usuarios.map(toDto);
  }

  async alterarPerfil(id: number, role: Role) {
    const existe = await this.prisma.usuarios.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Usuário não encontrado.');

    const usuario = await this.prisma.usuarios.update({
      where: { id },
      data: { tipo_usuario: toTipoUsuario(role) },
      select: usuarioSelect,
    });
    return toDto(usuario);
  }
}
