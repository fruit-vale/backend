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
import { data, texto } from '../common/validacao.js';
import {
  STATUS_SENSOR,
  SensoresService,
  type StatusSensor,
} from './sensores.service.js';

// mesmos caracteres aceitos em usernames do broker
const IDENTIFICADOR_VALIDO = /^[A-Za-z0-9_.-]+$/;

function lerIdentificador(valor: unknown) {
  if (typeof valor !== 'string' || !IDENTIFICADOR_VALIDO.test(valor.trim()))
    throw new BadRequestException(
      'O identificador deve ter só letras, números, _ . -',
    );
  const identificador = valor.trim();
  if (/^emp\d+-/.test(identificador))
    throw new BadRequestException(
      'Informe o identificador sem o prefixo empN- (ele é adicionado pela API).',
    );
  return identificador;
}

function lerPropriedadeId(valor: unknown) {
  if (!Number.isInteger(valor))
    throw new BadRequestException('Selecione a propriedade do sensor.');
  return valor as number;
}

function lerStatus(valor: unknown): StatusSensor {
  if (!STATUS_SENSOR.includes(valor as StatusSensor))
    throw new BadRequestException(
      `Status inválido. Use: ${STATUS_SENSOR.join(', ')}.`,
    );
  return valor as StatusSensor;
}

@Controller('sensores')
@Roles('administrador', 'produtor')
export class SensoresController {
  constructor(private readonly sensores: SensoresService) {}

  @Get()
  listar(@CurrentUser() user: JwtPayload) {
    return this.sensores.listar(user);
  }

  @Post()
  criar(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sensores.criar(user, {
      identificador: lerIdentificador(body?.identificador),
      tipo: texto(body, 'tipo', { max: 50 })!,
      propriedade_id: lerPropriedadeId(body?.propriedade_id),
      data_instalacao: data(body, 'data_instalacao'),
    });
  }

  @Patch(':id')
  alterar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sensores.alterarStatus(user, id, lerStatus(body?.status));
  }

  @Post(':id/senha')
  novaSenha(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sensores.gerarNovaSenha(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remover(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.sensores.remover(user, id);
  }
}
