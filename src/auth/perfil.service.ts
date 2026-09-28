import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ativo } from './auth.service.js';
import type { JwtPayload } from './decorators.js';
import { exigeEmpresa, toRole } from './roles.js';

// alterações feitas direto no banco valem em até esse tempo
const TTL_SEGUNDOS = 60;

const chave = (id: number) => `perfil:${id}`;

/**
 * Perfil atual do usuário (role e empresa), com cache no Redis compartilhado
 * entre as réplicas da API. Alterações feitas pela API invalidam a entrada na
 * hora. Sem Redis, cada requisição consulta o banco.
 */
@Injectable()
export class PerfilService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Perfil do usuário, ou null se ele não pode mais acessar o sistema. */
  async atual(id: number): Promise<JwtPayload | null> {
    const emCache = await this.redis.obter<JwtPayload | null>(chave(id));
    if (emCache !== undefined) return emCache;

    const perfil = await this.carregar(id);
    await this.redis.gravar(chave(id), perfil, TTL_SEGUNDOS);
    return perfil;
  }

  async invalidar(id: number) {
    await this.redis.remover(chave(id));
  }

  private async carregar(id: number): Promise<JwtPayload | null> {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { id },
      select: {
        email: true,
        tipo_usuario: true,
        status: true,
        empresa_id: true,
      },
    });
    const role = toRole(usuario?.tipo_usuario ?? null);
    if (
      !usuario ||
      !role ||
      !ativo(usuario.status) ||
      (exigeEmpresa(role) && usuario.empresa_id === null)
    )
      return null;

    return {
      sub: id,
      email: usuario.email,
      role,
      empresa_id: usuario.empresa_id,
    };
  }
}
