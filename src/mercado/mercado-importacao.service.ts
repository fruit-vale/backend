import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  COMEX_STAT,
  CONAB,
  NCM_DA_FRUTA,
  acumularAtacado,
  fruta,
  lerLinhaAtacado,
  lerLinhaComex,
  lerLinhaProdutor,
  type LinhaAtacado,
  type LinhaExportacao,
} from './fontes.js';

export const FONTES = ['atacado', 'produtor', 'exportacao'] as const;
export type Fonte = (typeof FONTES)[number];

const HORA_MS = 3_600_000;
// a Conab atualiza os arquivos uma vez por mês; uma semana basta
const IDADE_MAXIMA_MS = 7 * 24 * HORA_MS;
const VERIFICAR_A_CADA_MS = 6 * HORA_MS;
// espera a API terminar de subir antes da primeira verificação
const PRIMEIRA_VERIFICACAO_MS = 2 * 60_000;
const LOTE_GRAVACAO = 5_000;
// anos de histórico de exportação
const ANOS_EXPORTACAO = 3;
const COMEX_ESPERA_429_MS = 11_000;
const COMEX_TENTATIVAS = 6;

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** As linhas de um arquivo de texto em Latin-1, lidas enquanto ele baixa. */
export async function* linhasDe(url: string): AsyncGenerator<string> {
  const resposta = await fetch(url);
  if (!resposta.ok || !resposta.body)
    throw new Error(`HTTP ${resposta.status} ao baixar ${url}`);
  const texto = resposta.body.pipeThrough(new TextDecoderStream('latin1'));
  let resto = '';
  for await (const pedaco of texto) {
    resto += pedaco;
    const linhas = resto.split(/\r?\n/);
    resto = linhas.pop() ?? '';
    yield* linhas;
  }
  if (resto) yield resto;
}

