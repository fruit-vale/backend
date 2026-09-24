import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NovaEmpresa {
  razao_social: string;
  cpf_cnpj: string;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  responsavel: string | null;
}

const empresaSelect = {
  id: true,
  razao_social: true,
  cpf_cnpj: true,
  telefone: true,
  email: true,
  cidade: true,
  estado: true,
  responsavel: true,
  _count: { select: { usuarios: true } },
} as const;

type EmpresaRow = NovaEmpresa & {
  id: number;
  _count: { usuarios: number };
};

function toDto({ _count, ...empresa }: EmpresaRow) {
  return { ...empresa, total_usuarios: _count.usuarios };
}

@Injectable()
export class EmpresasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar() {
    const empresas = await this.prisma.empresas.findMany({
      select: empresaSelect,
      orderBy: { razao_social: 'asc' },
    });
    return empresas.map(toDto);
  }

  async criar(dados: NovaEmpresa) {
    const existe = await this.prisma.empresas.findUnique({
      where: { cpf_cnpj: dados.cpf_cnpj },
      select: { id: true },
    });
    if (existe)
      throw new ConflictException('Já existe uma empresa com esse CNPJ.');

    const empresa = await this.prisma.empresas.create({
      data: dados,
      select: empresaSelect,
    });
    return toDto(empresa);
  }
}
