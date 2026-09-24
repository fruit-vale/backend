import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators.js';
import { cnpj, email, texto } from '../common/validacao.js';
import { EmpresasService } from './empresas.service.js';

// siglas das 27 unidades federativas
const UFS =
  'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(
    ' ',
  );

@Controller('empresas')
@Roles('administrador')
export class EmpresasController {
  constructor(private readonly empresas: EmpresasService) {}

  @Get()
  listar() {
    return this.empresas.listar();
  }

  @Post()
  criar(@Body() body: Record<string, unknown>) {
    const estado =
      texto(body, 'estado', { obrigatorio: false, max: 2 })?.toUpperCase() ??
      null;
    if (estado !== null && !UFS.includes(estado))
      throw new BadRequestException('UF inválida.');

    return this.empresas.criar({
      razao_social: texto(body, 'razao_social', { max: 150 })!,
      cpf_cnpj: cnpj(texto(body, 'cpf_cnpj', { max: 20 })!),
      telefone: texto(body, 'telefone', { obrigatorio: false, max: 20 }),
      email: email(body, 'email', false),
      cidade: texto(body, 'cidade', { obrigatorio: false, max: 100 }),
      estado,
      responsavel: texto(body, 'responsavel', { obrigatorio: false, max: 100 }),
    });
  }
}
