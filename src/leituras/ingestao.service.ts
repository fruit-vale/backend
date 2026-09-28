import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DynsecService } from '../mqtt/dynsec.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { FILTRO_LEITURAS, lerLeitura, lerTopico } from './leituras-mqtt.js';

const TTL_SENSOR_SEGUNDOS = 60;

/** Dados do sensor usados a cada mensagem; null = código não cadastrado. */
type SensorIngestao = { id: number; empresa_id: number; status: string } | null;

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
      },
    });
    const sensor = encontrado && {
      id: encontrado.id,
      empresa_id: encontrado.propriedades.empresa_id,
      status: encontrado.status ?? 'ATIVO',
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

    const leitura = lerLeitura(payload);
    if (typeof leitura === 'string') {
      this.logger.warn(`Leitura descartada de ${destino.codigo}: ${leitura}.`);
      return;
    }

    await this.prisma.leituras_sensores.create({
      data: { sensor_id: sensor.id, ...leitura },
    });
  }
}
