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
    const estado = texto(body, 'estado', { obrigatorio: false, max: 2 });
    if (estado !== null && !/^[A-Za-z]{2}$/.test(estado))
      throw new BadRequestException('UF deve ser a sigla do estado (ex.: PE).');

    return this.empresas.criar({
      razao_social: texto(body, 'razao_social', { max: 150 })!,
      cpf_cnpj: cnpj(texto(body, 'cpf_cnpj', { max: 20 })!),
      telefone: texto(body, 'telefone', { obrigatorio: false, max: 20 }),
      email: email(body, 'email', false),
      cidade: texto(body, 'cidade', { obrigatorio: false, max: 100 }),
      estado: estado?.toUpperCase() ?? null,
      responsavel: texto(body, 'responsavel', { obrigatorio: false, max: 100 }),
    });
  }
}
