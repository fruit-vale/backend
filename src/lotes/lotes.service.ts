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
import { poligonoDentro, type PoligonoLote } from './geometria.js';

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
  // safra em andamento (no máximo uma, garantido por índice único)
  ciclos_cultivo: {
    where: { data_colheita: null },
    select: { id: true },
    take: 1,
  },
  _count: {
    select: { sensores: true, alertas_climaticos: true, ciclos_cultivo: true },
  },
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
    safra_atual_id: lote.ciclos_cultivo[0]?.id ?? null,
    total_safras: lote._count.ciclos_cultivo,
  };
}

const DIA_MS = 86_400_000;

/** Sem previsão informada, estima pelo ciclo médio da cultura. */
export function estimarColheita(
  plantio: Date | null,
  previsao: Date | null,
  cicloDias: number | null,
) {
  if (previsao) return previsao;
  return plantio && cicloDias
    ? new Date(plantio.getTime() + cicloDias * DIA_MS)
    : null;
}

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
        select: { id: true, nome: true, empresa_id: true, geometria: true },
      }),
      this.prisma.culturas.findUnique({
        where: { id: dados.cultura_id },
        select: { ciclo_medio_dias: true, empresa_id: true },
      }),
    ]);
    if (!propriedade)
      throw new BadRequestException('Propriedade não encontrada.');
    // cultura da plataforma ou da mesma empresa da propriedade
    if (
      !cultura ||
      (cultura.empresa_id !== null &&
        cultura.empresa_id !== propriedade.empresa_id)
    )
      throw new BadRequestException('Cultura não encontrada.');

    // o lote é parte da propriedade: o contorno não pode passar da área dela
    // (propriedades antigas, sem área desenhada, não limitam)
    if (
      dados.geometria &&
      propriedade.geometria &&
      !poligonoDentro(
        dados.geometria,
        propriedade.geometria as unknown as PoligonoLote,
      )
    )
      throw new BadRequestException(
        `O lote precisa ficar dentro da área da propriedade ${propriedade.nome}. Ajuste os cantos para dentro do contorno dela.`,
      );

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

  private dadosGravacao(dados: DadosLote, cicloDias: number | null) {
    const previsao = estimarColheita(
      dados.data_plantio,
      dados.previsao_colheita,
      cicloDias,
    );
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

  /** O lote nasce com a primeira safra do histórico, em andamento. */
  async criar(user: JwtPayload, dados: DadosLote) {
    if (dados.situacao === 'COLHIDO')
      throw new BadRequestException(
        'Um lote novo começa em preparo ou em cultivo; a colheita é registrada no histórico.',
      );
    const ciclo = await this.validarVinculos(user, dados);
    await this.garantirNomeUnico(dados);
    const gravacao = this.dadosGravacao(dados, ciclo);

    const lote = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.lotes.create({
        data: gravacao,
        select: { id: true },
      });
      await tx.ciclos_cultivo.create({
        data: {
          lote_id: criado.id,
          cultura_id: gravacao.cultura_id,
          data_plantio: gravacao.data_plantio,
          previsao_colheita: gravacao.previsao_colheita,
        },
      });
      return tx.lotes.findUniqueOrThrow({
        where: { id: criado.id },
        select: loteSelect,
      });
    });
    return toDto(lote);
  }

  /**
   * Cultura, datas e situação do lote espelham a safra em andamento: com uma
   * aberta, são atualizadas nas duas; sem ela (lote colhido), ficam como estão
   * até uma nova safra ser iniciada no histórico.
   */
  async alterar(user: JwtPayload, id: number, dados: DadosLote) {
    const atual = await this.buscar(user, id);
    const safraId = atual.ciclos_cultivo[0]?.id;
    if (safraId && dados.situacao === 'COLHIDO')
      throw new BadRequestException(
        'Para encerrar a safra, use "Registrar colheita" no histórico do lote.',
      );
    const efetivos: DadosLote = safraId
      ? dados
      : {
          ...dados,
          cultura_id: atual.culturas.id,
          data_plantio: atual.data_plantio,
          previsao_colheita: atual.previsao_colheita,
          situacao: (atual.situacao ?? 'COLHIDO') as SituacaoLote,
        };

    const ciclo = await this.validarVinculos(user, efetivos);
    await this.garantirNomeUnico(efetivos, id);
    const gravacao = this.dadosGravacao(efetivos, ciclo);

    const lote = await this.prisma.$transaction(async (tx) => {
      if (safraId)
        await tx.ciclos_cultivo.update({
          where: { id: safraId },
          data: {
            cultura_id: gravacao.cultura_id,
            data_plantio: gravacao.data_plantio,
            previsao_colheita: gravacao.previsao_colheita,
          },
        });
      return tx.lotes.update({
        where: { id },
        data: gravacao,
        select: loteSelect,
      });
    });
    return toDto(lote);
  }

  async remover(user: JwtPayload, id: number) {
    const lote = await this.buscar(user, id);
    // a FK apaga os alertas e o histórico do lote em cascata
    if (lote._count.alertas_climaticos > 0)
      throw new ConflictException(
        `O lote tem ${lote._count.alertas_climaticos} alerta(s) registrado(s) e não pode ser excluído.`,
      );
    const encerradas = lote._count.ciclos_cultivo - lote.ciclos_cultivo.length;
    if (encerradas > 0)
      throw new ConflictException(
        `O lote tem ${encerradas} safra(s) no histórico e não pode ser excluído.`,
      );
    await this.prisma.lotes.delete({ where: { id } });
  }

  async detalhe(user: JwtPayload, id: number) {
    return toDto(await this.buscar(user, id));
  }
}
