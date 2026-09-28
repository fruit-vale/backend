import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
}

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
  _count: { lotes: number };
};

const num = (valor: Decimal) => valor?.toNumber() ?? null;

function toDto({ _count, ...c }: CulturaRow) {
  return {
    ...c,
    temp_recomendada_min: num(c.temp_recomendada_min),
    temp_recomendada_max: num(c.temp_recomendada_max),
    umidade_recomendada_min: num(c.umidade_recomendada_min),
    umidade_recomendada_max: num(c.umidade_recomendada_max),
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

@Injectable()
export class CulturasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar() {
    const culturas = await this.prisma.culturas.findMany({
      select: culturaSelect,
      orderBy: [{ nome: 'asc' }, { variedade: 'asc' }],
    });
    return culturas.map(toDto);
  }

  private async garantirUnica(dados: DadosCultura, ignorarId?: number) {
    const repetida = await this.prisma.culturas.findFirst({
      where: {
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

  async criar(dados: DadosCultura) {
    validarFaixas(dados);
    await this.garantirUnica(dados);
    const cultura = await this.prisma.culturas.create({
      data: dados,
      select: culturaSelect,
    });
    return toDto(cultura);
  }

  async alterar(id: number, dados: DadosCultura) {
    const existe = await this.prisma.culturas.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Cultura não encontrada.');

    validarFaixas(dados);
    await this.garantirUnica(dados, id);
    const cultura = await this.prisma.culturas.update({
      where: { id },
      data: dados,
      select: culturaSelect,
    });
    return toDto(cultura);
  }

  async remover(id: number) {
    const cultura = await this.prisma.culturas.findUnique({
      where: { id },
      select: {
        _count: { select: { lotes: true, dados_mercado: true } },
      },
    });
    if (!cultura) throw new NotFoundException('Cultura não encontrada.');
    const { lotes, dados_mercado } = cultura._count;
    if (lotes || dados_mercado)
      throw new ConflictException(
        `A cultura está em uso (${lotes} lote(s), ${dados_mercado} registro(s) de mercado) e não pode ser excluída.`,
      );
    await this.prisma.culturas.delete({ where: { id } });
  }
}
