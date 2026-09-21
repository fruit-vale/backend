import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface ThingspeakFeed {
  created_at: string;
  entry_id: number;
  field1: string | null; // temperatura
  field2: string | null; // umidade
}

interface ThingspeakResponse {
  feeds: ThingspeakFeed[];
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MAX_RESULTS = 8000; // limite da API do ThingSpeak por requisição

@Injectable()
export class ThingspeakService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThingspeakService.name);
  private timer?: NodeJS.Timeout;
  private syncing = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const channelId = process.env.THINGSPEAK_CHANNEL_ID;
    const sensorCodigo = process.env.THINGSPEAK_SENSOR_CODIGO;
    if (!channelId || !sensorCodigo) {
      this.logger.warn(
        'THINGSPEAK_CHANNEL_ID / THINGSPEAK_SENSOR_CODIGO não definidos; sincronização desativada.',
      );
      return;
    }

    const interval =
      Number(process.env.THINGSPEAK_POLL_INTERVAL_MS) ||
      DEFAULT_POLL_INTERVAL_MS;
    void this.sync(channelId, sensorCodigo);
    this.timer = setInterval(
      () => void this.sync(channelId, sensorCodigo),
      interval,
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async ultimasLeituras(limit: number) {
    const sensorCodigo = process.env.THINGSPEAK_SENSOR_CODIGO;
    const sensor = sensorCodigo
      ? await this.prisma.sensores.findUnique({
          where: { codigo_sensor: sensorCodigo },
          select: { id: true, codigo_sensor: true },
        })
      : null;
    if (!sensor) return null;

    const leituras = await this.prisma.leituras_sensores.findMany({
      where: { sensor_id: sensor.id },
      orderBy: { data_hora: 'desc' },
      take: limit,
      select: { data_hora: true, temperatura: true, umidade: true },
    });

    return {
      sensor: sensor.codigo_sensor,
      leituras: leituras.reverse().map((l) => ({
        data_hora: l.data_hora.toISOString(),
        temperatura: l.temperatura === null ? null : Number(l.temperatura),
        umidade: l.umidade === null ? null : Number(l.umidade),
      })),
    };
  }

  private async sync(channelId: string, sensorCodigo: string) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const sensor = await this.prisma.sensores.findUnique({
        where: { codigo_sensor: sensorCodigo },
        select: { id: true },
      });
      if (!sensor) {
        this.logger.error(
          `Sensor "${sensorCodigo}" não existe na tabela sensores; cadastre-o antes de sincronizar.`,
        );
        return;
      }

      const last = await this.prisma.leituras_sensores.findFirst({
        where: { sensor_id: sensor.id },
        orderBy: { data_hora: 'desc' },
        select: { data_hora: true },
      });

      const feeds = await this.fetchFeeds(channelId, last?.data_hora);
      const novos = feeds
        .filter((f) => !last || new Date(f.created_at) > last.data_hora)
        .map((f) => ({
          sensor_id: sensor.id,
          data_hora: new Date(f.created_at),
          temperatura: toNumber(f.field1),
          umidade: toNumber(f.field2),
        }))
        .filter((l) => l.temperatura !== null || l.umidade !== null);

      if (novos.length === 0) return;
      await this.prisma.leituras_sensores.createMany({ data: novos });
      this.logger.log(`${novos.length} leitura(s) salva(s) no Supabase.`);
    } catch (err) {
      this.logger.error(
        `Falha ao sincronizar com o ThingSpeak: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.syncing = false;
    }
  }

  private async fetchFeeds(channelId: string, since?: Date) {
    const url = new URL(
      `https://api.thingspeak.com/channels/${channelId}/feeds.json`,
    );
    url.searchParams.set('results', String(MAX_RESULTS));
    const apiKey = process.env.THINGSPEAK_READ_API_KEY;
    if (apiKey) url.searchParams.set('api_key', apiKey);
    if (since) {
      // formato esperado pelo ThingSpeak: YYYY-MM-DD HH:NN:SS (UTC)
      url.searchParams.set(
        'start',
        since.toISOString().slice(0, 19).replace('T', ' '),
      );
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`ThingSpeak respondeu HTTP ${res.status}`);
    const body = (await res.json()) as ThingspeakResponse;
    return body.feeds ?? [];
  }
}

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
