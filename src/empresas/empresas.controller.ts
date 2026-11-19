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
import { UFS, cnpj, email, texto } from '../common/validacao.js';
import { EmpresasService } from './empresas.service.js';

/** Mesmos campos do cadastro; o formulário de edição envia todos. */
function lerEmpresa(body: Record<string, unknown>) {
  const estado =
    texto(body, 'estado', { obrigatorio: false, max: 2 })?.toUpperCase() ??
    null;
  if (estado !== null && !UFS.includes(estado))
    throw new BadRequestException('UF inválida.');

  return {
    razao_social: texto(body, 'razao_social', { max: 150 })!,
    cpf_cnpj: cnpj(texto(body, 'cpf_cnpj', { max: 20 })!),
    telefone: texto(body, 'telefone', { obrigatorio: false, max: 20 }),
    // o contrato é enviado para esse e-mail
    email: email(body, 'email')!,
    cidade: texto(body, 'cidade', { obrigatorio: false, max: 100 }),
    estado,
    responsavel: texto(body, 'responsavel', { obrigatorio: false, max: 100 }),
  };
}

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
    return this.empresas.criar(lerEmpresa(body));
  }

  @Patch(':id')
  alterar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.empresas.alterar(id, lerEmpresa(body));
  }

  /** Apaga a empresa e tudo o que é dela (usuários, propriedades, lotes, sensores, leituras...). */
  @Delete(':id')
  @HttpCode(204)
  async remover(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.empresas.remover(id, user);
  }

  @Post(':id/contrato/reenviar')
  reenviarContrato(@Param('id', ParseIntPipe) id: number) {
    return this.empresas.reenviarContrato(id);
  }
}
