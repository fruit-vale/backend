import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { TIPOS_MEDIDA, type TipoMedida } from '../sensores/medidas.js';
import { PainelService, type FiltroPainel } from './painel.service.js';

const DIAS_MAX = 30;

/** Tipo de dado e período (1 a 30 dias, padrão 7) dos filtros do painel. */
function lerFiltro(tipo: string, dias?: string): [TipoMedida, number] {
  if (!TIPOS_MEDIDA.includes(tipo as TipoMedida))
    throw new BadRequestException(
      `tipo inválido. Use: ${TIPOS_MEDIDA.join(', ')}.`,
    );
  const n = dias === undefined ? 7 : Number(dias);
  if (!Number.isInteger(n) || n < 1 || n > DIAS_MAX)
    throw new BadRequestException(
      `dias deve ser um inteiro entre 1 e ${DIAS_MAX}.`,
    );
  return [tipo as TipoMedida, n];
}

/** Filtro opcional por propriedade e/ou lote (inteiros positivos). */
function lerEscopo(propriedadeId?: string, loteId?: string): FiltroPainel {
  const inteiro = (valor: string | undefined, nome: string) => {
    if (valor === undefined || valor === '') return undefined;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1)
      throw new BadRequestException(`${nome} deve ser um inteiro positivo.`);
    return n;
  };
  return {
    propriedadeId: inteiro(propriedadeId, 'propriedade_id'),
    loteId: inteiro(loteId, 'lote_id'),
  };
}

@Controller('painel')
@Roles('administrador', 'produtor', 'analista')
export class PainelController {
  constructor(private readonly painel: PainelService) {}

  /** Resumo da tela inicial (no escopo do usuário). */
  @Get()
  resumo(@CurrentUser() user: JwtPayload) {
    return this.painel.resumo(user);
  }

  /** Leituras individuais: GET /painel/leituras?tipo=TEMPERATURA&dias=7[&propriedade_id=1&lote_id=2] */
  @Get('leituras')
  leituras(
    @CurrentUser() user: JwtPayload,
    @Query('tipo') tipo: string,
    @Query('dias') dias?: string,
    @Query('propriedade_id') propriedadeId?: string,
    @Query('lote_id') loteId?: string,
  ) {
    const [t, n] = lerFiltro(tipo, dias);
    return this.painel.leituras(user, t, n, lerEscopo(propriedadeId, loteId));
  }

  /** Série do gráfico: GET /painel/serie?tipo=TEMPERATURA&dias=7[&propriedade_id=1&lote_id=2] */
  @Get('serie')
  serie(
    @CurrentUser() user: JwtPayload,
    @Query('tipo') tipo: string,
    @Query('dias') dias?: string,
    @Query('propriedade_id') propriedadeId?: string,
    @Query('lote_id') loteId?: string,
  ) {
    const [t, n] = lerFiltro(tipo, dias);
    return this.painel.serie(user, t, n, lerEscopo(propriedadeId, loteId));
  }
}
