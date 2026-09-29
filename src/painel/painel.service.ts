import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import {
  escopoLotes,
  escopoPropriedades,
  escopoSensores,
} from '../auth/escopo.js';
import { dataIso } from '../common/validacao.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { TipoMedida } from '../sensores/medidas.js';

/**
 * normal: leituras dentro da faixa ideal da cultura; atencao: alguma fora;
 * sem_dados: nenhum sensor com leitura recente; sem_faixa: a cultura não tem
 * faixa ideal cadastrada para comparar.
 */
export type StatusCultivo = 'normal' | 'atencao' | 'sem_dados' | 'sem_faixa';

// ordem de gravidade para resumir vários lotes de uma cultura
const GRAVIDADE: Record<StatusCultivo, number> = {
  atencao: 3,
  sem_dados: 2,
  sem_faixa: 1,
  normal: 0,
};

// leitura mais antiga que isso não conta como "situação atual"
const LEITURA_RECENTE_H = 6;
const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
// mais que isso deixa o gráfico ilegível
const SERIES_MAX = 8;

const num = (valor: { toNumber(): number } | null) => valor?.toNumber() ?? null;
const fmt = (valor: number) =>
  valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

type Faixa = { min: number | null; max: number | null };

/** Motivo de atenção, ou null se o valor está dentro da faixa. */
function foraDaFaixa(
  nome: string,
  valor: number,
  unidade: string,
  faixa: Faixa,
) {
  if (faixa.min !== null && valor < faixa.min)
    return `${nome} ${fmt(valor)}${unidade} abaixo do ideal (${fmt(faixa.min)}${unidade})`;
  if (faixa.max !== null && valor > faixa.max)
    return `${nome} ${fmt(valor)}${unidade} acima do ideal (${fmt(faixa.max)}${unidade})`;
  return null;
}

/** Visão geral da plataforma para a tela inicial, no escopo do usuário. */
@Injectable()
export class PainelService {
  constructor(private readonly prisma: PrismaService) {}

  async resumo(user: JwtPayload) {
    const agora = Date.now();
    const desde24h = new Date(agora - DIA_MS);
    const desdeRecente = new Date(agora - LEITURA_RECENTE_H * HORA_MS);
    const emCultivo: Prisma.lotesWhereInput = {
      ...escopoLotes(user),
      situacao: { in: ['EM_PREPARO', 'EM_CULTIVO'] },
    };

    const [propriedades, sensores, leituras24h, lotes, alertas, tipos] =
      await Promise.all([
        this.prisma.propriedades.count({
          where: { ...escopoPropriedades(user), status: 'ATIVA' },
        }),
        this.prisma.sensores.groupBy({
          by: ['status'],
          where: escopoSensores(user),
          _count: true,
        }),
        this.prisma.leituras_sensores.count({
          where: {
            sensores: escopoSensores(user),
            data_hora: { gte: desde24h },
          },
        }),
        this.prisma.lotes.findMany({
          where: emCultivo,
          select: {
            id: true,
            nome_identificacao: true,
            area_ha: true,
            situacao: true,
            previsao_colheita: true,
            propriedades: { select: { nome: true } },
            culturas: {
              select: {
                id: true,
                nome: true,
                variedade: true,
                temp_recomendada_min: true,
                temp_recomendada_max: true,
                umidade_recomendada_min: true,
                umidade_recomendada_max: true,
              },
            },
            // última leitura recente de qualquer sensor do lote
            sensores: {
              select: {
                leituras_sensores: {
                  where: { data_hora: { gte: desdeRecente } },
                  orderBy: { data_hora: 'desc' },
                  take: 1,
                  select: { data_hora: true, temperatura: true, umidade: true },
                },
              },
            },
          },
        }),
        this.prisma.alertas_climaticos.findMany({
          where: { lotes: escopoLotes(user), lido: false },
          orderBy: { data_hora: 'desc' },
          take: 3,
          select: {
            id: true,
            mensagem: true,
            data_hora: true,
            lotes: { select: { nome_identificacao: true } },
          },
        }),
        this.prisma.sensor_medidas.findMany({
          where: { sensores: escopoSensores(user) },
          distinct: ['tipo'],
          select: { tipo: true, unidade: true },
        }),
      ]);
    const totalAlertas = alertas.length
      ? await this.prisma.alertas_climaticos.count({
          where: { lotes: escopoLotes(user), lido: false },
        })
      : 0;

    // status de cada lote em cultivo, pela leitura mais recente dos sensores
    const porLote = lotes.map((lote) => {
      const c = lote.culturas;
      const temp: Faixa = {
        min: num(c.temp_recomendada_min),
        max: num(c.temp_recomendada_max),
      };
      const umid: Faixa = {
        min: num(c.umidade_recomendada_min),
        max: num(c.umidade_recomendada_max),
      };
      const semFaixa = [temp.min, temp.max, umid.min, umid.max].every(
        (v) => v === null,
      );

      const ultima = lote.sensores
        .flatMap((s) => s.leituras_sensores)
        .sort((a, b) => b.data_hora.getTime() - a.data_hora.getTime())[0];

      let status: StatusCultivo = 'normal';
      let motivo: string | null = null;
      if (!ultima) status = 'sem_dados';
      else if (semFaixa) status = 'sem_faixa';
      else {
        const t = num(ultima.temperatura);
        const u = num(ultima.umidade);
        motivo =
          (t !== null && foraDaFaixa('Temperatura', t, ' °C', temp)) ||
          (u !== null && foraDaFaixa('Umidade', u, '%', umid)) ||
          null;
        if (motivo) status = 'atencao';
        else if (t === null && u === null) status = 'sem_dados';
      }
      return { lote, status, motivo };
    });

    // agrupa por cultura, com o pior status entre os lotes
    const culturas = new Map<
      number,
      {
        cultura: { id: number; nome: string; variedade: string | null };
        lotes: number;
        area_ha: number;
        status: StatusCultivo;
        motivo: string | null;
      }
    >();
    for (const { lote, status, motivo } of porLote) {
      const c = lote.culturas;
      const atual = culturas.get(c.id) ?? {
        cultura: { id: c.id, nome: c.nome, variedade: c.variedade },
        lotes: 0,
        area_ha: 0,
        status: 'normal' as StatusCultivo,
        motivo: null,
      };
      atual.lotes++;
      atual.area_ha += num(lote.area_ha) ?? 0;
      if (GRAVIDADE[status] > GRAVIDADE[atual.status]) {
        atual.status = status;
        atual.motivo = motivo && `${motivo} — ${lote.nome_identificacao}`;
      }
      culturas.set(c.id, atual);
    }

    // próxima colheita prevista (as atrasadas vêm primeiro)
    const proxima = lotes
      .filter((l) => l.previsao_colheita)
      .sort(
        (a, b) =>
          a.previsao_colheita!.getTime() - b.previsao_colheita!.getTime(),
      )[0];
    const hoje = new Date(new Date().toISOString().slice(0, 10));

    const porStatus = Object.fromEntries(
      sensores.map((s) => [s.status ?? 'ATIVO', s._count]),
    );
    return {
      resumo: {
        propriedades,
        lotes_em_cultivo: lotes.length,
        area_em_cultivo_ha:
          Math.round(
            lotes.reduce((s, l) => s + (num(l.area_ha) ?? 0), 0) * 100,
          ) / 100,
        sensores_total: sensores.reduce((s, g) => s + g._count, 0),
        sensores_ativos: porStatus.ATIVO ?? 0,
        leituras_24h: leituras24h,
      },
      culturas: [...culturas.values()]
        .map((c) => ({ ...c, area_ha: Math.round(c.area_ha * 100) / 100 }))
        .sort(
          (a, b) =>
            GRAVIDADE[b.status] - GRAVIDADE[a.status] || b.lotes - a.lotes,
        ),
      proxima_colheita: proxima
        ? {
            lote: { id: proxima.id, nome: proxima.nome_identificacao },
            propriedade: proxima.propriedades.nome,
            cultura: {
              nome: proxima.culturas.nome,
              variedade: proxima.culturas.variedade,
            },
            previsao: dataIso(proxima.previsao_colheita),
            // negativo = atrasada
            dias: Math.round(
              (proxima.previsao_colheita!.getTime() - hoje.getTime()) / DIA_MS,
            ),
          }
        : null,
      alertas: {
        nao_lidos: totalAlertas,
        recentes: alertas.map((a) => ({
          id: a.id,
          mensagem: a.mensagem,
          data_hora: a.data_hora?.toISOString() ?? null,
          lote: a.lotes.nome_identificacao,
        })),
      },
      tipos: tipos.map((t) => ({
        tipo: t.tipo as TipoMedida,
        unidade: t.unidade,
      })),
    };
  }

