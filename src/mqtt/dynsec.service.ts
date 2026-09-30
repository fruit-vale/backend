import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { connect, type MqttClient } from 'mqtt';

const TOPICO_COMANDO = '$CONTROL/dynamic-security/v1';
const TOPICO_RESPOSTA = `${TOPICO_COMANDO}/response`;
const TIMEOUT_MS = 5000;

type Tratador = (topico: string, payload: Buffer) => void;

/** Casa um tópico com um filtro MQTT (+ e #), ignorando o prefixo $share/grupo/. */
function casaFiltro(filtro: string, topico: string) {
  const partesFiltro = filtro.replace(/^\$share\/[^/]+\//, '').split('/');
  const partesTopico = topico.split('/');
  for (let i = 0; i < partesFiltro.length; i++) {
    if (partesFiltro[i] === '#') return true;
    if (partesFiltro[i] !== '+' && partesFiltro[i] !== partesTopico[i])
      return false;
  }
  return partesFiltro.length === partesTopico.length;
}

export type TipoAcl =
  | 'publishClientSend'
  | 'publishClientReceive'
  | 'subscribeLiteral'
  | 'subscribePattern'
  | 'unsubscribeLiteral'
  | 'unsubscribePattern';

export const TIPOS_ACL: TipoAcl[] = [
  'publishClientSend',
  'publishClientReceive',
  'subscribeLiteral',
  'subscribePattern',
  'unsubscribeLiteral',
  'unsubscribePattern',
];

export interface Acl {
  acltype: TipoAcl;
  topic: string;
  allow: boolean;
  priority?: number;
}

interface Inscricao {
  filtro: string;
  tratador: Tratador;
}

interface Resposta {
  command: string;
  error?: string;
  data?: unknown;
  correlationData?: string;
}

interface Pendente {
  resolve: (data: unknown) => void;
  reject: (erro: Error) => void;
  timer: NodeJS.Timeout;
}

/** Converte o erro textual do plugin em exceção HTTP. */
function erroHttp(comando: string, erro: string) {
  const msg = `Mosquitto (${comando}): ${erro}`;
  if (/not found/i.test(erro)) return new NotFoundException(msg);
  if (/already exists/i.test(erro)) return new ConflictException(msg);
  return new BadRequestException(msg);
}

/**
 * Cliente do plugin Dynamic Security do Mosquitto: os comandos são publicados
 * em $CONTROL/dynamic-security/v1 e a resposta chega em .../response, casada
 * pelo correlationData. As alterações valem na hora, sem reiniciar o broker.
 */
@Injectable()
export class DynsecService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DynsecService.name);
  private readonly pendentes = new Map<string, Pendente>();
  private client?: MqttClient;
  private readonly inscricoes: Inscricao[] = [];

  /** Usuário que a própria API usa no broker; não pode ser alterado por aqui. */
  readonly usuarioApi = process.env.MQTT_USER;

  onModuleInit() {
    const url = process.env.MQTT_URL;
    if (!url) {
      this.logger.warn(
        'MQTT_URL não definido; gestão do Mosquitto desativada.',
      );
      return;
    }

    this.client = connect(url, {
      username: this.usuarioApi,
      password: process.env.MQTT_PASS,
      clientId: `fruitvale-api-${randomUUID().slice(0, 8)}`,
      reconnectPeriod: 5000,
    });
    this.client.on('connect', () => void this.aoConectar());
    this.client.on('error', (erro) =>
      this.logger.error(`Erro MQTT: ${erro.message}`),
    );
    this.client.on('message', (topico, payload) => {
      if (topico === TOPICO_RESPOSTA) return this.tratarResposta(payload);
      for (const { filtro, tratador } of this.inscricoes)
        if (casaFiltro(filtro, topico)) tratador(topico, payload);
    });
  }

  /** Refeito a cada (re)conexão: sessão limpa perde as assinaturas. */
  private async aoConectar() {
    const client = this.client!;
    this.logger.log('Conectado ao Mosquitto.');
    // a role admin criada pelo "dynsec init" já permite assinar e receber #;
    // não alteramos as roles do próprio usuário, pois o plugin derruba a
    // conexão de quem tem as roles alteradas
    try {
      await client.subscribeAsync(TOPICO_RESPOSTA, { qos: 1 });
      for (const { filtro } of this.inscricoes) await this.assinar(filtro);
    } catch (erro) {
      this.logger.error(
        `Falha ao preparar a conexão MQTT: ${(erro as Error).message}`,
      );
    }
  }

  /** Assina um filtro; uma recusa só é registrada, sem afetar os demais. */
  private async assinar(filtro: string) {
    try {
      const [concedida] = await this.client!.subscribeAsync(filtro, { qos: 1 });
      if (!concedida || concedida.qos === 128)
        this.logger.error(`Broker negou a assinatura de ${filtro}.`);
      else this.logger.log(`Assinando ${filtro}.`);
    } catch (erro) {
      // o mqtt.js rejeita a promessa quando o SUBACK volta com 0x80 (negado)
      this.logger.error(
        `Broker negou a assinatura de ${filtro}: ${(erro as Error).message}`,
      );
    }
  }

  /**
   * Registra um tratador para um filtro de tópico. A assinatura é feita agora
   * (se conectado) e refeita em toda reconexão.
   */
  inscrever(filtro: string, tratador: Tratador) {
    this.inscricoes.push({ filtro, tratador });
    if (this.client?.connected)
      this.assinar(filtro).catch((erro: Error) =>
        this.logger.error(`Falha ao assinar ${filtro}: ${erro.message}`),
      );
  }

  async onModuleDestroy() {
    for (const { timer, reject } of this.pendentes.values()) {
      clearTimeout(timer);
      reject(new ServiceUnavailableException('API encerrando.'));
    }
    this.pendentes.clear();
    await this.client?.endAsync();
  }

  private tratarResposta(payload: Buffer) {
    let respostas: Resposta[];
    try {
      respostas = (JSON.parse(payload.toString()) as { responses: Resposta[] })
        .responses;
    } catch {
      return;
    }
    for (const resposta of respostas ?? []) {
      const pendente = resposta.correlationData
        ? this.pendentes.get(resposta.correlationData)
        : undefined;
      if (!pendente) continue;

      this.pendentes.delete(resposta.correlationData!);
      clearTimeout(pendente.timer);
      if (resposta.error)
        pendente.reject(erroHttp(resposta.command, resposta.error));
      else pendente.resolve(resposta.data);
    }
  }

  /** Envia um comando ao plugin e devolve o campo `data` da resposta. */
  comando<T = unknown>(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const client = this.client;
    if (!client?.connected)
      return Promise.reject(
        new ServiceUnavailableException('Broker MQTT indisponível.'),
      );

    const correlationData = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(correlationData);
        reject(
          new GatewayTimeoutException(`Mosquitto não respondeu a ${command}.`),
        );
      }, TIMEOUT_MS);
      this.pendentes.set(correlationData, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer,
      });

      const payload = JSON.stringify({
        commands: [{ command, ...params, correlationData }],
      });
      client.publish(TOPICO_COMANDO, payload, { qos: 1 }, (erro) => {
        if (!erro) return;
        clearTimeout(timer);
        this.pendentes.delete(correlationData);
        reject(new ServiceUnavailableException(erro.message));
      });
    });
  }

  // clientes (usuários do broker)

  listarClientes<T = unknown>() {
    return this.comando<T>('listClients', { verbose: true, count: -1 });
  }

  buscarCliente<T = unknown>(username: string) {
    return this.comando<T>('getClient', { username });
  }

  criarCliente(dados: {
    username: string;
    password: string;
    textname?: string;
    roles: string[];
  }) {
    return this.comando('createClient', {
      username: dados.username,
      password: dados.password,
      textname: dados.textname,
      roles: dados.roles.map((rolename) => ({ rolename })),
    });
  }

  removerCliente(username: string) {
    return this.comando('deleteClient', { username });
  }

  alterarSenha(username: string, password: string) {
    return this.comando('setClientPassword', { username, password });
  }

  ativarCliente(username: string, ativo: boolean) {
    return this.comando(ativo ? 'enableClient' : 'disableClient', {
      username,
    });
  }

  adicionarRoleCliente(username: string, rolename: string) {
    return this.comando('addClientRole', { username, rolename });
  }

  removerRoleCliente(username: string, rolename: string) {
    return this.comando('removeClientRole', { username, rolename });
  }

  // roles (conjuntos de ACLs)

  listarRoles() {
    return this.comando('listRoles', { verbose: true, count: -1 });
  }

  buscarRole(rolename: string) {
    return this.comando('getRole', { rolename });
  }

  criarRole(dados: { rolename: string; textname?: string; acls: Acl[] }) {
    return this.comando('createRole', dados);
  }

  removerRole(rolename: string) {
    return this.comando('deleteRole', { rolename });
  }

  adicionarAcl(rolename: string, acl: Acl) {
    return this.comando('addRoleACL', { rolename, ...acl });
  }

  removerAcl(rolename: string, acltype: TipoAcl, topic: string) {
    return this.comando('removeRoleACL', { rolename, acltype, topic });
  }
}
