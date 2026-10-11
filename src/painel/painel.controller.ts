import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { TIPOS_MEDIDA, type TipoMedida } from '../sensores/medidas.js';
import {
  PainelService,
  type FiltroPainel,
  type Periodo,
} from './painel.service.js';

const DIAS_MAX = 30;
// datas escolhidas: até pouco mais de um ano (uma safra longa e a anterior)
const PERIODO_MAX_DIAS = 400;
const DIA_MS = 86_400_000;
// as datas do filtro são do local; as leituras estão em UTC
const FUSO = '-03:00';
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function lerTipo(tipo: string): TipoMedida {
  if (!TIPOS_MEDIDA.includes(tipo as TipoMedida))
    throw new BadRequestException(
      `tipo inválido. Use: ${TIPOS_MEDIDA.join(', ')}.`,
    );
  return tipo as TipoMedida;
}

/**
 * Período: `desde` e `ate` ("AAAA-MM-DD", dias inteiros no fuso local) ou os
 * últimos `dias` (1 a 30, padrão 7).
 */
export function lerPeriodo(
  dias?: string,
  desde?: string,
  ate?: string,
  agora = new Date(),
): Periodo {
  if (desde !== undefined || ate !== undefined) {
    if (!desde || !DATA.test(desde))
      throw new BadRequestException('desde deve ser uma data AAAA-MM-DD.');
    if (ate !== undefined && ate !== '' && !DATA.test(ate))
      throw new BadRequestException('ate deve ser uma data AAAA-MM-DD.');
    const inicio = new Date(`${desde}T00:00:00${FUSO}`);
    const fim = ate ? new Date(`${ate}T23:59:59.999${FUSO}`) : agora;
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()))
      throw new BadRequestException('Data inválida.');
    if (fim < inicio)
      throw new BadRequestException('ate não pode ser antes de desde.');
    if (fim.getTime() - inicio.getTime() > PERIODO_MAX_DIAS * DIA_MS)
      throw new BadRequestException(
        `O período pode ter no máximo ${PERIODO_MAX_DIAS} dias.`,
      );
    return { desde: inicio, ate: fim };
  }
  const n = dias === undefined ? 7 : Number(dias);
  if (!Number.isInteger(n) || n < 1 || n > DIAS_MAX)
    throw new BadRequestException(
      `dias deve ser um inteiro entre 1 e ${DIAS_MAX}.`,
    );
  return { desde: new Date(agora.getTime() - n * DIA_MS), ate: agora };
}

/** Filtro opcional por propriedade, lote e/ou sensor (inteiros positivos). */
function lerEscopo(
  propriedadeId?: string,
  loteId?: string,
  sensorId?: string,
): FiltroPainel {
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
    sensorId: inteiro(sensorId, 'sensor_id'),
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

  /**
   * Leituras individuais:
   * GET /painel/leituras?tipo=TEMPERATURA&dias=7 (ou &desde=2026-01-01&ate=2026-03-31)
   * [&propriedade_id=1&lote_id=2&sensor_id=3]
   */
  @Get('leituras')
  leituras(
    @CurrentUser() user: JwtPayload,
    @Query('tipo') tipo: string,
    @Query('dias') dias?: string,
    @Query('desde') desde?: string,
    @Query('ate') ate?: string,
    @Query('propriedade_id') propriedadeId?: string,
    @Query('lote_id') loteId?: string,
    @Query('sensor_id') sensorId?: string,
  ) {
    return this.painel.leituras(
      user,
      lerTipo(tipo),
      lerPeriodo(dias, desde, ate),
      lerEscopo(propriedadeId, loteId, sensorId),
    );
  }

  /** Série do gráfico: mesmos filtros de /painel/leituras. */
  @Get('serie')
  serie(
    @CurrentUser() user: JwtPayload,
    @Query('tipo') tipo: string,
    @Query('dias') dias?: string,
    @Query('desde') desde?: string,
    @Query('ate') ate?: string,
    @Query('propriedade_id') propriedadeId?: string,
    @Query('lote_id') loteId?: string,
    @Query('sensor_id') sensorId?: string,
  ) {
    return this.painel.serie(
      user,
      lerTipo(tipo),
      lerPeriodo(dias, desde, ate),
      lerEscopo(propriedadeId, loteId, sensorId),
    );
  }
}
