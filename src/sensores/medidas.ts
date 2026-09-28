import { BadRequestException } from '@nestjs/common';

/** Dados que um sensor envia, definidos pelo produtor no cadastro. */

export type TipoMedida =
  | 'TEMPERATURA'
  | 'UMIDADE'
  | 'PH'
  | 'LUMINOSIDADE'
  | 'PRECIPITACAO'
  | 'UMIDADE_SOLO'
  | 'OUTRO';

export const TIPOS_MEDIDA: TipoMedida[] = [
  'TEMPERATURA',
  'UMIDADE',
  'PH',
  'LUMINOSIDADE',
  'PRECIPITACAO',
  'UMIDADE_SOLO',
  'OUTRO',
];

/** Unidade sugerida quando o produtor não informa. */
export const UNIDADE_PADRAO: Record<TipoMedida, string | null> = {
  TEMPERATURA: '°C',
  UMIDADE: '%',
  PH: null,
  LUMINOSIDADE: 'lux',
  PRECIPITACAO: 'mm',
  UMIDADE_SOLO: '%',
  OUTRO: null,
};

/**
 * Coluna fixa de leituras_sensores preenchida pelo tipo (compatibilidade com
 * alertas e faixas da cultura) e o limite exclusivo dela (DECIMAL(p, 2)).
 */
export const COLUNA_FIXA: Partial<
  Record<
    TipoMedida,
    {
      coluna:
        | 'temperatura'
        | 'umidade'
        | 'ph'
        | 'luminosidade'
        | 'precipitacao'
        | 'umidade_solo';
      limite: number;
    }
  >
> = {
  TEMPERATURA: { coluna: 'temperatura', limite: 1_000 },
  UMIDADE: { coluna: 'umidade', limite: 1_000 },
  PH: { coluna: 'ph', limite: 10_000 },
  LUMINOSIDADE: { coluna: 'luminosidade', limite: 1_000_000 },
  PRECIPITACAO: { coluna: 'precipitacao', limite: 1_000 },
  UMIDADE_SOLO: { coluna: 'umidade_solo', limite: 1_000 },
};

export const MEDIDAS_MAX = 20;
// chave no JSON: minúsculas, números e _, começando por letra
const CHAVE_VALIDA = /^[a-z][a-z0-9_]{0,39}$/;
// campo reservado da mensagem (horário da leitura)
const CHAVES_RESERVADAS = ['data_hora'];

export interface MedidaEntrada {
  /** Presente ao editar uma medida existente. */
  id?: number;
  nome: string;
  chave: string;
  unidade: string | null;
  tipo: TipoMedida;
}

/** "Temperatura do ar" → "temperatura_do_ar" */
export function gerarChave(nome: string) {
  const chave = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(chave) ? chave : `m_${chave}`.slice(0, 40);
}

const erro = (indice: number, msg: string) =>
  new BadRequestException(`Dado ${indice + 1}: ${msg}`);

function lerMedida(valor: unknown, i: number): MedidaEntrada {
  const m = (valor ?? {}) as Record<string, unknown>;

  if (typeof m.nome !== 'string' || !m.nome.trim())
    throw erro(i, 'informe o nome.');
  const nome = m.nome.trim();
  if (nome.length > 60) throw erro(i, 'o nome deve ter até 60 caracteres.');

  const tipo = (m.tipo ?? 'OUTRO') as TipoMedida;
  if (!TIPOS_MEDIDA.includes(tipo))
    throw erro(i, `tipo inválido. Use: ${TIPOS_MEDIDA.join(', ')}.`);

  // ausente: unidade padrão do tipo; vazia: sem unidade
  let unidade = UNIDADE_PADRAO[tipo];
  if (m.unidade !== undefined) {
    if (m.unidade !== null && typeof m.unidade !== 'string')
      throw erro(i, 'a unidade deve ser texto.');
    unidade = (m.unidade as string | null)?.trim() || null;
    if (unidade && unidade.length > 20)
      throw erro(i, 'a unidade deve ter até 20 caracteres.');
  }

  let chave = gerarChave(nome);
  if (m.chave !== undefined && m.chave !== null && m.chave !== '') {
    if (typeof m.chave !== 'string') throw erro(i, 'a chave deve ser texto.');
    chave = m.chave.trim();
  }
  if (!CHAVE_VALIDA.test(chave))
    throw erro(
      i,
      'a chave deve ter até 40 caracteres entre letras minúsculas, números e _, começando por letra.',
    );
  if (CHAVES_RESERVADAS.includes(chave))
    throw erro(i, `a chave "${chave}" é reservada.`);

  if (m.id !== undefined && !Number.isInteger(m.id))
    throw erro(i, 'id inválido.');
  return { id: m.id as number | undefined, nome, chave, unidade, tipo };
}

/** Lista de dados do sensor: de 1 a MEDIDAS_MAX, com chaves únicas. */
export function lerMedidas(valor: unknown): MedidaEntrada[] {
  if (!Array.isArray(valor) || valor.length === 0)
    throw new BadRequestException(
      'Informe pelo menos um dado que o sensor envia (ex.: temperatura).',
    );
  if (valor.length > MEDIDAS_MAX)
    throw new BadRequestException(
      `Um sensor pode enviar até ${MEDIDAS_MAX} dados.`,
    );

  const medidas = valor.map(lerMedida);
  const repetida = medidas.find(
    (m, i) => medidas.findIndex((o) => o.chave === m.chave) !== i,
  );
  if (repetida)
    throw new BadRequestException(
      `A chave "${repetida.chave}" aparece mais de uma vez; cada dado precisa de uma chave única.`,
    );
  return medidas;
}
