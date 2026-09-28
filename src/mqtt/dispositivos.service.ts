import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DynsecService, type Acl } from './dynsec.service.js';

const ROLE_EMPRESA = /^empresa-(\d+)$/;
const PREFIXO_EMPRESA = /^emp\d+-/;

/**
 * Nome do login no broker. O username é global no Mosquitto, então o prefixo
 * da empresa permite o mesmo nome (ex.: sensor-01) em empresas diferentes.
 */
const usernameEmpresa = (empresaId: number, nome: string) =>
  `emp${empresaId}-${nome}`;

/** Role que dá ao dispositivo acesso aos tópicos empresas/{id}/#. */
export const roleEmpresa = (empresaId: number) => `empresa-${empresaId}`;

function aclsEmpresa(empresaId: number): Acl[] {
  const topic = `empresas/${empresaId}/#`;
  return [
    { acltype: 'publishClientSend', topic, allow: true },
    { acltype: 'publishClientReceive', topic, allow: true },
    { acltype: 'subscribePattern', topic, allow: true },
  ];
}

interface ClienteDynsec {
  username: string;
  textname?: string;
  disabled?: boolean;
  roles?: { rolename: string }[];
}

export interface NovoDispositivo {
  username: string;
  senha: string;
  nome?: string;
  empresa_id: number | null;
  roles: string[];
}

/** Quem pode ser gerenciado: tudo (admin) ou só uma empresa (produtor). */
type Escopo = { admin: true } | { admin: false; empresaId: number };

/** Empresa do login, pela primeira role empresa-{id} que ele tiver. */
function empresaDoCliente(cliente: ClienteDynsec) {
  for (const { rolename } of cliente.roles ?? []) {
    const match = ROLE_EMPRESA.exec(rolename);
    if (match) return Number(match[1]);
  }
  return null;
}

function toDto(cliente: ClienteDynsec) {
  return {
    username: cliente.username,
    nome: cliente.textname ?? null,
    ativo: !cliente.disabled,
    empresa_id: empresaDoCliente(cliente),
    roles: (cliente.roles ?? []).map((r) => r.rolename),
  };
}

/**
 * Logins MQTT dos dispositivos. O administrador gerencia qualquer login; o
 * produtor, só os que têm a role da própria empresa. Nas rotas, o username é
 * o nome completo no broker (com o prefixo empN-), o mesmo usado no dispositivo.
 */
@Injectable()
export class DispositivosService {
  constructor(
    private readonly dynsec: DynsecService,
    private readonly prisma: PrismaService,
  ) {}

  /** O AuthGuard já recarrega perfil e empresa do banco a cada requisição. */
  private escopo(user: JwtPayload): Escopo {
    if (user.role === 'administrador') return { admin: true };
    if (user.role === 'produtor' && user.empresa_id !== null)
      return { admin: false, empresaId: user.empresa_id };
    throw new ForbiddenException('Seu perfil não tem acesso a este recurso.');
  }

  private podeAcessar(escopo: Escopo, cliente: ClienteDynsec) {
    return escopo.admin || empresaDoCliente(cliente) === escopo.empresaId;
  }

  /** Cria a role da empresa no broker se ainda não existir. */
  private async garantirRoleEmpresa(empresaId: number) {
    const empresa = await this.prisma.empresas.findUnique({
      where: { id: empresaId },
      select: { razao_social: true },
    });
    if (!empresa) throw new BadRequestException('Empresa não encontrada.');

    try {
      await this.dynsec.criarRole({
        rolename: roleEmpresa(empresaId),
        textname: empresa.razao_social,
        acls: aclsEmpresa(empresaId),
      });
    } catch (erro) {
      if (!(erro instanceof ConflictException)) throw erro;
    }
  }

  async listar(user: JwtPayload, empresaId?: number) {
    const escopo = this.escopo(user);
    const filtro = escopo.admin ? empresaId : escopo.empresaId;
    const { clients } = await this.dynsec.listarClientes<{
      clients: ClienteDynsec[];
    }>();

    return clients
      .filter((c) => c.username !== this.dynsec.usuarioApi)
      .filter((c) => filtro === undefined || empresaDoCliente(c) === filtro)
      .map(toDto);
  }

  /** Busca o login; 404 também quando ele é de outra empresa. */
  private async carregar(user: JwtPayload, username: string) {
    const escopo = this.escopo(user);
    const cliente = await this.dynsec
      .buscarCliente<{ client: ClienteDynsec }>(username)
      .then((data) => data.client)
      .catch((erro: unknown) => {
        if (erro instanceof NotFoundException) return null;
        throw erro;
      });
    if (!cliente || !this.podeAcessar(escopo, cliente))
      throw new NotFoundException('Dispositivo não encontrado.');
    return cliente;
  }

  async buscar(user: JwtPayload, username: string) {
    return toDto(await this.carregar(user, username));
  }

  async criar(user: JwtPayload, dados: NovoDispositivo) {
    const escopo = this.escopo(user);
    const empresaId = escopo.admin ? dados.empresa_id : escopo.empresaId;
    if (!escopo.admin && dados.roles.length)
      throw new BadRequestException('Só o administrador pode atribuir roles.');
    if (empresaId === null && !dados.roles.length)
      throw new BadRequestException('Informe empresa_id e/ou roles.');
    // o prefixo é reservado para indicar a empresa; a API o coloca sozinha
    if (PREFIXO_EMPRESA.test(dados.username))
      throw new BadRequestException(
        'Informe o username sem o prefixo empN- (ele é adicionado pela API).',
      );

    const roles = [...dados.roles];
    let username = dados.username;
    if (empresaId !== null) {
      await this.garantirRoleEmpresa(empresaId);
      roles.unshift(roleEmpresa(empresaId));
      username = usernameEmpresa(empresaId, dados.username);
    }

    await this.dynsec.criarCliente({
      username,
      password: dados.senha,
      textname: dados.nome,
      roles,
    });
    return { username, senha: dados.senha, empresa_id: empresaId };
  }

  async ativar(user: JwtPayload, username: string, ativo: boolean) {
    await this.carregar(user, username);
    await this.dynsec.ativarCliente(username, ativo);
  }

  async alterarSenha(user: JwtPayload, username: string, senha: string) {
    await this.carregar(user, username);
    await this.dynsec.alterarSenha(username, senha);
    return { username, senha };
  }

  async remover(user: JwtPayload, username: string) {
    await this.carregar(user, username);
    await this.dynsec.removerCliente(username);
  }
}
