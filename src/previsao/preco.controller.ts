import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { PrecoService } from './preco.service.js';

@Controller('previsao/preco')
@Roles('administrador', 'produtor', 'analista')
export class PrecoController {
  constructor(private readonly preco: PrecoService) {}

  /**
   * GET /previsao/preco?cultura_id=1
   * Séries de preço da fruta da cultura (a da variedade, se houver, e as gerais
   * das Ceasas), cada uma com a previsão de 4 a 12 semanas e a tendência.
   */
  @Get()
  daCultura(
    @CurrentUser() user: JwtPayload,
    @Query('cultura_id') culturaId?: string,
  ) {
    const n = Number(culturaId);
    if (!culturaId || !Number.isInteger(n) || n < 1)
      throw new BadRequestException('Informe a cultura (cultura_id).');
    return this.preco.daCultura(user, n);
  }

  /** Quando foi o último treino e quais séries existem. */
  @Get('status')
  @Roles('administrador')
  status() {
    return this.preco.status();
  }

  /** Retreina o modelo agora. */
  @Post('treinar')
  @Roles('administrador')
  @HttpCode(202)
  treinar() {
    return this.preco.treinar();
  }
}
