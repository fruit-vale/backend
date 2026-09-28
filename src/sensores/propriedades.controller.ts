import { Controller, Get } from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { escopoPropriedades } from '../auth/escopo.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Propriedades visíveis ao usuário, para escolher onde fica um sensor. */
@Controller('propriedades')
@Roles('administrador', 'produtor')
export class PropriedadesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listar(@CurrentUser() user: JwtPayload) {
    const propriedades = await this.prisma.propriedades.findMany({
      where: escopoPropriedades(user),
      select: {
        id: true,
        nome: true,
        municipio: true,
        estado: true,
        empresa_id: true,
        latitude: true,
        longitude: true,
      },
      orderBy: { nome: 'asc' },
    });
    // Decimal vira número (o mapa centraliza na propriedade)
    return propriedades.map((p) => ({
      ...p,
      latitude: p.latitude?.toNumber() ?? null,
      longitude: p.longitude?.toNumber() ?? null,
    }));
  }
}
