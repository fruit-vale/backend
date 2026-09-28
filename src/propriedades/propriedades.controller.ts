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
import { UFS, numero, texto } from '../common/validacao.js';
import {
  PropriedadesService,
  STATUS_PROPRIEDADE,
  type DadosPropriedade,
  type StatusPropriedade,
} from './propriedades.service.js';

function lerIdOpcional(valor: unknown, campo: string) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!Number.isInteger(valor))
    throw new BadRequestException(`${campo} deve ser um número ou null.`);
  return valor as number;
}

/** O formulário envia a propriedade completa, na criação e na edição. */
function lerPropriedade(body: Record<string, unknown>): DadosPropriedade {
  const estado = texto(body, 'estado', { max: 2 })!.toUpperCase();
  if (!UFS.includes(estado)) throw new BadRequestException('UF inválida.');

  const status = (body?.status ?? 'ATIVA') as StatusPropriedade;
  if (!STATUS_PROPRIEDADE.includes(status))
    throw new BadRequestException(
      `Status inválido. Use: ${STATUS_PROPRIEDADE.join(', ')}.`,
    );

  // DECIMAL(10, 8) e DECIMAL(11, 8)
  const coordenada = { casas: 8, maxInclusivo: true };
  const latitude = numero(body, 'latitude', {
    min: -90,
    max: 90,
    ...coordenada,
  });
  const longitude = numero(body, 'longitude', {
    min: -180,
    max: 180,
    ...coordenada,
  });
  if ((latitude === null) !== (longitude === null))
    throw new BadRequestException('Informe latitude e longitude juntas.');

  return {
    nome: texto(body, 'nome', { max: 100 })!,
    municipio: texto(body, 'municipio', { max: 100 })!,
    estado,
    latitude,
    longitude,
    area_total_ha: numero(body, 'area_total_ha', { min: 0, max: 100_000_000 }),
    produtor_responsavel_id: lerIdOpcional(
      body?.produtor_responsavel_id,
      'produtor_responsavel_id',
    ),
    status,
  };
}

@Controller('propriedades')
@Roles('administrador')
export class PropriedadesController {
  constructor(private readonly propriedades: PropriedadesService) {}

  // produtor e analista consultam as da própria empresa (lotes, sensores)
  @Get()
  @Roles('administrador', 'produtor', 'analista')
  listar(@CurrentUser() user: JwtPayload) {
    return this.propriedades.listar(user);
  }

  @Post()
  criar(@Body() body: Record<string, unknown>) {
    if (!Number.isInteger(body?.empresa_id))
      throw new BadRequestException('Selecione a empresa da propriedade.');
    return this.propriedades.criar(
      body.empresa_id as number,
      lerPropriedade(body),
    );
  }

  @Patch(':id')
  alterar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.propriedades.alterar(id, lerPropriedade(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remover(@Param('id', ParseIntPipe) id: number) {
    await this.propriedades.remover(id);
  }
}
