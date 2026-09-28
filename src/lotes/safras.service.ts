import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { dataIso } from '../common/validacao.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LotesService, estimarColheita } from './lotes.service.js';

export interface Colheita {
  data_colheita: Date;
  producao: number | null;
  unidade_producao: string | null;
  observacoes: string | null;
}

export interface NovaSafra {
  cultura_id: number;
  data_plantio: Date | null;
  previsao_colheita: Date | null;
  situacao: 'EM_PREPARO' | 'EM_CULTIVO';
  observacoes: string | null;
}

/** Correção de uma safra (inclusive já encerrada). */
export interface AlteracaoSafra {
  cultura_id: number;
  data_plantio: Date | null;
  previsao_colheita: Date | null;
  data_colheita: Date | null;
  producao: number | null;
  unidade_producao: string | null;
  observacoes: string | null;
}

const safraSelect = {
  id: true,
  data_plantio: true,
  previsao_colheita: true,
  data_colheita: true,
  producao: true,
  unidade_producao: true,
  observacoes: true,
  culturas: { select: { id: true, nome: true, variedade: true } },
} as const;

type SafraRow = Prisma.ciclos_cultivoGetPayload<{ select: typeof safraSelect }>;

const DIA_MS = 86_400_000;

function toDto(safra: SafraRow, areaHa: number | null) {
  const producao = safra.producao?.toNumber() ?? null;
  const fim = safra.data_colheita ?? new Date();
  return {
    id: safra.id,
    cultura: safra.culturas,
    data_plantio: dataIso(safra.data_plantio),
    previsao_colheita: dataIso(safra.previsao_colheita),
    data_colheita: dataIso(safra.data_colheita),
    em_andamento: safra.data_colheita === null,
    // da data de plantio até a colheita (ou até hoje, se em andamento)
    duracao_dias: safra.data_plantio
      ? Math.max(
          0,
          Math.round((fim.getTime() - safra.data_plantio.getTime()) / DIA_MS),
        )
      : null,
    producao,
    unidade_producao: safra.unidade_producao,
    // pela área atual do lote
    produtividade:
      producao !== null && areaHa
        ? Math.round((producao / areaHa) * 100) / 100
        : null,
    observacoes: safra.observacoes,
  };
}

function validarDatas(
  plantio: Date | null,
  previsao: Date | null,
  colheita: Date | null,
) {
  if (plantio && previsao && previsao < plantio)
    throw new BadRequestException(
      'A previsão de colheita não pode ser antes do plantio.',
    );
  if (plantio && colheita && colheita < plantio)
    throw new BadRequestException('A colheita não pode ser antes do plantio.');
}

/**
 * Histórico de cultivo do lote. Cada safra vai do plantio à colheita; a que
 * está em andamento é espelhada nas colunas do próprio lote (cultura, datas,
 * situação), que as telas e os alertas já usam.
 */
