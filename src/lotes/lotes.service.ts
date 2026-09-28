import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { escopoLotes, escopoPropriedades } from '../auth/escopo.js';
import { dataIso } from '../common/validacao.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PoligonoLote } from './geometria.js';

export type SituacaoLote = 'EM_PREPARO' | 'EM_CULTIVO' | 'COLHIDO';
export const SITUACOES_LOTE: SituacaoLote[] = [
  'EM_PREPARO',
  'EM_CULTIVO',
  'COLHIDO',
];

export interface DadosLote {
  nome_identificacao: string;
  propriedade_id: number;
  cultura_id: number;
  data_plantio: Date | null;
  previsao_colheita: Date | null;
  situacao: SituacaoLote;
  geometria: PoligonoLote | null;
  area_ha: number | null;
}

const loteSelect = {
  id: true,
  nome_identificacao: true,
  area_ha: true,
  data_plantio: true,
  previsao_colheita: true,
  situacao: true,
  geometria: true,
  propriedades: {
    select: {
      id: true,
      nome: true,
      latitude: true,
      longitude: true,
      empresas: { select: { id: true, razao_social: true } },
    },
  },
  culturas: { select: { id: true, nome: true, variedade: true } },
  _count: { select: { sensores: true, alertas_climaticos: true } },
} as const;

type LoteRow = Prisma.lotesGetPayload<{ select: typeof loteSelect }>;

function toDto(lote: LoteRow) {
  const { propriedades: p } = lote;
  return {
    id: lote.id,
    nome_identificacao: lote.nome_identificacao,
    area_ha: lote.area_ha?.toNumber() ?? null,
    data_plantio: dataIso(lote.data_plantio),
    previsao_colheita: dataIso(lote.previsao_colheita),
    situacao: (lote.situacao ?? 'EM_CULTIVO') as SituacaoLote,
    geometria: lote.geometria as PoligonoLote | null,
    propriedade: {
      id: p.id,
      nome: p.nome,
      latitude: p.latitude?.toNumber() ?? null,
      longitude: p.longitude?.toNumber() ?? null,
    },
    empresa: p.empresas,
    cultura: lote.culturas,
    total_sensores: lote._count.sensores,
    total_alertas: lote._count.alertas_climaticos,
  };
}

const DIA_MS = 86_400_000;

@Injectable()
export class LotesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(user: JwtPayload) {
    const lotes = await this.prisma.lotes.findMany({
      where: escopoLotes(user),
      select: loteSelect,
      orderBy: [
        { propriedades: { nome: 'asc' } },
        { nome_identificacao: 'asc' },
      ],
    });
    return lotes.map(toDto);
  }

  async buscar(user: JwtPayload, id: number) {
    const lote = await this.prisma.lotes.findFirst({
      where: { id, ...escopoLotes(user) },
      select: loteSelect,
    });
    if (!lote) throw new NotFoundException('Lote não encontrado.');
    return lote;
  }

  /** Confere propriedade (no escopo do usuário) e cultura; devolve o ciclo. */
  private async validarVinculos(user: JwtPayload, dados: DadosLote) {
    const [propriedade, cultura] = await Promise.all([
      this.prisma.propriedades.findFirst({
        where: { id: dados.propriedade_id, ...escopoPropriedades(user) },
        select: { id: true },
      }),
      this.prisma.culturas.findUnique({
        where: { id: dados.cultura_id },
        select: { ciclo_medio_dias: true },
      }),
    ]);
    if (!propriedade)
      throw new BadRequestException('Propriedade não encontrada.');
    if (!cultura) throw new BadRequestException('Cultura não encontrada.');

    if (
      dados.data_plantio &&
      dados.previsao_colheita &&
      dados.previsao_colheita < dados.data_plantio
    )
      throw new BadRequestException(
        'A previsão de colheita não pode ser antes do plantio.',
      );
    return cultura.ciclo_medio_dias;
  }

  private async garantirNomeUnico(dados: DadosLote, ignorarId?: number) {
    const repetido = await this.prisma.lotes.findFirst({
      where: {
        propriedade_id: dados.propriedade_id,
        nome_identificacao: {
          equals: dados.nome_identificacao,
          mode: 'insensitive',
        },
        ...(ignorarId && { id: { not: ignorarId } }),
      },
      select: { id: true },
    });
    if (repetido)
      throw new ConflictException(
        'Já existe um lote com essa identificação nesta propriedade.',
      );
  }

  /** Sem previsão informada, estima pelo ciclo médio da cultura. */
  private dadosGravacao(dados: DadosLote, cicloDias: number | null) {
    const previsao =
      dados.previsao_colheita ??
      (dados.data_plantio && cicloDias
        ? new Date(dados.data_plantio.getTime() + cicloDias * DIA_MS)
        : null);
    return {
      nome_identificacao: dados.nome_identificacao,
      propriedade_id: dados.propriedade_id,
      cultura_id: dados.cultura_id,
      data_plantio: dados.data_plantio,
      previsao_colheita: previsao,
      situacao: dados.situacao,
      area_ha: dados.area_ha,
      // DbNull grava NULL no banco (sem geometria)
      geometria: dados.geometria
        ? (dados.geometria as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    };
  }

  async criar(user: JwtPayload, dados: DadosLote) {
    const ciclo = await this.validarVinculos(user, dados);
    await this.garantirNomeUnico(dados);
    const lote = await this.prisma.lotes.create({
      data: this.dadosGravacao(dados, ciclo),
      select: loteSelect,
    });
    return toDto(lote);
  }

  async alterar(user: JwtPayload, id: number, dados: DadosLote) {
    await this.buscar(user, id);
    const ciclo = await this.validarVinculos(user, dados);
    await this.garantirNomeUnico(dados, id);
    const lote = await this.prisma.lotes.update({
      where: { id },
      data: this.dadosGravacao(dados, ciclo),
      select: loteSelect,
    });
    return toDto(lote);
  }

  async remover(user: JwtPayload, id: number) {
    const lote = await this.buscar(user, id);
    // a FK apaga os alertas do lote em cascata
    if (lote._count.alertas_climaticos > 0)
      throw new ConflictException(
        `O lote tem ${lote._count.alertas_climaticos} alerta(s) registrado(s). Marque-o como colhido em vez de excluir.`,
      );
    await this.prisma.lotes.delete({ where: { id } });
  }

  async detalhe(user: JwtPayload, id: number) {
    return toDto(await this.buscar(user, id));
  }
}
