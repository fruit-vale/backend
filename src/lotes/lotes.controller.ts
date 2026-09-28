import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { data, numero, texto } from '../common/validacao.js';
import { lerGeometria } from './geometria.js';
import {
  LotesService,
  SITUACOES_LOTE,
  type DadosLote,
  type SituacaoLote,
} from './lotes.service.js';

function lerId(valor: unknown, campo: string) {
  if (!Number.isInteger(valor))
    throw new BadRequestException(`Selecione ${campo}.`);
  return valor as number;
}

function lerSituacao(valor: unknown): SituacaoLote {
  if (valor === undefined || valor === null) return 'EM_CULTIVO';
  if (!SITUACOES_LOTE.includes(valor as SituacaoLote))
    throw new BadRequestException(
      `Situação inválida. Use: ${SITUACOES_LOTE.join(', ')}.`,
    );
  return valor as SituacaoLote;
}

/** O formulário envia o lote completo, na criação e na edição. */
function lerLote(body: Record<string, unknown>): DadosLote {
  // com geometria, a área vem do retângulo; sem ela, pode ser informada
  const retangulo =
    body?.geometria === undefined || body?.geometria === null
      ? null
      : lerGeometria(body.geometria);
  return {
    nome_identificacao: texto(body, 'nome_identificacao', { max: 50 })!,
    propriedade_id: lerId(body?.propriedade_id, 'a propriedade'),
    cultura_id: lerId(body?.cultura_id, 'a cultura'),
    data_plantio: data(body, 'data_plantio'),
    previsao_colheita: data(body, 'previsao_colheita'),
    situacao: lerSituacao(body?.situacao),
    geometria: retangulo?.geometria ?? null,
    area_ha:
      retangulo?.area_ha ??
      numero(body, 'area_ha', { min: 0, max: 100_000_000 }),
  };
}

@Controller('lotes')
@Roles('administrador', 'produtor')
export class LotesController {
  constructor(private readonly lotes: LotesService) {}

  @Get()
  @Roles('administrador', 'produtor', 'analista')
  listar(@CurrentUser() user: JwtPayload) {
    return this.lotes.listar(user);
  }

  @Get(':id')
  @Roles('administrador', 'produtor', 'analista')
  detalhe(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lotes.detalhe(user, id);
  }

  @Post()
  criar(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lotes.criar(user, lerLote(body));
  }

  @Patch(':id')
  alterar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.lotes.alterar(user, id, lerLote(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remover(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.lotes.remover(user, id);
  }
}
