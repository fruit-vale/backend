import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { escopoLotes, escopoSensores } from '../auth/escopo.js';
import {
  DispositivosService,
  gerarSenha,
  roleEmpresa,
} from '../mqtt/dispositivos.service.js';
import { DynsecService } from '../mqtt/dynsec.service.js';
import { chaveSensor } from '../leituras/ingestao.service.js';
import { dataIso } from '../common/validacao.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { MedidaEntrada, TipoMedida } from './medidas.js';

export type StatusSensor = 'ATIVO' | 'INATIVO' | 'MANUTENCAO';
export const STATUS_SENSOR: StatusSensor[] = ['ATIVO', 'INATIVO', 'MANUTENCAO'];

// codigo_sensor é VARCHAR(50) e também é o username do sensor no broker
const CODIGO_MAX = 50;
// o broker precisa responder dentro da transação do banco
const TRANSACAO = { timeout: 15_000 };

export interface NovoSensor {
  identificador: string;
  tipo: string;
  /** O sensor fica num lote; a propriedade vem dele. */
  lote_id: number;
  data_instalacao: Date | null;
  /** Dados que o sensor envia (nome, chave no JSON, unidade, tipo). */
  medidas: MedidaEntrada[];
}

const sensorSelect = {
  id: true,
  codigo_sensor: true,
  tipo: true,
  status: true,
  data_instalacao: true,
  propriedades: {
    select: {
      id: true,
      nome: true,
      empresa_id: true,
      empresas: { select: { id: true, razao_social: true } },
    },
  },
  lotes: { select: { id: true, nome_identificacao: true } },
  medidas: {
    select: { id: true, chave: true, nome: true, unidade: true, tipo: true },
    orderBy: { id: 'asc' },
  },
  _count: { select: { leituras_sensores: true } },
} as const;

type SensorRow = Prisma.sensoresGetPayload<{ select: typeof sensorSelect }>;

/** null = não foi possível consultar o broker. */
type AcessoMqtt = 'ativo' | 'inativo' | 'sem_acesso' | null;

function toDto(sensor: SensorRow, acesso: AcessoMqtt) {
  return {
    id: sensor.id,
    codigo_sensor: sensor.codigo_sensor,
    tipo: sensor.tipo,
    status: (sensor.status ?? 'ATIVO') as StatusSensor,
    data_instalacao: dataIso(sensor.data_instalacao),
    propriedade: { id: sensor.propriedades.id, nome: sensor.propriedades.nome },
    // sensores antigos podem não ter lote
    lote: sensor.lotes && {
      id: sensor.lotes.id,
      nome: sensor.lotes.nome_identificacao,
    },
    empresa: sensor.propriedades.empresas,
    medidas: sensor.medidas.map((m) => ({ ...m, tipo: m.tipo as TipoMedida })),
    total_leituras: sensor._count.leituras_sensores,
    acesso_mqtt: acesso,
  };
}

/** Descrição do login no broker: tipo · lote (propriedade). */
const descricao = (
  sensor: { tipo: string },
  propriedade: { nome: string },
  lote?: { nome_identificacao: string } | null,
) =>
  (lote
    ? `${sensor.tipo} · ${lote.nome_identificacao} (${propriedade.nome})`
    : `${sensor.tipo} · ${propriedade.nome}`
  ).slice(0, 100);

/**
 * Sensores do banco, cada um com um login MQTT de mesmo nome (codigo_sensor).
 * Cadastro, status e exclusão mudam banco e broker juntos: a alteração no
 * broker roda dentro da transação, e se ela falhar nada é gravado no banco.
 */
@Injectable()
export class SensoresService {
  private readonly logger = new Logger(SensoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dynsec: DynsecService,
    private readonly dispositivos: DispositivosService,
    private readonly redis: RedisService,
  ) {}

  private exigirPerfil(user: JwtPayload) {
    if (user.role !== 'administrador' && user.role !== 'produtor')
      throw new ForbiddenException('Seu perfil não tem acesso a este recurso.');
  }

  /** Estado dos logins no broker, por username; null se o broker não respondeu. */
  private async acessos() {
    try {
      const { clients } = await this.dynsec.listarClientes<{
        clients: { username: string; disabled?: boolean }[];
      }>();
      return new Map(clients.map((c) => [c.username, !c.disabled]));
    } catch {
      return null;
    }
  }

