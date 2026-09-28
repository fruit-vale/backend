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
  SafrasService,
  type AlteracaoSafra,
  type Colheita,
  type NovaSafra,
} from './safras.service.js';
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

// NUMERIC(12, 2), limite exclusivo
const PRODUCAO = { min: 0, max: 10_000_000_000 };

function lerProducao(body: Record<string, unknown>) {
  const producao = numero(body, 'producao', PRODUCAO);
  return {
    producao,
    // sem unidade informada, a produção é em kg
    unidade_producao:
      producao === null
        ? null
        : (texto(body, 'unidade_producao', { obrigatorio: false, max: 20 }) ??
          'kg'),
  };
}

const lerObservacoes = (body: Record<string, unknown>) =>
  texto(body, 'observacoes', { obrigatorio: false, max: 2000 });

function lerColheita(body: Record<string, unknown>): Colheita {
  const dataColheita = data(body, 'data_colheita');
  if (!dataColheita)
    throw new BadRequestException('Informe a data de colheita.');
  if (dataColheita.getTime() > Date.now())
    throw new BadRequestException(
      'A data de colheita não pode estar no futuro.',
    );
  return {
    data_colheita: dataColheita,
    ...lerProducao(body),
    observacoes: lerObservacoes(body),
  };
}

function lerNovaSafra(body: Record<string, unknown>): NovaSafra {
  const situacao = lerSituacao(body?.situacao);
  if (situacao === 'COLHIDO')
    throw new BadRequestException(
      'Uma safra nova começa em preparo ou em cultivo.',
    );
  return {
    cultura_id: lerId(body?.cultura_id, 'a cultura'),
    data_plantio: data(body, 'data_plantio'),
    previsao_colheita: data(body, 'previsao_colheita'),
    situacao,
    observacoes: lerObservacoes(body),
  };
}

function lerAlteracaoSafra(body: Record<string, unknown>): AlteracaoSafra {
  return {
    cultura_id: lerId(body?.cultura_id, 'a cultura'),
    data_plantio: data(body, 'data_plantio'),
    previsao_colheita: data(body, 'previsao_colheita'),
    data_colheita: data(body, 'data_colheita'),
    ...lerProducao(body),
    observacoes: lerObservacoes(body),
  };
}

@Controller('lotes')
@Roles('administrador', 'produtor')
export class LotesController {
  constructor(
    private readonly lotes: LotesService,
    private readonly safras: SafrasService,
  ) {}

  // histórico de cultivo (safras)

  @Get(':id/safras')
  @Roles('administrador', 'produtor', 'analista')
  listarSafras(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.safras.listar(user, id);
  }

  /** Encerra a safra em andamento. */
  @Post(':id/safras/colheita')
  colher(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.safras.colher(user, id, lerColheita(body));
  }

  /** Inicia a próxima safra do lote. */
  @Post(':id/safras')
  iniciarSafra(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.safras.iniciar(user, id, lerNovaSafra(body));
  }

  @Patch(':id/safras/:safraId')
  alterarSafra(
    @Param('id', ParseIntPipe) id: number,
    @Param('safraId', ParseIntPipe) safraId: number,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.safras.alterar(user, id, safraId, lerAlteracaoSafra(body));
  }

  @Delete(':id/safras/:safraId')
  @HttpCode(204)
  async removerSafra(
    @Param('id', ParseIntPipe) id: number,
    @Param('safraId', ParseIntPipe) safraId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.safras.remover(user, id, safraId);
  }

  // lotes

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