@Injectable()
export class SafrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lotes: LotesService,
  ) {}

  /** Lote no escopo do usuário, com o que o histórico precisa. */
  private async lote(user: JwtPayload, loteId: number) {
    const lote = await this.lotes.buscar(user, loteId);
    return {
      id: lote.id,
      empresaId: lote.propriedades.empresas.id,
      areaHa: lote.area_ha?.toNumber() ?? null,
      safraAtualId: lote.ciclos_cultivo[0]?.id ?? null,
    };
  }

  /** Cultura da plataforma ou da empresa do lote; devolve o ciclo médio. */
  private async validarCultura(empresaId: number, culturaId: number) {
    const cultura = await this.prisma.culturas.findUnique({
      where: { id: culturaId },
      select: { ciclo_medio_dias: true, empresa_id: true },
    });
    if (
      !cultura ||
      (cultura.empresa_id !== null && cultura.empresa_id !== empresaId)
    )
      throw new BadRequestException('Cultura não encontrada.');
    return cultura.ciclo_medio_dias;
  }

  private async safra(loteId: number, safraId: number) {
    const safra = await this.prisma.ciclos_cultivo.findFirst({
      where: { id: safraId, lote_id: loteId },
      select: { ...safraSelect, data_colheita: true },
    });
    if (!safra) throw new NotFoundException('Safra não encontrada.');
    return safra;
  }

  async listar(user: JwtPayload, loteId: number) {
    const lote = await this.lote(user, loteId);
    const safras = await this.prisma.ciclos_cultivo.findMany({
      where: { lote_id: loteId },
      select: safraSelect,
      // em andamento primeiro, depois da mais recente para a mais antiga
      orderBy: [
        { data_colheita: { sort: 'desc', nulls: 'first' } },
        { id: 'desc' },
      ],
    });
    return safras.map((s) => toDto(s, lote.areaHa));
  }

  /** Encerra a safra em andamento; o lote fica como colhido. */
  async colher(user: JwtPayload, loteId: number, dados: Colheita) {
    const lote = await this.lote(user, loteId);
    if (!lote.safraAtualId)
      throw new ConflictException('Não há safra em andamento neste lote.');
    const atual = await this.safra(loteId, lote.safraAtualId);
    validarDatas(atual.data_plantio, null, dados.data_colheita);

    const safra = await this.prisma.$transaction(async (tx) => {
      const encerrada = await tx.ciclos_cultivo.update({
        where: { id: atual.id },
        data: {
          data_colheita: dados.data_colheita,
          producao: dados.producao,
          unidade_producao: dados.unidade_producao,
          observacoes: dados.observacoes ?? atual.observacoes,
        },
        select: safraSelect,
      });
      await tx.lotes.update({
        where: { id: loteId },
        data: { situacao: 'COLHIDO' },
      });
      return encerrada;
    });
    return toDto(safra, lote.areaHa);
  }

  /** Abre a próxima safra (com a mesma cultura ou outra). */
  async iniciar(user: JwtPayload, loteId: number, dados: NovaSafra) {
    const lote = await this.lote(user, loteId);
    if (lote.safraAtualId)
      throw new ConflictException(
        'Já existe uma safra em andamento. Registre a colheita antes de iniciar outra.',
      );
    const ciclo = await this.validarCultura(lote.empresaId, dados.cultura_id);
    validarDatas(dados.data_plantio, dados.previsao_colheita, null);

    const ultima = await this.prisma.ciclos_cultivo.findFirst({
      where: { lote_id: loteId },
      orderBy: { data_colheita: { sort: 'desc', nulls: 'last' } },
      select: { data_colheita: true },
    });
    if (
      dados.data_plantio &&
      ultima?.data_colheita &&
      dados.data_plantio < ultima.data_colheita
    )
      throw new BadRequestException(
        `O plantio não pode ser antes da última colheita (${dataIso(ultima.data_colheita)}).`,
      );

    const previsao = estimarColheita(
      dados.data_plantio,
      dados.previsao_colheita,
      ciclo,
    );
    const safra = await this.prisma.$transaction(async (tx) => {
      const nova = await tx.ciclos_cultivo.create({
        data: {
          lote_id: loteId,
          cultura_id: dados.cultura_id,
          data_plantio: dados.data_plantio,
          previsao_colheita: previsao,
          observacoes: dados.observacoes,
        },
        select: safraSelect,
      });
      // o lote passa a espelhar a nova safra
      await tx.lotes.update({
        where: { id: loteId },
        data: {
          cultura_id: dados.cultura_id,
          data_plantio: dados.data_plantio,
          previsao_colheita: previsao,
          situacao: dados.situacao,
        },
      });
      return nova;
    });
    return toDto(safra, lote.areaHa);
  }

  /** Corrige uma safra; a em andamento não recebe colheita por aqui. */
  async alterar(
    user: JwtPayload,
    loteId: number,
    safraId: number,
    dados: AlteracaoSafra,
  ) {
    const lote = await this.lote(user, loteId);
    const atual = await this.safra(loteId, safraId);
    const emAndamento = atual.data_colheita === null;
    if (emAndamento && (dados.data_colheita || dados.producao !== null))
      throw new BadRequestException(
        'Para encerrar a safra em andamento, use "Registrar colheita".',
      );
    if (!emAndamento && !dados.data_colheita)
      throw new BadRequestException('Informe a data de colheita desta safra.');
    await this.validarCultura(lote.empresaId, dados.cultura_id);
    validarDatas(
      dados.data_plantio,
      dados.previsao_colheita,
      dados.data_colheita,
    );

    const safra = await this.prisma.$transaction(async (tx) => {
      const alterada = await tx.ciclos_cultivo.update({
        where: { id: safraId },
        data: {
          cultura_id: dados.cultura_id,
          data_plantio: dados.data_plantio,
          previsao_colheita: dados.previsao_colheita,
          data_colheita: emAndamento ? null : dados.data_colheita,
          producao: emAndamento ? null : dados.producao,
          unidade_producao: emAndamento ? null : dados.unidade_producao,
          observacoes: dados.observacoes,
        },
        select: safraSelect,
      });
      if (emAndamento)
        await tx.lotes.update({
          where: { id: loteId },
          data: {
            cultura_id: dados.cultura_id,
            data_plantio: dados.data_plantio,
            previsao_colheita: dados.previsao_colheita,
          },
        });
      return alterada;
    });
    return toDto(safra, lote.areaHa);
  }

  /** Remove uma safra encerrada registrada por engano. */
  async remover(user: JwtPayload, loteId: number, safraId: number) {
    await this.lote(user, loteId);
    const safra = await this.safra(loteId, safraId);
    if (safra.data_colheita === null)
      throw new ConflictException(
        'A safra em andamento não pode ser excluída; registre a colheita ou edite o lote.',
      );
    await this.prisma.ciclos_cultivo.delete({ where: { id: safraId } });
  }
}