  private async carregar(user: JwtPayload, id: number) {
    this.exigirPerfil(user);
    const sensor = await this.prisma.sensores.findFirst({
      where: { id, ...escopoSensores(user) },
      select: sensorSelect,
    });
    if (!sensor) throw new NotFoundException('Sensor não encontrado.');
    return sensor;
  }

  async listar(user: JwtPayload) {
    this.exigirPerfil(user);
    const [sensores, acessos] = await Promise.all([
      this.prisma.sensores.findMany({
        where: escopoSensores(user),
        select: sensorSelect,
        orderBy: { codigo_sensor: 'asc' },
      }),
      this.acessos(),
    ]);
    return sensores.map((sensor) => {
      if (!acessos) return toDto(sensor, null);
      const ativo = acessos.get(sensor.codigo_sensor);
      return toDto(
        sensor,
        ativo === undefined ? 'sem_acesso' : ativo ? 'ativo' : 'inativo',
      );
    });
  }

  async criar(user: JwtPayload, dados: NovoSensor) {
    this.exigirPerfil(user);
    const lote = await this.prisma.lotes.findFirst({
      where: { id: dados.lote_id, ...escopoLotes(user) },
      select: {
        id: true,
        nome_identificacao: true,
        propriedades: { select: { id: true, nome: true, empresa_id: true } },
      },
    });
    if (!lote) throw new BadRequestException('Lote não encontrado.');
    const propriedade = lote.propriedades;

    // o prefixo da empresa evita conflito de nomes entre empresas no broker
    const codigo = `emp${propriedade.empresa_id}-${dados.identificador}`;
    if (codigo.length > CODIGO_MAX)
      throw new BadRequestException(
        `Identificador muito longo: o código final (${codigo}) deve ter até ${CODIGO_MAX} caracteres.`,
      );
    const existe = await this.prisma.sensores.findUnique({
      where: { codigo_sensor: codigo },
      select: { id: true },
    });
    if (existe)
      throw new ConflictException(
        'Já existe um sensor com esse identificador.',
      );

    await this.dispositivos.garantirRoleEmpresa(propriedade.empresa_id);
    const senha = gerarSenha();

    const sensor = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.sensores.create({
        data: {
          codigo_sensor: codigo,
          tipo: dados.tipo,
          propriedade_id: propriedade.id,
          lote_id: lote.id,
          data_instalacao: dados.data_instalacao,
          status: 'ATIVO',
          medidas: {
            create: dados.medidas.map((m) => ({
              chave: m.chave,
              nome: m.nome,
              unidade: m.unidade,
              tipo: m.tipo,
            })),
          },
        },
        select: sensorSelect,
      });
      await this.dynsec.criarCliente({
        username: codigo,
        password: senha,
        textname: descricao(dados, propriedade, lote),
        roles: [roleEmpresa(propriedade.empresa_id)],
      });
      return criado;
    }, TRANSACAO);
    // a ingestão pode ter guardado "código desconhecido" antes do cadastro
    await this.redis.remover(chaveSensor(codigo));

    return {
      sensor: toDto(sensor, 'ativo'),
      credenciais: {
        username: codigo,
        senha,
        empresa_id: propriedade.empresa_id,
      },
    };
  }

  async alterarStatus(user: JwtPayload, id: number, status: StatusSensor) {
    const atual = await this.carregar(user, id);

    const sensor = await this.prisma.$transaction(async (tx) => {
      const alterado = await tx.sensores.update({
        where: { id },
        data: { status },
        select: sensorSelect,
      });
      // só INATIVO corta o acesso; em manutenção o sensor continua conectando
      await this.dynsec
        .ativarCliente(atual.codigo_sensor, status !== 'INATIVO')
        .catch((erro: unknown) => {
          if (!(erro instanceof NotFoundException)) throw erro;
        });
      return alterado;
    }, TRANSACAO);
    await this.redis.remover(chaveSensor(atual.codigo_sensor));

    const acessos = await this.acessos();
    const ativo = acessos?.get(sensor.codigo_sensor);
    return toDto(
      sensor,
      !acessos
        ? null
        : ativo === undefined
          ? 'sem_acesso'
          : ativo
            ? 'ativo'
            : 'inativo',
    );
  }

  /**
   * Substitui a lista de dados do sensor: itens com id são atualizados, sem
   * id são criados e os que faltarem são removidos. Um dado com valores
   * gravados não pode ser removido (o histórico seria apagado em cascata).
   */
  async alterarMedidas(user: JwtPayload, id: number, medidas: MedidaEntrada[]) {
    const sensor = await this.carregar(user, id);
    const atuais = new Map(sensor.medidas.map((m) => [m.id, m]));

    const desconhecida = medidas.find(
      (m) => m.id !== undefined && !atuais.has(m.id),
    );
    if (desconhecida)
      throw new BadRequestException(
        `O dado "${desconhecida.nome}" não pertence a este sensor.`,
      );

    const mantidas = new Set(medidas.map((m) => m.id).filter(Boolean));
    const removidas = sensor.medidas.filter((m) => !mantidas.has(m.id));
    if (removidas.length) {
      const comValores = await this.prisma.leituras_valores.groupBy({
        by: ['medida_id'],
        where: { medida_id: { in: removidas.map((m) => m.id) } },
      });
      if (comValores.length) {
        const nomes = removidas
          .filter((m) => comValores.some((v) => v.medida_id === m.id))
          .map((m) => `"${m.nome}"`)
          .join(', ');
        throw new ConflictException(
          `Não é possível remover ${nomes}: já há leituras gravadas. Renomeie o dado em vez de removê-lo.`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.sensor_medidas.deleteMany({
        where: { id: { in: removidas.map((m) => m.id) } },
      });
      const existentes = medidas.filter((m) => m.id !== undefined);
      // chaves temporárias evitam conflito do UNIQUE ao trocar chaves entre dados
      for (const m of existentes)
        await tx.sensor_medidas.update({
          where: { id: m.id },
          data: { chave: `__${m.id}` },
        });
      for (const m of existentes)
        await tx.sensor_medidas.update({
          where: { id: m.id },
          data: {
            chave: m.chave,
            nome: m.nome,
            unidade: m.unidade,
            tipo: m.tipo,
          },
        });
      const novas = medidas.filter((m) => m.id === undefined);
      if (novas.length)
        await tx.sensor_medidas.createMany({
          data: novas.map((m) => ({
            sensor_id: id,
            chave: m.chave,
            nome: m.nome,
            unidade: m.unidade,
            tipo: m.tipo,
          })),
        });
    });
    // a ingestão guarda as chaves do sensor em cache
    await this.redis.remover(chaveSensor(sensor.codigo_sensor));

    const atualizado = await this.carregar(user, id);
    const acessos = await this.acessos();
    const ativo = acessos?.get(atualizado.codigo_sensor);
    return toDto(
      atualizado,
      !acessos
        ? null
        : ativo === undefined
          ? 'sem_acesso'
          : ativo
            ? 'ativo'
            : 'inativo',
    );
  }

  /**
   * Gera uma nova senha. Se o sensor ainda não tem login no broker (ex.:
   * cadastrado antes da integração), cria o login agora.
   */
  async gerarNovaSenha(user: JwtPayload, id: number) {
    const sensor = await this.carregar(user, id);
    const username = sensor.codigo_sensor;
    const empresaId = sensor.propriedades.empresa_id;
    const senha = gerarSenha();

    try {
      await this.dynsec.alterarSenha(username, senha);
    } catch (erro) {
      if (!(erro instanceof NotFoundException)) throw erro;

      await this.dispositivos.garantirRoleEmpresa(empresaId);
      await this.dynsec.criarCliente({
        username,
        password: senha,
        textname: descricao(
          sensor,
          sensor.propriedades,
          sensor.lotes && {
            nome_identificacao: sensor.lotes.nome_identificacao,
          },
        ),
        roles: [roleEmpresa(empresaId)],
      });
      if (sensor.status === 'INATIVO')
        await this.dynsec.ativarCliente(username, false);
    }
    return { username, senha, empresa_id: empresaId };
  }

  async remover(user: JwtPayload, id: number) {
    const sensor = await this.carregar(user, id);
    // a FK apaga as leituras em cascata; histórico não se perde por engano
    if (sensor._count.leituras_sensores > 0)
      throw new ConflictException(
        `O sensor tem ${sensor._count.leituras_sensores} leituras registradas. Desative-o em vez de excluir.`,
      );

    await this.prisma.$transaction(async (tx) => {
      await tx.sensores.delete({ where: { id } });
      await this.dynsec
        .removerCliente(sensor.codigo_sensor)
        .catch((erro: unknown) => {
          if (!(erro instanceof NotFoundException)) throw erro;
        });
    }, TRANSACAO);
    await this.redis.remover(chaveSensor(sensor.codigo_sensor));
    this.logger.log(`Sensor ${sensor.codigo_sensor} excluído.`);
  }
}
