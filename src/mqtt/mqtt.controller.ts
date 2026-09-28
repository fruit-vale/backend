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
  Query,
} from '@nestjs/common';
import { CurrentUser, Roles, type JwtPayload } from '../auth/decorators.js';
import { texto } from '../common/validacao.js';
import {
  DynsecService,
  TIPOS_ACL,
  type Acl,
  type TipoAcl,
} from './dynsec.service.js';
import { DispositivosService, gerarSenha } from './dispositivos.service.js';

const SENHA_MIN = 12;
const ROLE_API = 'admin';
const NOME_VALIDO = /^[A-Za-z0-9_.-]+$/;
// nas rotas o username já vem com o prefixo empN- da empresa
const NOME_MAX = 64;
const NOME_ROTA_MAX = 80;

function lerNome(valor: unknown, campo: string, max = NOME_ROTA_MAX) {
  if (
    typeof valor !== 'string' ||
    !NOME_VALIDO.test(valor) ||
    valor.length > max
  )
    throw new BadRequestException(
      `${campo} deve ter até ${max} caracteres entre letras, números, _ . -`,
    );
  return valor;
}

/** Usa a senha informada ou gera uma aleatória (devolvida uma única vez). */
function lerSenha(valor: unknown) {
  if (valor === undefined || valor === null) return gerarSenha();
  if (typeof valor !== 'string' || valor.length < SENHA_MIN)
    throw new BadRequestException(
      `A senha deve ter pelo menos ${SENHA_MIN} caracteres.`,
    );
  return valor;
}

/** A role admin dá controle total do broker; não é atribuída por aqui. */
function lerRole(valor: unknown) {
  const role = lerNome(valor, 'role');
  if (role === ROLE_API)
    throw new BadRequestException(
      `A role ${role} não pode ser atribuída por aqui.`,
    );
  return role;
}

function lerRoles(valor: unknown) {
  if (valor === undefined) return [];
  if (!Array.isArray(valor))
    throw new BadRequestException('roles deve ser uma lista de nomes.');
  return valor.map(lerRole);
}

function lerEmpresaId(valor: unknown): number | null {
  if (valor === undefined || valor === null) return null;
  if (!Number.isInteger(valor))
    throw new BadRequestException('empresa_id deve ser um número ou null.');
  return valor as number;
}

function lerTipoAcl(valor: unknown): TipoAcl {
  if (!TIPOS_ACL.includes(valor as TipoAcl))
    throw new BadRequestException(
      `acltype inválido. Use: ${TIPOS_ACL.join(', ')}.`,
    );
  return valor as TipoAcl;
}

function lerTopico(valor: unknown) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > 256)
    throw new BadRequestException(
      'topic deve ser texto de até 256 caracteres.',
    );
  return valor;
}

function lerAcl(valor: unknown): Acl {
  const acl = (valor ?? {}) as Record<string, unknown>;
  if (typeof acl.allow !== 'boolean')
    throw new BadRequestException('allow deve ser true ou false.');
  if (acl.priority !== undefined && !Number.isInteger(acl.priority))
    throw new BadRequestException('priority deve ser um número inteiro.');
  return {
    acltype: lerTipoAcl(acl.acltype),
    topic: lerTopico(acl.topic),
    allow: acl.allow,
    priority: acl.priority as number | undefined,
  };
}

@Controller('mqtt')
@Roles('administrador')
export class MqttController {
  constructor(
    private readonly dynsec: DynsecService,
    private readonly dispositivos: DispositivosService,
  ) {}

  /** Impede que a API bloqueie o próprio acesso ao broker. */
  private naoProtegido(username: string) {
    if (username === this.dynsec.usuarioApi)
      throw new BadRequestException(
        'O usuário MQTT da API não pode ser alterado por aqui.',
      );
    return username;
  }

  /** A role admin (criada pelo dynsec init) dá à API acesso ao $CONTROL. */
  private roleNaoProtegida(rolename: string) {
    if (rolename === ROLE_API)
      throw new BadRequestException(
        `A role ${rolename} da API não pode ser alterada por aqui.`,
      );
    return rolename;
  }

  // clientes: acesso bruto aos logins do broker; sensores usam /sensores

