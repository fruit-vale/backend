import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { escopoLotes } from '../auth/escopo.js';
import { dataIso } from '../common/validacao.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { projetarGrausDia, type PrevisaoGrausDia } from './graus-dia.js';

// as leituras são gravadas em UTC; o "dia" da planta é o do local
const FUSO = 'America/Sao_Paulo';

/** Por que um lote não tem previsão por temperatura. */
export type MotivoSemGrausDia =
  | 'sem_parametros' // a cultura não tem temperatura base e graus-dia do ciclo
  | 'sem_plantio' // o lote não tem data de plantio
  | 'sem_leituras'; // nenhum sensor do lote mediu temperatura no ciclo

export interface PrevisaoLote {
  lote_id: number;
  graus_dia: PrevisaoGrausDia | null;
  motivo: MotivoSemGrausDia | null;
}

/** "Hoje" no fuso local, como "AAAA-MM-DD". */
const hojeLocal = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());

@Injectable()
export class PrevisaoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Previsão por graus-dia dos lotes em cultivo, no escopo do usuário. */
  async listar(user: JwtPayload): Promise<PrevisaoLote[]> {
    const lotes = await this.prisma.lotes.findMany({
      where: { ...escopoLotes(user), situacao: 'EM_CULTIVO' },
      select: {
        id: true,
        data_plantio: true,
        culturas: {
          select: { temp_base_graus_dia: true, graus_dia_ciclo: true },
        },
      },
    });

    const calculaveis = lotes.filter(
      (l) =>
        l.data_plantio &&
        l.culturas.temp_base_graus_dia !== null &&
        l.culturas.graus_dia_ciclo !== null,
    );
    const temperaturas = await this.temperaturasDiarias(
      calculaveis.map((l) => l.id),
      calculaveis.reduce<Date | null>(
        (min, l) => (!min || l.data_plantio! < min ? l.data_plantio : min),
        null,
      ),
    );

    const hoje = hojeLocal();
    return lotes.map((lote): PrevisaoLote => {
      const { temp_base_graus_dia: base, graus_dia_ciclo: necessario } =
        lote.culturas;
      if (base === null || necessario === null)
        return { lote_id: lote.id, graus_dia: null, motivo: 'sem_parametros' };
      if (!lote.data_plantio)
        return { lote_id: lote.id, graus_dia: null, motivo: 'sem_plantio' };
      const graus = projetarGrausDia({
        plantio: dataIso(lote.data_plantio)!,
        hoje,
        base: base.toNumber(),
        necessario,
        dias: temperaturas.get(lote.id) ?? [],
      });
      return {
        lote_id: lote.id,
        graus_dia: graus,
        motivo: graus ? null : 'sem_leituras',
      };
    });
  }

  /** Mínima e máxima de cada dia (fuso local), por lote, desde a data dada. */
  private async temperaturasDiarias(loteIds: number[], desde: Date | null) {
    const porLote = new Map<
      number,
      { dia: string; min: number; max: number }[]
    >();
    if (!loteIds.length || !desde) return porLote;

    const linhas = await this.prisma.$queryRaw<
      { lote_id: number; dia: string; min: number; max: number }[]
    >`
      SELECT s.lote_id,
             to_char((ls.data_hora AT TIME ZONE 'UTC') AT TIME ZONE ${FUSO}, 'YYYY-MM-DD') AS dia,
             min(v.valor)::float8 AS min,
             max(v.valor)::float8 AS max
      FROM leituras_valores v
      JOIN leituras_sensores ls ON ls.id = v.leitura_id
      JOIN sensor_medidas m ON m.id = v.medida_id
      JOIN sensores s ON s.id = m.sensor_id
      WHERE m.tipo = 'TEMPERATURA'
        AND s.lote_id IN (${Prisma.join(loteIds)})
        -- um dia de folga: o plantio é data local, a leitura está em UTC
        AND ls.data_hora >= ${new Date(desde.getTime() - 86_400_000)}
      GROUP BY s.lote_id, dia`;

    for (const { lote_id, ...dia } of linhas) {
      const lista = porLote.get(lote_id) ?? [];
      lista.push(dia);
      porLote.set(lote_id, lista);
    }
    return porLote;
  }
}
