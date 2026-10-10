import { Controller, Get } from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { PrevisaoService } from './previsao.service.js';

@Controller('previsao')
@Roles('administrador', 'produtor', 'analista')
export class PrevisaoController {
  constructor(private readonly previsao: PrevisaoService) {}

  /** Previsão de colheita pela temperatura (graus-dia) dos lotes em cultivo. */
  @Get()
  listar(@CurrentUser() user: JwtPayload) {
    return this.previsao.listar(user);
  }
}
