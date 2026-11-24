import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { escopoCulturas } from '../auth/escopo.js';
import { fruta } from '../mercado/fontes.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

// o serviço retreina uma vez por dia; meia hora de cache basta
const TTL_SEGUNDOS = 30 * 60;
const TIMEOUT_MS = 8_000;

const urlMl = () =>
  (process.env.ML_URL ?? 'http://fruitvale-ml:8000').replace(/\/+$/, '');

/**
 * Previsão de preço da fruta (uva e manga) nas próximas 4 a 12 semanas, feita
 * pelo serviço de ML (Python + XGBoost, só na rede interna). Esta API só
 * repassa, com login, escopo da cultura e cache.
 */
@Injectable()
export class PrecoService {
  private readonly logger = new Logger(PrecoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
    let resposta: Response;
    try {
      resposta = await fetch(`${urlMl()}${caminho}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.warn(`Serviço de ML indisponível: ${String(e)}`);
      throw new ServiceUnavailableException(
        'Previsão de preço indisponível no momento.',
      );
    }
    if (!resposta.ok)
      throw new ServiceUnavailableException(
        `Serviço de previsão respondeu ${resposta.status}.`,
      );
    return (await resposta.json()) as T;
  }

  async daCultura(user: JwtPayload, culturaId: number) {
    const cultura = await this.prisma.culturas.findFirst({
      where: { id: culturaId, ...escopoCulturas(user) },
      select: { id: true, nome: true, variedade: true },
    });
    if (!cultura) throw new NotFoundException('Cultura não encontrada.');

    const f = fruta(cultura.nome).toLowerCase();
    const params = new URLSearchParams({ fruta: f });
    if (cultura.variedade) params.set('variedade', cultura.variedade);
    const chave = `ml:previsoes:${params.toString()}`;

    let series = await this.redis.obter<unknown[]>(chave);
    if (!series) {
      series = await this.pedir<unknown[]>(`/previsoes?${params.toString()}`);
      if (series.length) await this.redis.gravar(chave, series, TTL_SEGUNDOS);
    }
    return { cultura, series };
  }

  status() {
    return this.pedir<unknown>('/saude');
  }

  /** Retreina agora (o serviço já retreina sozinho uma vez por dia). */
  treinar() {
    return this.pedir<unknown>('/treinar', {
      method: 'POST',
      headers: { 'X-Token': process.env.ML_TOKEN ?? '' },
    });
  }
}
