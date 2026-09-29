import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { TIPOS_MEDIDA, type TipoMedida } from '../sensores/medidas.js';
import { PainelService } from './painel.service.js';

const DIAS_MAX = 30;

@Controller('painel')
@Roles('administrador', 'produtor', 'analista')
export class PainelController {
  constructor(private readonly painel: PainelService) {}

  /** Resumo da tela inicial (no escopo do usuário). */
  @Get()
  resumo(@CurrentUser() user: JwtPayload) {
    return this.painel.resumo(user);
  }

  /** Série do gráfico: GET /painel/serie?tipo=TEMPERATURA&dias=7 */
  @Get('serie')
  serie(
    @CurrentUser() user: JwtPayload,
    @Query('tipo') tipo: string,
    @Query('dias') dias?: string,
  ) {
    if (!TIPOS_MEDIDA.includes(tipo as TipoMedida))
      throw new BadRequestException(
        `tipo inválido. Use: ${TIPOS_MEDIDA.join(', ')}.`,
      );
    const n = dias === undefined ? 7 : Number(dias);
    if (!Number.isInteger(n) || n < 1 || n > DIAS_MAX)
      throw new BadRequestException(
        `dias deve ser um inteiro entre 1 e ${DIAS_MAX}.`,
      );
    return this.painel.serie(user, tipo as TipoMedida, n);
  }
}
