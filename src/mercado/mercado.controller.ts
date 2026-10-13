import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import {
  FONTES,
  MercadoImportacaoService,
  type Fonte,
} from './mercado-importacao.service.js';
import { MercadoService } from './mercado.service.js';

const MESES_MAX = 36;

function lerCultura(valor?: string) {
  const n = Number(valor);
  if (!valor || !Number.isInteger(n) || n < 1)
    throw new BadRequestException('Informe a cultura (cultura_id).');
  return n;
}

function lerMeses(valor: string | undefined, padrao: number) {
  if (valor === undefined || valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > MESES_MAX)
    throw new BadRequestException(
      `meses deve ser um inteiro de 1 a ${MESES_MAX}.`,
    );
  return n;
}

@Controller('mercado')
@Roles('administrador', 'produtor', 'analista')
export class MercadoController {
  constructor(
    private readonly mercado: MercadoService,
    private readonly importacao: MercadoImportacaoService,
  ) {}

  /** As culturas do usuário e os dados de mercado disponíveis para cada uma. */
  @Get('culturas')
  culturas(@CurrentUser() user: JwtPayload) {
    return this.mercado.culturas(user);
  }

  /** GET /mercado/atacado?cultura_id=1&meses=12[&produto=MANGA PALMER] */
  @Get('atacado')
  atacado(
    @CurrentUser() user: JwtPayload,
    @Query('cultura_id') culturaId?: string,
    @Query('meses') meses?: string,
    @Query('produto') produto?: string,
  ) {
    if (produto !== undefined && produto.length > 80)
      throw new BadRequestException('produto muito longo.');
    return this.mercado.atacado(
      user,
      lerCultura(culturaId),
      lerMeses(meses, 12),
      produto || undefined,
    );
  }

  /** GET /mercado/produtor?cultura_id=1&meses=12 */
  @Get('produtor')
  produtor(
    @CurrentUser() user: JwtPayload,
    @Query('cultura_id') culturaId?: string,
    @Query('meses') meses?: string,
  ) {
    return this.mercado.produtor(
      user,
      lerCultura(culturaId),
      lerMeses(meses, 12),
    );
  }

  /** GET /mercado/exportacao?cultura_id=1&meses=24 */
  @Get('exportacao')
  exportacao(
    @CurrentUser() user: JwtPayload,
    @Query('cultura_id') culturaId?: string,
    @Query('meses') meses?: string,
  ) {
    return this.mercado.exportacao(
      user,
      lerCultura(culturaId),
      lerMeses(meses, 24),
    );
  }

  /** Quando cada fonte foi importada e se alguma está rodando agora. */
  @Get('status')
  status() {
    return this.mercado.status();
  }

  /** Importa agora (todas as fontes, ou as do corpo: { "fontes": ["atacado"] }). */
  @Post('atualizar')
  @Roles('administrador')
  @HttpCode(202)
  atualizar(@Body() body: Record<string, unknown>) {
    const pedidas = body?.fontes;
    if (
      pedidas !== undefined &&
      (!Array.isArray(pedidas) ||
        !pedidas.every((f) => FONTES.includes(f as Fonte)))
    )
      throw new BadRequestException(
        `fontes deve ser uma lista de: ${FONTES.join(', ')}.`,
      );
    const iniciadas = this.importacao.iniciar(
      (pedidas as Fonte[] | undefined) ?? FONTES,
    );
    return { iniciadas, em_andamento: this.importacao.emAndamento() };
  }
}