/** "AAAA-MM" de um mês contado a partir de agora (0 = este mês, -1 = o anterior). */
function anoMes(deslocamento: number, agora = new Date()) {
  const d = new Date(agora.getFullYear(), agora.getMonth() + deslocamento, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Importa os dados públicos de mercado: Conab (atacado nas Ceasas e preço ao
 * produtor) e Comex Stat (exportações). Em produção roda sozinha, quando a
 * última importação de uma fonte tem mais de uma semana; o administrador também
 * pode pedir na hora (POST /mercado/atualizar).
 */
@Injectable()
export class MercadoImportacaoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MercadoImportacaoService.name);
  private readonly rodando = new Set<Fonte>();
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // fora de produção não baixa nada sozinho (o arquivo do atacado tem ~480 MB)
    const automatico =
      process.env.MERCADO_IMPORTACAO === 'on' ||
      (process.env.NODE_ENV === 'production' &&
        process.env.MERCADO_IMPORTACAO !== 'off');
    if (!automatico) return;
    this.timers.push(
      setTimeout(() => void this.verificar(), PRIMEIRA_VERIFICACAO_MS),
      setInterval(() => void this.verificar(), VERIFICAR_A_CADA_MS),
    );
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** Importa as fontes desatualizadas, uma de cada vez. */
  async verificar() {
    for (const fonte of FONTES) {
      const ultima = await this.prisma.mercado_importacoes.findUnique({
        where: { fonte },
      });
      const idade = ultima?.concluido_em
        ? Date.now() - ultima.concluido_em.getTime()
        : Infinity;
      if (idade > IDADE_MAXIMA_MS) await this.importar(fonte);
    }
  }

  /** Pede a importação sem esperar terminar; devolve as fontes que começaram. */
  iniciar(fontes: readonly Fonte[] = FONTES) {
    const iniciadas = fontes.filter((f) => !this.rodando.has(f));
    void (async () => {
      for (const f of iniciadas) await this.importar(f);
    })();
    return iniciadas;
  }

  emAndamento() {
    return [...this.rodando];
  }

  async importar(fonte: Fonte) {
    if (this.rodando.has(fonte)) return;
    this.rodando.add(fonte);
    const inicio = new Date();
    await this.prisma.mercado_importacoes.upsert({
      where: { fonte },
      create: { fonte, iniciado_em: inicio },
      update: { iniciado_em: inicio, erro: null },
    });
    try {
      const linhas =
        fonte === 'atacado'
          ? await this.importarAtacado()
          : fonte === 'produtor'
            ? await this.importarProdutor()
            : await this.importarExportacao();
      await this.prisma.mercado_importacoes.update({
        where: { fonte },
        data: { concluido_em: new Date(), linhas, erro: null },
      });
      this.logger.log(`Mercado: ${fonte} importado (${linhas} linhas).`);
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      this.logger.error(`Mercado: falha ao importar ${fonte}: ${erro}`);
      await this.prisma.mercado_importacoes.update({
        where: { fonte },
        data: { erro: erro.slice(0, 2000) },
      });
    } finally {
      this.rodando.delete(fonte);
    }
  }

  /**
   * Só as frutas das culturas cadastradas: o arquivo do atacado tem todas as
   * frutas e hortaliças das Ceasas (só banana e laranja passam de 100 mil linhas).
   * Uma cultura nova entra na importação seguinte.
   */
  private async frutas() {
    const culturas = await this.prisma.culturas.findMany({
      select: { nome: true },
    });
    return new Set(culturas.map((c) => fruta(c.nome)).filter(Boolean));
  }

  private async importarAtacado() {
    const frutas = await this.frutas();
    const somas = new Map<string, LinhaAtacado>();
    for await (const texto of linhasDe(CONAB.atacado)) {
      const l = lerLinhaAtacado(texto);
      if (!l || !frutas.has(fruta(l.produto))) continue;
      acumularAtacado(somas, l);
    }
    const linhas = [...somas.values()].map((l) => ({
      ...l,
      quantidade_kg: Math.round(l.quantidade_kg * 100) / 100,
      valor_rs: Math.round(l.valor_rs * 100) / 100,
    }));
    await this.substituir('precos_atacado', linhas);
    return linhas.length;
  }

  private async importarProdutor() {
    const frutas = await this.frutas();
    const linhas = [];
    for await (const texto of linhasDe(CONAB.produtor)) {
      const l = lerLinhaProdutor(texto);
      if (l && frutas.has(fruta(l.produto))) linhas.push(l);
    }
    await this.substituir('precos_produtor', linhas);
    return linhas.length;
  }

  private async importarExportacao() {
    const ncms = [...(await this.frutas())]
      .map((f) => NCM_DA_FRUTA[f])
      .filter((n): n is string => !!n);
    const linhas: LinhaExportacao[] = [];
    const de = `${new Date().getFullYear() - ANOS_EXPORTACAO}-01`;
    for (const ncm of new Set(ncms)) {
      for (const linha of await this.consultarComex(ncm, de)) {
        const l = lerLinhaComex(ncm, linha);
        if (l) linhas.push(l);
      }
      await esperar(2_000); // educado com o limite da API
    }
    await this.substituir('exportacoes', linhas);
    return linhas.length;
  }

  /**
   * Exportações mensais de um NCM por país. Os dados saem com um ou dois meses
   * de atraso: se o mês final ainda não existe, tenta o anterior.
   */
  private async consultarComex(ncm: string, de: string) {
    for (const atraso of [-1, -2, -3]) {
      const corpo = {
        flow: 'export',
        monthDetail: true,
        period: { from: de, to: anoMes(atraso) },
        filters: [{ filter: 'ncm', values: [ncm] }],
        details: ['country'],
        metrics: ['metricFOB', 'metricKG'],
      };
      for (let tentativa = 1; tentativa <= COMEX_TENTATIVAS; tentativa++) {
        const resposta = await fetch(COMEX_STAT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        });
        // limite de requisições: a própria API pede para esperar 10 s
        if (resposta.status === 429) {
          await esperar(COMEX_ESPERA_429_MS);
          continue;
        }
        const json = (await resposta.json().catch(() => ({}))) as {
          data?: { list?: Record<string, unknown>[] };
          error?: { message?: string };
        };
        if (resposta.ok) return json.data?.list ?? [];
        if (/per[ií]odo/i.test(json.error?.message ?? '')) break; // mês ainda sem dados
        throw new Error(
          `Comex Stat ${resposta.status}: ${json.error?.message ?? 'erro'}`,
        );
      }
    }
    throw new Error(`Comex Stat não respondeu para o NCM ${ncm}.`);
  }

  /** Troca todas as linhas de uma fonte numa transação (sem janela vazia). */
  private async substituir(
    tabela: 'precos_atacado' | 'precos_produtor' | 'exportacoes',
    linhas: object[],
  ) {
    await this.prisma.$transaction(
      async (tx) => {
        const delegado = tx[tabela] as unknown as {
          deleteMany: () => Promise<unknown>;
          createMany: (args: { data: object[] }) => Promise<unknown>;
        };
        await delegado.deleteMany();
        for (let i = 0; i < linhas.length; i += LOTE_GRAVACAO)
          await delegado.createMany({
            data: linhas.slice(i, i + LOTE_GRAVACAO),
          });
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
  }
}
