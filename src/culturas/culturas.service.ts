import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { escopoCulturas } from '../auth/escopo.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface DadosCultura {
  nome: string;
  variedade: string | null;
  temp_recomendada_min: number | null;
  temp_recomendada_max: number | null;
  umidade_recomendada_min: number | null;
  umidade_recomendada_max: number | null;
  ciclo_medio_dias: number | null;
  descricao: string | null;
  /** abaixo dela a planta não se desenvolve (°C) */
  temp_base_graus_dia: number | null;
  /** graus-dia somados do plantio à colheita */
  graus_dia_ciclo: number | null;
}

/** null = cultura da plataforma (visível a todas as empresas). */
export type EmpresaCultura = number | null;

const culturaSelect = {
  id: true,
  nome: true,
  variedade: true,
  temp_recomendada_min: true,
  temp_recomendada_max: true,
  umidade_recomendada_min: true,
  umidade_recomendada_max: true,
  ciclo_medio_dias: true,
  descricao: true,
  temp_base_graus_dia: true,
  graus_dia_ciclo: true,
  empresas: { select: { id: true, razao_social: true } },
  _count: { select: { lotes: true } },
} as const;

type Decimal = { toNumber(): number } | null;
type CulturaRow = {
  id: number;
  nome: string;
  variedade: string | null;
  temp_recomendada_min: Decimal;
  temp_recomendada_max: Decimal;
  umidade_recomendada_min: Decimal;
  umidade_recomendada_max: Decimal;
  ciclo_medio_dias: number | null;
  descricao: string | null;
  temp_base_graus_dia: Decimal;
  graus_dia_ciclo: number | null;
  empresas: { id: number; razao_social: string } | null;
  _count: { lotes: number };
};

const num = (valor: Decimal) => valor?.toNumber() ?? null;

function toDto({ _count, empresas, ...c }: CulturaRow) {
  return {
    ...c,
    empresa: empresas,
    temp_recomendada_min: num(c.temp_recomendada_min),
    temp_recomendada_max: num(c.temp_recomendada_max),
    umidade_recomendada_min: num(c.umidade_recomendada_min),
    umidade_recomendada_max: num(c.umidade_recomendada_max),
    temp_base_graus_dia: num(c.temp_base_graus_dia),
    total_lotes: _count.lotes,
  };
}

/** Mínimo não pode passar do máximo (quando os dois foram informados). */
function validarFaixas(dados: DadosCultura) {
  const faixas: [number | null, number | null, string][] = [
    [dados.temp_recomendada_min, dados.temp_recomendada_max, 'temperatura'],
    [dados.umidade_recomendada_min, dados.umidade_recomendada_max, 'umidade'],
  ];
  for (const [min, max, nome] of faixas)
    if (min !== null && max !== null && min > max)
      throw new BadRequestException(
        `A ${nome} mínima não pode ser maior que a máxima.`,
      );
}

/**
 * Culturas da plataforma (empresa_id NULL, geridas pelo administrador) e
 * culturas de cada empresa (geridas também pelos produtores dela).
 */
@Injectable()
export class CulturasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(user: JwtPayload) {
    const culturas = await this.prisma.culturas.findMany({
      where: escopoCulturas(user),
      select: culturaSelect,
      orderBy: [{ nome: 'asc' }, { variedade: 'asc' }],
    });
    return culturas.map(toDto);
  }

  /** Cultura que o usuário pode alterar ou excluir. */
  private async editavel(user: JwtPayload, id: number) {
    const cultura = await this.prisma.culturas.findFirst({
      where: { id, ...escopoCulturas(user) },
      select: {
        empresa_id: true,
        _count: {
          select: { lotes: true, dados_mercado: true, ciclos_cultivo: true },
        },
      },
    });
    if (!cultura) throw new NotFoundException('Cultura não encontrada.');
    if (user.role !== 'administrador' && cultura.empresa_id === null)
      throw new ForbiddenException(
        'Culturas da plataforma só podem ser alteradas pelo administrador.',
      );
    return cultura;
  }

  /** Nome + variedade não se repetem dentro da mesma empresa (ou da plataforma). */
  private async garantirUnica(
    dados: DadosCultura,
    empresaId: EmpresaCultura,
    ignorarId?: number,
  ) {
    const repetida = await this.prisma.culturas.findFirst({
      where: {
        empresa_id: empresaId,
        nome: { equals: dados.nome, mode: 'insensitive' },
        variedade: dados.variedade
          ? { equals: dados.variedade, mode: 'insensitive' }
          : null,
        ...(ignorarId && { id: { not: ignorarId } }),
      },
      select: { id: true },
    });
    if (repetida)
      throw new ConflictException(
        'Já existe uma cultura com esse nome e variedade.',
      );
  }

  /**
   * O administrador escolhe a empresa (ou a plataforma); o produtor sempre
   * cria na própria empresa.
   */
  async criar(
    user: JwtPayload,
    dados: DadosCultura,
    empresaId: EmpresaCultura,
  ) {
    const empresa =
      user.role === 'administrador' ? empresaId : (user.empresa_id ?? null);
    if (user.role !== 'administrador' && empresa === null)
      throw new ForbiddenException('Seu usuário não tem empresa vinculada.');
    if (
      empresa !== null &&
      !(await this.prisma.empresas.findUnique({
        where: { id: empresa },
        select: { id: true },
      }))
    )
      throw new BadRequestException('Empresa não encontrada.');

    validarFaixas(dados);
    await this.garantirUnica(dados, empresa);
    const cultura = await this.prisma.culturas.create({
      data: { ...dados, empresa_id: empresa },
      select: culturaSelect,
    });
    return toDto(cultura);
  }

  /** A empresa da cultura não muda depois de criada (lotes dependem dela). */
  async alterar(user: JwtPayload, id: number, dados: DadosCultura) {
    const atual = await this.editavel(user, id);
    validarFaixas(dados);
    await this.garantirUnica(dados, atual.empresa_id, id);
    const cultura = await this.prisma.culturas.update({
      where: { id },
      data: dados,
      select: culturaSelect,
    });
    return toDto(cultura);
  }

  async remover(user: JwtPayload, id: number) {
    const cultura = await this.editavel(user, id);
    const { lotes, dados_mercado, ciclos_cultivo } = cultura._count;
    if (lotes || dados_mercado || ciclos_cultivo)
      throw new ConflictException(
        `A cultura está em uso (${lotes} lote(s), ${ciclos_cultivo} safra(s) no histórico, ${dados_mercado} registro(s) de mercado) e não pode ser excluída.`,
      );
    await this.prisma.culturas.delete({ where: { id } });
  }
}