  @Get('clientes')
  listarClientes(
    @CurrentUser() user: JwtPayload,
    @Query('empresa_id', new ParseIntPipe({ optional: true }))
    empresaId?: number,
  ) {
    return this.dispositivos.listar(user, empresaId);
  }

  @Get('clientes/:username')
  buscarCliente(
    @Param('username') username: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dispositivos.buscar(user, lerNome(username, 'username'));
  }

  @Post('clientes')
  criarCliente(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dispositivos.criar(user, {
      username: this.naoProtegido(
        lerNome(body?.username, 'username', NOME_MAX),
      ),
      senha: lerSenha(body?.senha),
      nome: texto(body, 'nome', { obrigatorio: false, max: 100 }) ?? undefined,
      empresa_id: lerEmpresaId(body?.empresa_id),
      roles: lerRoles(body?.roles),
    });
  }

  @Patch('clientes/:username')
  @HttpCode(204)
  async alterarCliente(
    @Param('username') username: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    this.naoProtegido(lerNome(username, 'username'));
    if (typeof body?.ativo !== 'boolean')
      throw new BadRequestException('Informe ativo: true ou false.');
    await this.dispositivos.ativar(user, username, body.ativo);
  }

  @Post('clientes/:username/senha')
  alterarSenha(
    @Param('username') username: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    this.naoProtegido(lerNome(username, 'username'));
    return this.dispositivos.alterarSenha(
      user,
      username,
      lerSenha(body?.senha),
    );
  }

  @Delete('clientes/:username')
  @HttpCode(204)
  async removerCliente(
    @Param('username') username: string,
    @CurrentUser() user: JwtPayload,
  ) {
    this.naoProtegido(lerNome(username, 'username'));
    await this.dispositivos.remover(user, username);
  }

  // vínculo com roles: só administrador

  @Post('clientes/:username/roles')
  @HttpCode(204)
  async adicionarRoleCliente(
    @Param('username') username: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.naoProtegido(lerNome(username, 'username'));
    await this.dynsec.adicionarRoleCliente(username, lerRole(body?.role));
  }

  @Delete('clientes/:username/roles/:role')
  @HttpCode(204)
  async removerRoleCliente(
    @Param('username') username: string,
    @Param('role') role: string,
  ) {
    this.naoProtegido(lerNome(username, 'username'));
    await this.dynsec.removerRoleCliente(username, lerNome(role, 'role'));
  }

  // roles

  @Get('roles')
  listarRoles() {
    return this.dynsec.listarRoles();
  }

  @Get('roles/:rolename')
  buscarRole(@Param('rolename') rolename: string) {
    return this.dynsec.buscarRole(lerNome(rolename, 'rolename'));
  }

  @Post('roles')
  @HttpCode(204)
  async criarRole(@Body() body: Record<string, unknown>) {
    const acls = body?.acls ?? [];
    if (!Array.isArray(acls))
      throw new BadRequestException('acls deve ser uma lista.');
    await this.dynsec.criarRole({
      rolename: lerNome(body?.rolename, 'rolename', NOME_MAX),
      textname:
        texto(body, 'nome', { obrigatorio: false, max: 100 }) ?? undefined,
      acls: acls.map(lerAcl),
    });
  }

  @Post('roles/:rolename/acls')
  @HttpCode(204)
  async adicionarAcl(
    @Param('rolename') rolename: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.dynsec.adicionarAcl(
      this.roleNaoProtegida(lerNome(rolename, 'rolename')),
      lerAcl(body),
    );
  }

  @Delete('roles/:rolename/acls')
  @HttpCode(204)
  async removerAcl(
    @Param('rolename') rolename: string,
    @Query('acltype') acltype: string,
    @Query('topic') topic: string,
  ) {
    await this.dynsec.removerAcl(
      this.roleNaoProtegida(lerNome(rolename, 'rolename')),
      lerTipoAcl(acltype),
      lerTopico(topic),
    );
  }

  @Delete('roles/:rolename')
  @HttpCode(204)
  async removerRole(@Param('rolename') rolename: string) {
    await this.dynsec.removerRole(
      this.roleNaoProtegida(lerNome(rolename, 'rolename')),
    );
  }
}
