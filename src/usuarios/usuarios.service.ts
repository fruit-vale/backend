import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  exigeEmpresa,
  toRole,
  toTipoUsuario,
  type Role,
} from '../auth/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';

const usuarioSelect = {
  id: true,
  nome: true,
  email: true,
  cpf: true,
  telefone: true,
  tipo_usuario: true,
  status: true,
  empresas: { select: { id: true, razao_social: true } },
} as const;

type UsuarioRow = {
  id: number;
  nome: string;
  email: string;
  cpf: string;
  telefone: string | null;
  tipo_usuario: string | null;
  status: string | null;
  empresas: { id: number; razao_social: string } | null;
};

export interface NovoUsuario {
  nome: string;
  email: string;
  cpf: string;
  telefone: string | null;
  senha: string;
  role: Role;
  empresa_id: number | null;
}

export interface AlteracaoUsuario {
  role?: Role;
  empresa_id?: number | null;
}

function toDto({ tipo_usuario, empresas, ...usuario }: UsuarioRow) {
  return { ...usuario, role: toRole(tipo_usuario), empresa: empresas };
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

  async criar({ senha, role, ...dados }: NovoUsuario) {
    await this.validarVinculo(role, dados.empresa_id);

    const duplicado = await this.prisma.usuarios.findFirst({
      where: { OR: [{ email: dados.email }, { cpf: dados.cpf }] },
      select: { email: true },
    });
    if (duplicado)
      throw new ConflictException(
        duplicado.email === dados.email
          ? 'Já existe um usuário com esse e-mail.'
          : 'Já existe um usuário com esse CPF.',
      );

    const usuario = await this.prisma.usuarios.create({
      data: {
        ...dados,
        senha_hash: await bcrypt.hash(senha, 10),
        tipo_usuario: toTipoUsuario(role),
        status: 'ATIVO',
      },
      select: usuarioSelect,
    });
    return toDto(usuario);
  }

  async alterar(id: number, alteracao: AlteracaoUsuario) {
    const atual = await this.prisma.usuarios.findUnique({
      where: { id },
      select: { tipo_usuario: true, empresa_id: true },
    });
    if (!atual) throw new NotFoundException('Usuário não encontrado.');

    const role = alteracao.role ?? toRole(atual.tipo_usuario);
    const empresaId =
      alteracao.empresa_id !== undefined
        ? alteracao.empresa_id
        : atual.empresa_id;
    if (role) await this.validarVinculo(role, empresaId);

    const usuario = await this.prisma.usuarios.update({
      where: { id },
      data: {
        ...(alteracao.role && { tipo_usuario: toTipoUsuario(alteracao.role) }),
        empresa_id: empresaId,
      },
      select: usuarioSelect,
    });
    return toDto(usuario);
  }

  /** Administrador é da plataforma; produtor e analista precisam de uma empresa existente. */
  private async validarVinculo(role: Role, empresaId: number | null) {
    if (exigeEmpresa(role) && empresaId === null)
      throw new BadRequestException(
        'Produtor e analista precisam estar vinculados a uma empresa.',
      );
    if (!exigeEmpresa(role) && empresaId !== null)
      throw new BadRequestException(
        'Administrador é da plataforma e não pode ter empresa.',
      );
    if (
      empresaId !== null &&
      !(await this.prisma.empresas.findUnique({
        where: { id: empresaId },
        select: { id: true },
      }))
    )
      throw new BadRequestException('Empresa não encontrada.');
  }
}
