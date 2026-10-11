import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { lerPeriodo } from '../painel/painel.controller.js';
import { AlertasService } from './alertas.service.js';

const LIMITE_PADRAO = 200;
const LIMITE_MAX = 1000;

function inteiro(valor: string | undefined, nome: string) {
  if (valor === undefined || valor === '') return undefined;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1)
    throw new BadRequestException(`${nome} deve ser um inteiro positivo.`);
  return n;
}

@Controller('alertas')
@Roles('administrador', 'produtor', 'analista')
export class AlertasController {
  constructor(private readonly alertas: AlertasService) {}

  /**
   * GET /alertas[?lote_id=&propriedade_id=&desde=AAAA-MM-DD&ate=AAAA-MM-DD&lido=true|false&limite=200]
   * Sem desde/ate: todo o histórico.
   */
  @Get()
  listar(
    @CurrentUser() user: JwtPayload,
    @Query('lote_id') loteId?: string,
    @Query('propriedade_id') propriedadeId?: string,
    @Query('desde') desde?: string,
    @Query('ate') ate?: string,
    @Query('lido') lido?: string,
    @Query('limite') limite?: string,
  ) {
    if (
      lido !== undefined &&
      lido !== '' &&
      lido !== 'true' &&
      lido !== 'false'
    )
      throw new BadRequestException('lido deve ser true ou false.');
    const n = inteiro(limite, 'limite') ?? LIMITE_PADRAO;
    return this.alertas.listar(user, {
      loteId: inteiro(loteId, 'lote_id'),
      propriedadeId: inteiro(propriedadeId, 'propriedade_id'),
      periodo: desde || ate ? lerPeriodo(undefined, desde, ate) : undefined,
      lido: lido === 'true' ? true : lido === 'false' ? false : undefined,
      limite: Math.min(n, LIMITE_MAX),
    });
  }
}
