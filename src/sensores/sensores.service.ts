import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { escopoPropriedades, escopoSensores } from '../auth/escopo.js';
import {
  DispositivosService,
  gerarSenha,
  roleEmpresa,
} from '../mqtt/dispositivos.service.js';
import { DynsecService } from '../mqtt/dynsec.service.js';
import { chaveSensor } from '../leituras/ingestao.service.js';
import { dataIso } from '../common/validacao.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

export type StatusSensor = 'ATIVO' | 'INATIVO' | 'MANUTENCAO';
export const STATUS_SENSOR: StatusSensor[] = ['ATIVO', 'INATIVO', 'MANUTENCAO'];

// codigo_sensor é VARCHAR(50) e também é o username do sensor no broker
const CODIGO_MAX = 50;
// o broker precisa responder dentro da transação do banco
const TRANSACAO = { timeout: 15_000 };

export interface NovoSensor {
  identificador: string;
  tipo: string;
  propriedade_id: number;
  data_instalacao: Date | null;
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
  _count: { select: { leituras_sensores: true } },
} as const;

type SensorRow = {
  id: number;
  codigo_sensor: string;
  tipo: string;
  status: string | null;
  data_instalacao: Date | null;
  propriedades: {
    id: number;
    nome: string;
    empresa_id: number;
    empresas: { id: number; razao_social: string };
  };
  _count: { leituras_sensores: number };
};

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
    empresa: sensor.propriedades.empresas,
    total_leituras: sensor._count.leituras_sensores,
    acesso_mqtt: acesso,
  };
}

const descricao = (sensor: { tipo: string }, propriedade: { nome: string }) =>
  `${sensor.tipo} · ${propriedade.nome}`.slice(0, 100);

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
    const propriedade = await this.prisma.propriedades.findFirst({
      where: { id: dados.propriedade_id, ...escopoPropriedades(user) },
      select: { id: true, nome: true, empresa_id: true },
    });
    if (!propriedade)
      throw new BadRequestException('Propriedade não encontrada.');

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
          data_instalacao: dados.data_instalacao,
          status: 'ATIVO',
        },
        select: sensorSelect,
      });
      await this.dynsec.criarCliente({
        username: codigo,
        password: senha,
        textname: descricao(dados, propriedade),
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
        textname: descricao(sensor, sensor.propriedades),
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
