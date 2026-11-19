import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { ContratoService } from '../contrato/contrato.service.js';
import { chaveSensor } from '../leituras/ingestao.service.js';
import { roleEmpresa } from '../mqtt/dispositivos.service.js';
import { DynsecService } from '../mqtt/dynsec.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

export interface NovaEmpresa {
  razao_social: string;
  cpf_cnpj: string;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  responsavel: string | null;
}

const empresaSelect = {
  id: true,
  razao_social: true,
  cpf_cnpj: true,
  telefone: true,
  email: true,
  cidade: true,
  estado: true,
  responsavel: true,
  contrato_status: true,
  contrato_enviado_em: true,
  contrato_aceito_em: true,
  _count: { select: { usuarios: true } },
} as const;

type EmpresaRow = NovaEmpresa & {
  id: number;
  contrato_status: string;
  contrato_enviado_em: Date | null;
  contrato_aceito_em: Date | null;
  _count: { usuarios: number };
};

function toDto({ _count, ...empresa }: EmpresaRow) {
  return { ...empresa, total_usuarios: _count.usuarios };
}

/** Apagar uma empresa inteira pode demorar mais que o padrão do Prisma. */
const TRANSACAO = { timeout: 60_000 };

@Injectable()
export class EmpresasService {
  private readonly logger = new Logger(EmpresasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contrato: ContratoService,
    private readonly dynsec: DynsecService,
    private readonly redis: RedisService,
  ) {}

  async listar() {
    const empresas = await this.prisma.empresas.findMany({
      select: empresaSelect,
      orderBy: { razao_social: 'asc' },
    });
    return empresas.map(toDto);
  }

  /** Só o nome das empresas com contrato aceito (faixa da landing). */
  async listarNomesPublicos() {
    const empresas = await this.prisma.empresas.findMany({
      where: { contrato_status: 'ACEITO' },
      select: { razao_social: true },
      orderBy: { razao_social: 'asc' },
    });
    return empresas.map((e) => e.razao_social);
  }

  async criar(dados: NovaEmpresa) {
    const existe = await this.prisma.empresas.findUnique({
      where: { cpf_cnpj: dados.cpf_cnpj },
      select: { id: true },
    });
    if (existe)
      throw new ConflictException('Já existe uma empresa com esse CNPJ.');

    // nasce PENDENTE: os usuários da empresa só entram depois do aceite
    const empresa = await this.prisma.empresas.create({
      data: { ...dados, contrato_status: 'PENDENTE' },
      select: { id: true },
    });
    const envio = await this.contrato.emitir(empresa.id);
    const atualizada = await this.prisma.empresas.findUniqueOrThrow({
      where: { id: empresa.id },
      select: empresaSelect,
    });
    return { ...toDto(atualizada), contrato_envio: envio };
  }

  /** Edita os dados cadastrais; o status do contrato não muda. */
  async alterar(id: number, dados: NovaEmpresa) {
    const atual = await this.prisma.empresas.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!atual) throw new NotFoundException('Empresa não encontrada.');

    const repetida = await this.prisma.empresas.findFirst({
      where: { cpf_cnpj: dados.cpf_cnpj, id: { not: id } },
      select: { id: true },
    });
    if (repetida)
      throw new ConflictException('Já existe outra empresa com esse CNPJ.');

    const empresa = await this.prisma.empresas.update({
      where: { id },
      data: dados,
      select: empresaSelect,
    });
    return toDto(empresa);
  }

  /**
   * Exclui a empresa com tudo o que é dela: propriedades (e, em cascata, lotes,
   * ciclos, alertas, sensores e leituras), culturas, usuários e os logins MQTT
   * dos sensores. Tudo ou nada: se o broker falhar, o banco volta atrás.
   */
  async remover(id: number, user: JwtPayload) {
    const empresa = await this.prisma.empresas.findUnique({
      where: { id },
      select: { id: true, razao_social: true },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    if (user.empresa_id === id)
      throw new ForbiddenException(
        'Você não pode excluir a empresa à qual a sua própria conta pertence.',
      );

    const sensores = await this.prisma.sensores.findMany({
      where: { propriedades: { empresa_id: id } },
      select: { codigo_sensor: true },
    });
    const role = roleEmpresa(id);

    await this.prisma.$transaction(async (tx) => {
      // a FK apaga lotes, ciclos, alertas, sensores e leituras junto
      await tx.propriedades.deleteMany({ where: { empresa_id: id } });
      await tx.culturas.deleteMany({ where: { empresa_id: id } });
      await tx.usuarios.deleteMany({ where: { empresa_id: id } });
      await tx.empresas.delete({ where: { id } });

      // logins do broker que pertencem à empresa (sensores e outros dispositivos)
      const { clients } = await this.dynsec.listarClientes<{
        clients: { username: string; roles?: { rolename: string }[] }[];
      }>();
      const logins = clients.filter((c) =>
        c.roles?.some((r) => r.rolename === role),
      );
      for (const { username } of logins)
        await this.ignorarNaoEncontrado(this.dynsec.removerCliente(username));
      await this.ignorarNaoEncontrado(this.dynsec.removerRole(role));
    }, TRANSACAO);

    await Promise.all(
      sensores.map((s) => this.redis.remover(chaveSensor(s.codigo_sensor))),
    );
    this.logger.log(
      `Empresa ${empresa.razao_social} (#${id}) excluída por ${user.email}.`,
    );
  }

  private async ignorarNaoEncontrado(operacao: Promise<unknown>) {
    await operacao.catch((erro: unknown) => {
      if (!(erro instanceof NotFoundException)) throw erro;
    });
  }

  /** Gera um novo link e reenvia o contrato (o link anterior deixa de valer). */
  async reenviarContrato(id: number) {
    const existe = await this.prisma.empresas.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Empresa não encontrada.');
    return this.contrato.emitir(id);
  }
}
