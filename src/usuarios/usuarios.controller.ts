import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { ROLES, type Role } from '../auth/roles.js';
import { cpf, email, texto } from '../common/validacao.js';
import { UsuariosService, type AlteracaoUsuario } from './usuarios.service.js';

const SENHA_MIN = 8;

function lerRole(valor: unknown): Role {
  if (!ROLES.includes(valor as Role))
    throw new BadRequestException(`Perfil inválido. Use: ${ROLES.join(', ')}.`);
  return valor as Role;
}

function lerEmpresaId(valor: unknown): number | null {
  if (valor === undefined || valor === null) return null;
  if (!Number.isInteger(valor))
    throw new BadRequestException('empresa_id deve ser um número ou null.');
  return valor as number;
}

@Controller('usuarios')
@Roles('administrador')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar() {
    return this.usuarios.listar();
  }

  @Post()
  criar(@Body() body: Record<string, unknown>) {
    const senha = body?.senha;
    if (typeof senha !== 'string' || senha.length < SENHA_MIN)
      throw new BadRequestException(
        `A senha deve ter pelo menos ${SENHA_MIN} caracteres.`,
      );

    return this.usuarios.criar({
      nome: texto(body, 'nome', { max: 100 })!,
      email: email(body, 'email')!,
      cpf: cpf(texto(body, 'cpf', { max: 14 })!),
      telefone: texto(body, 'telefone', { obrigatorio: false, max: 20 }),
      senha,
      role: lerRole(body?.role),
      empresa_id: lerEmpresaId(body?.empresa_id),
    });
  }

  @Patch(':id')
  alterar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    const alteracao: AlteracaoUsuario = {};
    if (body?.role !== undefined) alteracao.role = lerRole(body.role);
    if (body?.empresa_id !== undefined)
      alteracao.empresa_id = lerEmpresaId(body.empresa_id);

    if (alteracao.role === undefined && alteracao.empresa_id === undefined)
      throw new BadRequestException('Informe role e/ou empresa_id.');

    // evita que o admin tire o próprio acesso de administrador
    if (id === user.sub && alteracao.role && alteracao.role !== user.role)
      throw new BadRequestException('Você não pode alterar o próprio perfil.');

    return this.usuarios.alterar(id, alteracao);
  }
}
