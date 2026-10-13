import { Injectable, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '../auth/decorators.js';
import { escopoCulturas } from '../auth/escopo.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  NCM_DA_FRUTA,
  fruta,
  normalizar,
  produtoDaVariedade,
} from './fontes.js';
import { MercadoImportacaoService } from './mercado-importacao.service.js';

/** Os meses são filtrados como número corrido: ano × 12 + mês − 1. */
const doIndice = (i: number) => ({
  ano: Math.floor(i / 12),
  mes: (i % 12) + 1,
});
const r2 = (n: number) => Math.round(n * 100) / 100;

type Cultura = { id: number; nome: string; variedade: string | null };

/** Consultas da tela Mercado e Exportação (dados públicos, por cultura). */
@Injectable()
export class MercadoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importacao: MercadoImportacaoService,
  ) {}

  private async cultura(user: JwtPayload, id: number): Promise<Cultura> {
    const c = await this.prisma.culturas.findFirst({
      where: { id, ...escopoCulturas(user) },
      select: { id: true, nome: true, variedade: true },
    });
    if (!c) throw new NotFoundException('Cultura não encontrada.');
    return c;
  }

  /** Nomes da Conab para a fruta: "MANGA", "MANGA PALMER", "MANGA TOMMY"… */
  private async produtos(
    tabela: 'precos_atacado' | 'precos_produtor',
    f: string,
  ) {
    const linhas = await this.prisma.$queryRaw<{ produto: string }[]>`
      SELECT DISTINCT produto FROM ${Prisma.raw(tabela)}
      WHERE produto = ${f} OR produto LIKE ${`${f} %`}
      ORDER BY produto`;
    return linhas.map((l) => l.produto);
  }

  /** As culturas visíveis ao usuário e quais dados de mercado existem para cada uma. */
  async culturas(user: JwtPayload) {
    const culturas = await this.prisma.culturas.findMany({
      where: escopoCulturas(user),
      select: { id: true, nome: true, variedade: true },
      orderBy: [{ nome: 'asc' }, { variedade: 'asc' }],
    });
    return Promise.all(
      culturas.map(async (c) => {
        const f = fruta(c.nome);
        const [atacado, produtor] = await Promise.all([
          this.produtos('precos_atacado', f),
          this.produtos('precos_produtor', f),
        ]);
        return {
          ...c,
          produtos_atacado: atacado,
          tem_preco_produtor: produtor.length > 0,
          ncm: NCM_DA_FRUTA[f] ?? null,
        };
      }),
    );
  }

  /**
   * Atacado (Conab PROHORT): preço médio ponderado (R$ ÷ kg) mês a mês, as Ceasas
   * no último mês, de onde vem a fruta e o preço típico de cada mês do ano.
   */
  async atacado(
    user: JwtPayload,
    culturaId: number,
    meses: number,
    produto?: string,
  ) {
    const cultura = await this.cultura(user, culturaId);
    const f = fruta(cultura.nome);
    const produtos = await this.produtos('precos_atacado', f);
    // sem variedade escolhida: a da cultura, se a Conab tiver; senão todas da fruta
    const escolhido = produto
      ? normalizar(produto)
      : produtoDaVariedade(f, cultura.variedade, produtos);
    const filtro = escolhido
      ? Prisma.sql`produto = ${escolhido}`
      : produtos.length
        ? Prisma.sql`produto IN (${Prisma.join(produtos)})`
        : Prisma.sql`false`;

    const [{ ultimo } = { ultimo: null }] = await this.prisma.$queryRaw<
      { ultimo: number | null }[]
    >`
      SELECT max(ano * 12 + mes - 1)::int AS ultimo FROM precos_atacado WHERE ${filtro}`;
    const vazio = {
      cultura,
      produtos,
      produto: escolhido,
      referencia: null,
      serie: [],
      ceasas: [],
      origens: [],
      sazonalidade: [],
    };
    if (ultimo === null) return vazio;
    const inicio = ultimo - meses + 1;

    const [serie, ceasas, origens, sazonalidade] = await Promise.all([
      this.prisma.$queryRaw<
        { ano: number; mes: number; kg: number; valor: number }[]
      >`
        SELECT ano, mes, sum(quantidade_kg)::float8 AS kg, sum(valor_rs)::float8 AS valor
        FROM precos_atacado WHERE ${filtro} AND ano * 12 + mes - 1 BETWEEN ${inicio} AND ${ultimo}
        GROUP BY ano, mes ORDER BY ano, mes`,
      this.prisma.$queryRaw<
        { ceasa: string; uf: string; kg: number; valor: number }[]
      >`
        SELECT ceasa, uf_ceasa AS uf, sum(quantidade_kg)::float8 AS kg, sum(valor_rs)::float8 AS valor
        FROM precos_atacado WHERE ${filtro} AND ano * 12 + mes - 1 = ${ultimo}
        GROUP BY ceasa, uf_ceasa`,
      this.prisma.$queryRaw<{ municipio: string; uf: string; kg: number }[]>`
        SELECT municipio_origem AS municipio, uf_origem AS uf, sum(quantidade_kg)::float8 AS kg
        FROM precos_atacado WHERE ${filtro} AND ano * 12 + mes - 1 BETWEEN ${inicio} AND ${ultimo}
        GROUP BY municipio_origem, uf_origem ORDER BY kg DESC LIMIT 10`,
      this.prisma.$queryRaw<{ mes: number; kg: number; valor: number }[]>`
        SELECT mes, sum(quantidade_kg)::float8 AS kg, sum(valor_rs)::float8 AS valor
        FROM precos_atacado WHERE ${filtro} GROUP BY mes ORDER BY mes`,
    ]);
    const totalOrigem = (
      await this.prisma.$queryRaw<{ kg: number }[]>`
        SELECT coalesce(sum(quantidade_kg), 0)::float8 AS kg FROM precos_atacado
        WHERE ${filtro} AND ano * 12 + mes - 1 BETWEEN ${inicio} AND ${ultimo}`
    )[0].kg;

    return {
      ...vazio,
      referencia: doIndice(ultimo),
      serie: serie.map((s) => ({
        ano: s.ano,
        mes: s.mes,
        preco_kg: r2(s.valor / s.kg),
        quantidade_kg: Math.round(s.kg),
      })),
      // onde a fruta foi vendida mais cara no último mês
      ceasas: ceasas
        .map((c) => ({
          ceasa: c.ceasa,
          uf: c.uf,
          preco_kg: r2(c.valor / c.kg),
          quantidade_kg: Math.round(c.kg),
        }))
        .sort((a, b) => b.preco_kg - a.preco_kg),
      origens: origens.map((o) => ({
        municipio: o.municipio,
        uf: o.uf,
        quantidade_kg: Math.round(o.kg),
        participacao: totalOrigem
          ? Math.round((o.kg / totalOrigem) * 1000) / 10
          : 0,
      })),
      // preço típico de cada mês do ano, em todo o histórico (época de vender)
      sazonalidade: sazonalidade.map((s) => ({
        mes: s.mes,
        preco_kg: r2(s.valor / s.kg),
      })),
    };
  }

  /** Preço recebido pelo produtor (Conab), média dos estados por mês e o último mês por estado. */
  async produtor(user: JwtPayload, culturaId: number, meses: number) {
    const cultura = await this.cultura(user, culturaId);
    const f = fruta(cultura.nome);
    const filtro = Prisma.sql`(produto = ${f} OR produto LIKE ${`${f} %`})`;
    const [{ ultimo } = { ultimo: null }] = await this.prisma.$queryRaw<
      { ultimo: number | null }[]
    >`
      SELECT max(ano * 12 + mes - 1)::int AS ultimo FROM precos_produtor WHERE ${filtro}`;
    if (ultimo === null)
      return { cultura, referencia: null, serie: [], por_uf: [] };
    const inicio = ultimo - meses + 1;
    const [serie, porUf] = await Promise.all([
      this.prisma.$queryRaw<{ ano: number; mes: number; preco: number }[]>`
        SELECT ano, mes, avg(valor_kg)::float8 AS preco FROM precos_produtor
        WHERE ${filtro} AND ano * 12 + mes - 1 BETWEEN ${inicio} AND ${ultimo}
        GROUP BY ano, mes ORDER BY ano, mes`,
      this.prisma.$queryRaw<{ uf: string; preco: number }[]>`
        SELECT uf, avg(valor_kg)::float8 AS preco FROM precos_produtor
        WHERE ${filtro} AND ano * 12 + mes - 1 = ${ultimo}
        GROUP BY uf ORDER BY preco DESC`,
    ]);
    return {
      cultura,
      referencia: doIndice(ultimo),
      serie: serie.map((s) => ({
        ano: s.ano,
        mes: s.mes,
        preco_kg: r2(s.preco),
      })),
      por_uf: porUf.map((u) => ({ uf: u.uf, preco_kg: r2(u.preco) })),
    };
  }

  /** Exportações (Comex Stat): valor FOB e peso por mês e os principais destinos em 12 meses. */
  async exportacao(user: JwtPayload, culturaId: number, meses: number) {
    const cultura = await this.cultura(user, culturaId);
    const ncm = NCM_DA_FRUTA[fruta(cultura.nome)] ?? null;
    const vazio = {
      cultura,
      ncm,
      referencia: null,
      serie: [],
      paises: [],
      total_12_meses: null,
    };
    if (!ncm) return vazio;
    const [{ ultimo } = { ultimo: null }] = await this.prisma.$queryRaw<
      { ultimo: number | null }[]
    >`
      SELECT max(ano * 12 + mes - 1)::int AS ultimo FROM exportacoes WHERE ncm = ${ncm}`;
    if (ultimo === null) return vazio;
    const inicio = ultimo - meses + 1;
    const [serie, paises] = await Promise.all([
      this.prisma.$queryRaw<
        { ano: number; mes: number; fob: number; kg: number }[]
      >`
        SELECT ano, mes, sum(valor_fob_usd)::float8 AS fob, sum(peso_kg)::float8 AS kg FROM exportacoes
        WHERE ncm = ${ncm} AND ano * 12 + mes - 1 BETWEEN ${inicio} AND ${ultimo}
        GROUP BY ano, mes ORDER BY ano, mes`,
      this.prisma.$queryRaw<{ pais: string; fob: number; kg: number }[]>`
        SELECT pais, sum(valor_fob_usd)::float8 AS fob, sum(peso_kg)::float8 AS kg FROM exportacoes
        WHERE ncm = ${ncm} AND ano * 12 + mes - 1 BETWEEN ${ultimo - 11} AND ${ultimo}
        GROUP BY pais ORDER BY fob DESC`,
    ]);
    const total = paises.reduce(
      (t, p) => ({ fob: t.fob + p.fob, kg: t.kg + p.kg }),
      { fob: 0, kg: 0 },
    );
    return {
      ...vazio,
      referencia: doIndice(ultimo),
      serie: serie.map((s) => ({
        ano: s.ano,
        mes: s.mes,
        valor_fob_usd: Math.round(s.fob),
        peso_kg: Math.round(s.kg),
        usd_kg: s.kg ? r2(s.fob / s.kg) : null,
      })),
      paises: paises.slice(0, 10).map((p) => ({
        pais: p.pais,
        valor_fob_usd: Math.round(p.fob),
        peso_kg: Math.round(p.kg),
        participacao: total.fob
          ? Math.round((p.fob / total.fob) * 1000) / 10
          : 0,
      })),
      total_12_meses: {
        valor_fob_usd: Math.round(total.fob),
        peso_kg: Math.round(total.kg),
        usd_kg: total.kg ? r2(total.fob / total.kg) : null,
      },
    };
  }

  async status() {
    const importacoes = await this.prisma.mercado_importacoes.findMany({
      orderBy: { fonte: 'asc' },
    });
    return {
      importacoes: importacoes.map((i) => ({
        fonte: i.fonte,
        iniciado_em: i.iniciado_em.toISOString(),
        concluido_em: i.concluido_em?.toISOString() ?? null,
        linhas: i.linhas,
        erro: i.erro,
      })),
      em_andamento: this.importacao.emAndamento(),
    };
  }
}
