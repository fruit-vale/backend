// Fontes públicas de mercado e como ler cada uma. Sem acesso a banco nem rede:
// tudo aqui é testável com linhas de exemplo.

/** Conab: arquivos de dados abertos, texto separado por ";", em Latin-1. */
export const CONAB = {
  atacado:
    'https://portaldeinformacoes.conab.gov.br/downloads/arquivos/ProhortMensal.txt',
  produtor:
    'https://portaldeinformacoes.conab.gov.br/downloads/arquivos/PrecosMensalUF.txt',
} as const;

/** Comex Stat (MDIC): API pública, sem chave, com limite de requisições. */
export const COMEX_STAT =
  'https://api-comexstat.mdic.gov.br/general?language=pt';

/** "Mamão Formosa " → "MAMAO FORMOSA" (como a Conab escreve, sem acento). */
export const normalizar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

/** A fruta de um nome de produto ou de cultura: a primeira palavra ("UVA ITALIA" → "UVA"). */
export const fruta = (nome: string) => normalizar(nome).split(' ')[0] ?? '';

/**
 * Código NCM (8 dígitos) da fruta fresca, para o Comex Stat. Só as frutas com
 * código próprio na NCM; as outras ficam sem dados de exportação.
 */
export const NCM_DA_FRUTA: Record<string, string> = {
  ABACATE: '08044000',
  ABACAXI: '08043000',
  BANANA: '08039000',
  GOIABA: '08045010',
  LARANJA: '08051000',
  LIMAO: '08055000',
  MACA: '08081000',
  MAMAO: '08072000',
  MANGA: '08045020',
  MELANCIA: '08071100',
  MELAO: '08071900',
  UVA: '08061000',
};

/**
 * O produto da Conab que corresponde à variedade da cultura, se houver. A Conab
 * abrevia: a cultura "Manga / Tommy Atkins" é "MANGA TOMMY" lá.
 */
export function produtoDaVariedade(
  frutaDaCultura: string,
  variedade: string | null,
  produtos: string[],
): string | null {
  if (!variedade) return null;
  const v = normalizar(variedade);
  const resto = (p: string) => p.slice(frutaDaCultura.length + 1);
  const comVariedade = produtos.filter((p) =>
    p.startsWith(`${frutaDaCultura} `),
  );
  return (
    comVariedade.find((p) => resto(p) === v) ??
    comVariedade.find((p) => v.startsWith(`${resto(p)} `)) ??
    comVariedade.find((p) => resto(p).startsWith(v.split(' ')[0])) ??
    null
  );
}

/** "1.234,5" ou "1234.5" → 1234.5; vazio ou inválido → null. */
export function numero(texto: string | undefined): number | null {
  const t = (texto ?? '').trim();
  if (!t) return null;
  // com vírgula, o ponto é separador de milhar (padrão brasileiro)
  const n = Number(
    t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t,
  );
  return Number.isFinite(n) ? n : null;
}

const campos = (linha: string) => linha.split(';').map((c) => c.trim());

/** Uma linha de ProhortMensal.txt já interpretada. */
export interface LinhaAtacado {
  ano: number;
  mes: number;
  produto: string;
  ceasa: string;
  uf_ceasa: string;
  municipio_origem: string;
  uf_origem: string;
  quantidade_kg: number;
  valor_rs: number;
}

/**
 * id_ano;id_mes;municipio_origem;cod_ibge_origem;uf_origem;dsc_ceasa;uf_ceasa;
 * municipio_ceasa;cod_ibge_ceasa;dsc_produto;qtd_kg;valor;pais_origem
 * Devolve null no cabeçalho, em linhas quebradas e nas sem quantidade ou valor.
 */
export function lerLinhaAtacado(linha: string): LinhaAtacado | null {
  const c = campos(linha);
  if (c.length < 12) return null;
  const ano = Number(c[0]);
  const mes = Number(c[1]);
  const quantidade = numero(c[10]);
  const valor = numero(c[11]);
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12)
    return null;
  if (!quantidade || quantidade <= 0 || valor === null || valor < 0)
    return null;
  return {
    ano,
    mes,
    produto: normalizar(c[9]).slice(0, 80),
    ceasa: c[5].replace(/\s+/g, ' ').slice(0, 120),
    uf_ceasa: c[6].slice(0, 2).toUpperCase(),
    municipio_origem: c[2].replace(/\s+/g, ' ').slice(0, 120),
    uf_origem: c[4].slice(0, 2).toUpperCase(),
    quantidade_kg: quantidade,
    valor_rs: valor,
  };
}

/** Uma linha de PrecosMensalUF.txt (só preço recebido pelo produtor). */
export interface LinhaProdutor {
  ano: number;
  mes: number;
  produto: string;
  classificacao: string;
  uf: string;
  valor_kg: number;
}

/**
 * produto;classificao_produto;id_produto;uf;regiao;ano;mes;
 * dsc_nivel_comercializacao;valor_produto_kg
 * O arquivo mistura preço pago pelo produtor (insumos) e recebido (o que ele
 * vende); só interessa o recebido.
 */
export function lerLinhaProdutor(linha: string): LinhaProdutor | null {
  const c = campos(linha);
  if (c.length < 9) return null;
  if (!normalizar(c[7]).includes('RECEBIDO')) return null;
  const ano = Number(c[5]);
  const mes = Number(c[6]);
  const valor = numero(c[8]);
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12)
    return null;
  if (!valor || valor <= 0) return null;
  return {
    ano,
    mes,
    produto: normalizar(c[0]).slice(0, 80),
    classificacao: normalizar(c[1]).slice(0, 80),
    uf: c[3].slice(0, 2).toUpperCase(),
    valor_kg: valor,
  };
}

/** Uma linha de exportação do Comex Stat (os números chegam como texto). */
export interface LinhaExportacao {
  ano: number;
  mes: number;
  ncm: string;
  pais: string;
  valor_fob_usd: number;
  peso_kg: number;
}

export function lerLinhaComex(
  ncm: string,
  linha: Record<string, unknown>,
): LinhaExportacao | null {
  const ano = Number(linha.year);
  const mes = Number(linha.monthNumber);
  const fob = Number(linha.metricFOB);
  const kg = Number(linha.metricKG);
  const pais = typeof linha.country === 'string' ? linha.country.trim() : '';
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12)
    return null;
  if (!pais || !Number.isFinite(fob) || !Number.isFinite(kg)) return null;
  return {
    ano,
    mes,
    ncm,
    pais: pais.slice(0, 120),
    valor_fob_usd: fob,
    peso_kg: kg,
  };
}

/**
 * Soma a linha às anteriores da mesma chave (o arquivo traz uma linha por
 * variedade, Ceasa, origem e mês, às vezes repetida).
 */
export function acumularAtacado(
  somas: Map<string, LinhaAtacado>,
  l: LinhaAtacado,
) {
  const chave = [
    l.ano,
    l.mes,
    l.produto,
    l.ceasa,
    l.uf_ceasa,
    l.municipio_origem,
    l.uf_origem,
  ].join('|');
  const atual = somas.get(chave);
  if (atual) {
    atual.quantidade_kg += l.quantidade_kg;
    atual.valor_rs += l.valor_rs;
  } else somas.set(chave, { ...l });
}

export function somarAtacado(linhas: Iterable<LinhaAtacado>) {
  const somas = new Map<string, LinhaAtacado>();
  for (const l of linhas) acumularAtacado(somas, l);
  return [...somas.values()];
}