  /**
   * Média por hora (até 7 dias) ou por dia (mais que isso) de um tipo de
   * dado, uma série por sensor.
   */
  async serie(user: JwtPayload, tipo: TipoMedida, dias: number) {
    const sensores = await this.prisma.sensores.findMany({
      where: { ...escopoSensores(user), medidas: { some: { tipo } } },
      select: { id: true },
    });
    if (!sensores.length) return { tipo, unidade: null, series: [] };

    const intervalo = dias <= 7 ? 'hour' : 'day';
    const desde = new Date(Date.now() - dias * DIA_MS);
    const linhas = await this.prisma.$queryRaw<
      {
        sensor_id: number;
        codigo: string;
        lote: string | null;
        unidade: string | null;
        instante: Date;
        valor: number;
      }[]
    >`
      SELECT s.id AS sensor_id, s.codigo_sensor AS codigo,
             l.nome_identificacao AS lote, m.unidade,
             date_trunc(${intervalo}, ls.data_hora) AS instante,
             avg(v.valor)::float8 AS valor
      FROM leituras_valores v
      JOIN leituras_sensores ls ON ls.id = v.leitura_id
      JOIN sensor_medidas m ON m.id = v.medida_id
      JOIN sensores s ON s.id = m.sensor_id
      LEFT JOIN lotes l ON l.id = s.lote_id
      WHERE m.tipo = ${tipo}
        AND ls.data_hora >= ${desde}
        AND s.id IN (${Prisma.join(sensores.map((s) => s.id))})
      GROUP BY s.id, s.codigo_sensor, l.nome_identificacao, m.unidade, instante
      ORDER BY instante`;

    const series = new Map<
      number,
      {
        sensor: string;
        lote: string | null;
        pontos: { instante: string; valor: number }[];
      }
    >();
    for (const l of linhas) {
      const serie = series.get(l.sensor_id) ?? {
        sensor: l.codigo,
        lote: l.lote,
        pontos: [],
      };
      serie.pontos.push({
        instante: l.instante.toISOString(),
        valor: Math.round(l.valor * 100) / 100,
      });
      series.set(l.sensor_id, serie);
    }
    return {
      tipo,
      intervalo,
      unidade: linhas[0]?.unidade ?? null,
      // os sensores com mais pontos primeiro
      series: [...series.values()]
        .sort((a, b) => b.pontos.length - a.pontos.length)
        .slice(0, SERIES_MAX),
    };
  }
}
