import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DynsecService } from '../mqtt/dynsec.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { TipoMedida } from '../sensores/medidas.js';
import {
  alertasDaLeitura,
  JANELA_ALERTA_MS,
  type FaixaCultura,
} from './alertas-faixa.js';
import {
  FILTRO_LEITURAS,
  lerLeitura,
  lerTopico,
  type MedidaIngestao,
} from './leituras-mqtt.js';

const TTL_SENSOR_SEGUNDOS = 60;

/** Dados do sensor usados a cada mensagem; null = código não cadastrado. */
type SensorIngestao = {
  id: number;
  empresa_id: number;
  status: string;
  medidas: MedidaIngestao[];
  /** lote atual e a faixa ideal da cultura dele (para os alertas) */
  lote_id: number | null;
  faixa: FaixaCultura | null;
} | null;

const num = (valor: { toNumber(): number } | null) => valor?.toNumber() ?? null;

export const chaveSensor = (codigo: string) => `sensor:${codigo}`;

/**
 * Assina as leituras publicadas pelos sensores no broker e grava cada uma em
 * leituras_sensores. Mensagens inválidas ou de sensores desconhecidos são
 * descartadas com um aviso no log.
 */
@Injectable()
export class IngestaoService implements OnModuleInit {
  private readonly logger = new Logger(IngestaoService.name);

  constructor(
    private readonly dynsec: DynsecService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.dynsec.inscrever(FILTRO_LEITURAS, (topico, payload) => {
      this.gravar(topico, payload).catch((erro: Error) =>
        this.logger.error(
          `Falha ao gravar leitura de ${topico}: ${erro.message}`,
        ),
      );
    });
  }

  /** Busca o sensor pelo código, com cache (Redis) para não ir ao banco a cada mensagem. */
  private async sensor(codigo: string): Promise<SensorIngestao> {
    const emCache = await this.redis.obter<SensorIngestao>(chaveSensor(codigo));
    if (emCache !== undefined) return emCache;

    const encontrado = await this.prisma.sensores.findUnique({
      where: { codigo_sensor: codigo },
      select: {
        id: true,
        status: true,
        propriedades: { select: { empresa_id: true } },
        medidas: { select: { id: true, chave: true, tipo: true } },
        lotes: {
          select: {
            id: true,
            culturas: {
              select: {
                temp_recomendada_min: true,
                temp_recomendada_max: true,
                umidade_recomendada_min: true,
                umidade_recomendada_max: true,
              },
            },
          },
        },
      },
    });
    const cultura = encontrado?.lotes?.culturas;
    const sensor = encontrado && {
      id: encontrado.id,
      empresa_id: encontrado.propriedades.empresa_id,
      status: encontrado.status ?? 'ATIVO',
      medidas: encontrado.medidas.map((m) => ({
        ...m,
        tipo: m.tipo as TipoMedida,
      })),
      lote_id: encontrado.lotes?.id ?? null,
      faixa: cultura
        ? {
            temp_min: num(cultura.temp_recomendada_min),
            temp_max: num(cultura.temp_recomendada_max),
            umid_min: num(cultura.umidade_recomendada_min),
            umid_max: num(cultura.umidade_recomendada_max),
          }
        : null,
    };
    await this.redis.gravar(chaveSensor(codigo), sensor, TTL_SENSOR_SEGUNDOS);
    return sensor;
  }

  private async gravar(topico: string, payload: Buffer) {
    const destino = lerTopico(topico);
    if (!destino) return;

    const sensor = await this.sensor(destino.codigo);
    // o tópico precisa bater com a empresa do sensor: evita gravar leituras
    // de um sensor em nome de outra empresa
    if (!sensor || sensor.empresa_id !== destino.empresaId) {
      this.logger.warn(`Leitura descartada: sensor desconhecido em ${topico}.`);
      return;
    }
    if (sensor.status === 'INATIVO') return;

    const leitura = lerLeitura(payload, sensor.medidas);
    if (typeof leitura === 'string') {
      this.logger.warn(`Leitura descartada de ${destino.codigo}: ${leitura}.`);
      return;
    }
    if (leitura.ignoradas.length)
      this.logger.warn(
        `Leitura de ${destino.codigo}: chaves não cadastradas ignoradas (${leitura.ignoradas.join(', ')}).`,
      );

    // uma linha por mensagem, com um valor por dado configurado
    await this.prisma.leituras_sensores.create({
      data: {
        sensor_id: sensor.id,
        data_hora: leitura.data_hora,
        ...leitura.fixas,
        valores: { create: leitura.valores },
      },
    });

    if (sensor.lote_id !== null && sensor.faixa)
      await this.alertar(
        sensor.id,
        sensor.lote_id,
        destino.codigo,
        alertasDaLeitura(leitura.fixas, sensor.faixa, destino.codigo),
        leitura.data_hora,
      );
  }

  /** Grava os alertas da leitura, sem repetir o mesmo dado do sensor na janela. */
  private async alertar(
    sensorId: number,
    loteId: number,
    codigo: string,
    alertas: ReturnType<typeof alertasDaLeitura>,
    dataHora: Date,
  ) {
    for (const alerta of alertas) {
      const recente = await this.prisma.alertas_climaticos.findFirst({
        where: {
          lote_id: loteId,
          sensor_id: sensorId,
          mensagem: { startsWith: alerta.prefixo },
          data_hora: { gte: new Date(dataHora.getTime() - JANELA_ALERTA_MS) },
        },
        select: { id: true },
      });
      if (recente) continue;
      await this.prisma.alertas_climaticos.create({
        data: {
          lote_id: loteId,
          sensor_id: sensorId,
          mensagem: alerta.mensagem,
          data_hora: dataHora,
        },
      });
      this.logger.log(`Alerta em ${codigo}: ${alerta.mensagem}`);
    }
  }
}
