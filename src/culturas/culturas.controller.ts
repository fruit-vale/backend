import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Patch,
} from '@nestjs/common';
import { Roles } from '../auth/decorators.js';
import { numero, texto } from '../common/validacao.js';
import { CulturasService, type DadosCultura } from './culturas.service.js';

// limites das colunas DECIMAL(5, 2)
const DECIMAL_5_2 = { min: -999.99, max: 1000 };
const PERCENTUAL = { min: 0, max: 100.01 };

function lerCultura(body: Record<string, unknown>): DadosCultura {
  return {
    nome: texto(body, 'nome', { max: 50 })!,
    variedade: texto(body, 'variedade', { obrigatorio: false, max: 50 }),
    temp_recomendada_min: numero(body, 'temp_recomendada_min', DECIMAL_5_2),
    temp_recomendada_max: numero(body, 'temp_recomendada_max', DECIMAL_5_2),
    umidade_recomendada_min: numero(
      body,
      'umidade_recomendada_min',
      PERCENTUAL,
    ),
    umidade_recomendada_max: numero(
      body,
      'umidade_recomendada_max',
      PERCENTUAL,
    ),
    ciclo_medio_dias: numero(body, 'ciclo_medio_dias', {
      min: 1,
      max: 36_500,
      inteiro: true,
    }),
    descricao: texto(body, 'descricao', { obrigatorio: false, max: 2000 }),
  };
}

@Controller('culturas')
@Roles('administrador')
export class CulturasController {
  constructor(private readonly culturas: CulturasService) {}

  // produtor e analista também consultam (ex.: ao cadastrar um lote)
  @Get()
  @Roles('administrador', 'produtor', 'analista')
  listar() {
    return this.culturas.listar();
  }

  @Post()
  criar(@Body() body: Record<string, unknown>) {
    return this.culturas.criar(lerCultura(body));
  }

  // o formulário envia a cultura completa
  @Patch(':id')
  alterar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.culturas.alterar(id, lerCultura(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remover(@Param('id', ParseIntPipe) id: number) {
    await this.culturas.remover(id);
  }
}
