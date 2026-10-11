import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { escopoAlertas } from '../auth/escopo.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Periodo } from '../painel/painel.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface FiltroAlertas {
  loteId?: number;
  propriedadeId?: number;
  periodo?: Periodo;
  lido?: boolean;
  limite: number;
}

@Injectable()
export class AlertasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Alertas climáticos no escopo do usuário, do mais recente para o mais
   * antigo, e o total por lote (os lotes que mais geram alertas primeiro).
   */
  async listar(user: JwtPayload, f: FiltroAlertas) {
    const condicoes: Prisma.alertas_climaticosWhereInput[] = [
      escopoAlertas(user),
    ];
    if (f.loteId !== undefined) condicoes.push({ lote_id: f.loteId });
    if (f.propriedadeId !== undefined)
      condicoes.push({ lotes: { propriedade_id: f.propriedadeId } });
    if (f.periodo)
      condicoes.push({
        data_hora: { gte: f.periodo.desde, lte: f.periodo.ate },
      });
    // lido pode ser nulo em alertas antigos: nulo conta como não lido
    if (f.lido !== undefined)
      condicoes.push(
        f.lido ? { lido: true } : { OR: [{ lido: false }, { lido: null }] },
      );
    const where: Prisma.alertas_climaticosWhereInput = { AND: condicoes };

    const [total, alertas, porLote, naoLidos] = await Promise.all([
      this.prisma.alertas_climaticos.count({ where }),
      this.prisma.alertas_climaticos.findMany({
        where,
        orderBy: [{ data_hora: 'desc' }, { id: 'desc' }],
        take: f.limite,
        select: {
          id: true,
          mensagem: true,
          data_hora: true,
          lido: true,
          sensores: { select: { codigo_sensor: true } },
          lotes: {
            select: {
              id: true,
              nome_identificacao: true,
              propriedades: { select: { id: true, nome: true } },
            },
          },
        },
      }),
      this.prisma.alertas_climaticos.groupBy({
        by: ['lote_id'],
        where,
        _count: { _all: true },
      }),
      this.prisma.alertas_climaticos.groupBy({
        by: ['lote_id'],
        where: {
          AND: [...condicoes, { OR: [{ lido: false }, { lido: null }] }],
        },
        _count: { _all: true },
      }),
    ]);

    const lotes = await this.prisma.lotes.findMany({
      where: { id: { in: porLote.map((g) => g.lote_id) } },
      select: {
        id: true,
        nome_identificacao: true,
        propriedades: { select: { id: true, nome: true } },
      },
    });
    const nomes = new Map(lotes.map((l) => [l.id, l]));
    const pendentes = new Map(naoLidos.map((g) => [g.lote_id, g._count._all]));

    return {
      total,
      limite: f.limite,
      alertas: alertas.map((a) => ({
        id: a.id,
        mensagem: a.mensagem,
        data_hora: a.data_hora?.toISOString() ?? null,
        lido: a.lido === true,
        sensor: a.sensores?.codigo_sensor ?? null,
        lote: { id: a.lotes.id, nome: a.lotes.nome_identificacao },
        propriedade: a.lotes.propriedades,
      })),
      por_lote: porLote
        .map((g) => {
          const l = nomes.get(g.lote_id);
          return {
            lote: {
              id: g.lote_id,
              nome: l?.nome_identificacao ?? `#${g.lote_id}`,
            },
            propriedade: l?.propriedades ?? null,
            total: g._count._all,
            nao_lidos: pendentes.get(g.lote_id) ?? 0,
          };
        })
        .sort((a, b) => b.total - a.total || b.nao_lidos - a.nao_lidos),
    };
  }
}
