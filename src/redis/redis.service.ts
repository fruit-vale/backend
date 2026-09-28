import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Cache em Redis que nunca derruba a API: sem REDIS_URL, ou com o Redis fora
 * do ar, leituras devolvem null e escritas são ignoradas (quem chama cai no
 * banco).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client?: Redis;
  private disponivel = false;
  private jaAvisou = false;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL não definido; cache desativado.');
      return;
    }

    this.client = new Redis(url, {
      // falha rápido em vez de enfileirar comandos enquanto está desconectado
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 500,
    });
    this.client.on('ready', () => {
      this.disponivel = true;
      this.logger.log('Conectado ao Redis.');
    });
    this.client.on('error', (erro) => {
      // o ioredis reconecta sozinho; avisa só quando cai (ou na 1ª falha)
      if (this.disponivel || !this.jaAvisou)
        this.logger.warn(`Redis indisponível: ${erro.message}`);
      this.jaAvisou = true;
      this.disponivel = false;
    });
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }

  async obter<T>(chave: string): Promise<T | undefined> {
    if (!this.client || !this.disponivel) return undefined;
    try {
      const valor = await this.client.get(chave);
      return valor === null ? undefined : (JSON.parse(valor) as T);
    } catch {
      return undefined;
    }
  }

  async gravar(chave: string, valor: unknown, ttlSegundos: number) {
    if (!this.client || !this.disponivel) return;
    await this.client
      .set(chave, JSON.stringify(valor), 'EX', ttlSegundos)
      .catch(() => undefined);
  }

  async remover(chave: string) {
    if (!this.client || !this.disponivel) return;
    await this.client.del(chave).catch(() => undefined);
  }
}
