import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { escopoPropriedades } from '../auth/escopo.js';
import { toRole } from '../auth/roles.js';
import { Prisma } from '../generated/prisma/client.js';
import { poligonoDentro, type Poligono } from '../lotes/geometria.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type StatusPropriedade = 'ATIVA' | 'INATIVA';
export const STATUS_PROPRIEDADE: StatusPropriedade[] = ['ATIVA', 'INATIVA'];

export interface DadosPropriedade {
  nome: string;
  municipio: string;
  estado: string;
  latitude: number | null;
  longitude: number | null;
  area_total_ha: number | null;
  /** contorno desenhado no mapa; a área e o ponto acima saem dele */
  geometria: Poligono;
  /** Opcional; ausente (undefined) mantém o responsável atual. */
  produtor_responsavel_id?: number | null;
  status: StatusPropriedade;
}

const propriedadeSelect = {
  id: true,
  nome: true,
  municipio: true,
  estado: true,
  latitude: true,
  longitude: true,
  area_total_ha: true,
  geometria: true,
  status: true,
  empresa_id: true,
  empresas: { select: { id: true, razao_social: true } },
  usuarios: { select: { id: true, nome: true } },
  _count: { select: { lotes: true, sensores: true } },
} as const;

type PropriedadeRow = Prisma.propriedadesGetPayload<{
  select: typeof propriedadeSelect;
}>;

function toDto(p: PropriedadeRow) {
  return {
    id: p.id,
    nome: p.nome,
    municipio: p.municipio,
    estado: p.estado,
    // Decimal vira número (o mapa centraliza na propriedade)
    latitude: p.latitude?.toNumber() ?? null,
    longitude: p.longitude?.toNumber() ?? null,
    area_total_ha: p.area_total_ha?.toNumber() ?? null,
    geometria: p.geometria as Poligono | null,
    status: (p.status ?? 'ATIVA') as StatusPropriedade,
    empresa_id: p.empresa_id,
    empresa: p.empresas,
    produtor_responsavel: p.usuarios,
    total_lotes: p._count.lotes,
    total_sensores: p._count.sensores,
  };
}

/** O JSON do contorno vai para a coluna jsonb. */
const gravacao = ({ geometria, ...dados }: DadosPropriedade) => ({
  ...dados,
  geometria: geometria as unknown as Prisma.InputJsonValue,
});

/**
 * Propriedades das empresas. Cadastro e edição são do administrador; os
 * demais perfis só consultam as da própria empresa.
 */
@Injectable()
export class PropriedadesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(user: JwtPayload) {
    const propriedades = await this.prisma.propriedades.findMany({
      where: escopoPropriedades(user),
      select: propriedadeSelect,
      orderBy: [{ empresas: { razao_social: 'asc' } }, { nome: 'asc' }],
    });
    return propriedades.map(toDto);
  }

  /** Responsável precisa ser um produtor da mesma empresa. */
  private async validarResponsavel(
    empresaId: number,
    usuarioId: number | null | undefined,
  ) {
    if (usuarioId === null || usuarioId === undefined) return;
    const usuario = await this.prisma.usuarios.findUnique({
      where: { id: usuarioId },
      select: { empresa_id: true, tipo_usuario: true },
    });
    if (
      !usuario ||
      usuario.empresa_id !== empresaId ||
      toRole(usuario.tipo_usuario) !== 'produtor'
    )
      throw new BadRequestException(
        'O responsável deve ser um produtor da mesma empresa.',
      );
  }

  private async garantirNomeUnico(
    empresaId: number,
    nome: string,
    ignorarId?: number,
  ) {
    const repetida = await this.prisma.propriedades.findFirst({
      where: {
        empresa_id: empresaId,
        nome: { equals: nome, mode: 'insensitive' },
        ...(ignorarId && { id: { not: ignorarId } }),
      },
      select: { id: true },
    });
    if (repetida)
      throw new ConflictException(
        'Já existe uma propriedade com esse nome nesta empresa.',
      );
  }

  async criar(empresaId: number, dados: DadosPropriedade) {
    const empresa = await this.prisma.empresas.findUnique({
      where: { id: empresaId },
      select: { id: true },
    });
    if (!empresa) throw new BadRequestException('Empresa não encontrada.');
    await this.validarResponsavel(empresaId, dados.produtor_responsavel_id);
    await this.garantirNomeUnico(empresaId, dados.nome);

    const propriedade = await this.prisma.propriedades.create({
      data: { ...gravacao(dados), empresa_id: empresaId },
      select: propriedadeSelect,
    });
    return toDto(propriedade);
  }

  private async carregar(id: number) {
    const propriedade = await this.prisma.propriedades.findUnique({
      where: { id },
      select: propriedadeSelect,
    });
    if (!propriedade)
      throw new NotFoundException('Propriedade não encontrada.');
    return propriedade;
  }

  /**
   * A empresa não muda depois do cadastro: lotes, sensores (e o acesso MQTT
   * deles) e culturas dependem dela.
   */
  async alterar(id: number, dados: DadosPropriedade) {
    const atual = await this.carregar(id);
    await this.validarResponsavel(
      atual.empresa_id,
      dados.produtor_responsavel_id,
    );
    await this.garantirNomeUnico(atual.empresa_id, dados.nome, id);
    await this.garantirLotesDentro(id, dados.geometria);

    const propriedade = await this.prisma.propriedades.update({
      where: { id },
      data: gravacao(dados),
      select: propriedadeSelect,
    });
    return toDto(propriedade);
  }

  /** O novo contorno não pode deixar lote desenhado do lado de fora. */
  private async garantirLotesDentro(id: number, geometria: Poligono) {
    const lotes = await this.prisma.lotes.findMany({
      where: {
        propriedade_id: id,
        NOT: { geometria: { equals: Prisma.DbNull } },
      },
      select: { nome_identificacao: true, geometria: true },
    });
    const fora = lotes.filter(
      (l) =>
        l.geometria &&
        !poligonoDentro(l.geometria as unknown as Poligono, geometria),
    );
    if (fora.length)
      throw new BadRequestException(
        `A nova área deixaria de fora ${fora.length === 1 ? 'o lote' : 'os lotes'} ${fora
          .map((l) => l.nome_identificacao)
          .join(
            ', ',
          )}. Aumente a área ou ajuste o contorno desses lotes antes.`,
      );
  }

  async remover(id: number) {
    const { _count } = await this.carregar(id);
    // a FK apagaria lotes, sensores e leituras em cascata
    if (_count.lotes || _count.sensores)
      throw new ConflictException(
        `A propriedade tem ${_count.lotes} lote(s) e ${_count.sensores} sensor(es). Marque-a como inativa em vez de excluir.`,
      );
    await this.prisma.propriedades.delete({ where: { id } });
  }
}
