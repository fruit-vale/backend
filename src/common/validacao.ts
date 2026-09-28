import { BadRequestException } from '@nestjs/common';

type Corpo = Record<string, unknown> | undefined;

// nomes exibidos nas mensagens de erro
const ROTULOS: Record<string, string> = {
  nome: 'Nome',
  email: 'E-mail',
  cpf: 'CPF',
  cpf_cnpj: 'CNPJ',
  telefone: 'Telefone',
  razao_social: 'Razão social',
  responsavel: 'Responsável',
  cidade: 'Cidade',
  estado: 'UF',
  variedade: 'Variedade',
  descricao: 'Descrição',
  temp_recomendada_min: 'Temperatura mínima',
  temp_recomendada_max: 'Temperatura máxima',
  umidade_recomendada_min: 'Umidade mínima',
  umidade_recomendada_max: 'Umidade máxima',
  ciclo_medio_dias: 'Ciclo médio (dias)',
  nome_identificacao: 'Identificação do lote',
  data_plantio: 'Data de plantio',
  previsao_colheita: 'Previsão de colheita',
  data_instalacao: 'Data de instalação',
  area_ha: 'Área (ha)',
};

const rotulo = (campo: string) => ROTULOS[campo] ?? campo;

/** Lê um campo de texto do corpo, com trim; retorna null se opcional e vazio. */
export function texto(
  corpo: Corpo,
  campo: string,
  { obrigatorio = true, max }: { obrigatorio?: boolean; max: number },
): string | null {
  const valor = corpo?.[campo];
  if (valor !== undefined && valor !== null && typeof valor !== 'string')
    throw new BadRequestException(`${rotulo(campo)} deve ser texto.`);

  const limpo = (valor ?? '').trim();
  if (!limpo) {
    if (obrigatorio)
      throw new BadRequestException(`Preencha o campo ${rotulo(campo)}.`);
    return null;
  }
  if (limpo.length > max)
    throw new BadRequestException(
      `${rotulo(campo)} deve ter até ${max} caracteres.`,
    );
  return limpo;
}

export function email(corpo: Corpo, campo: string, obrigatorio = true) {
  const valor = texto(corpo, campo, { obrigatorio, max: 100 });
  if (valor !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor))
    throw new BadRequestException(`${rotulo(campo)} inválido.`);
  return valor?.toLowerCase() ?? null;
}

/** CPF com 11 dígitos, com ou sem máscara; devolve formatado. */
export function cpf(valor: string) {
  const digitos = valor.replace(/\D/g, '');
  if (digitos.length !== 11) throw new BadRequestException('CPF inválido.');
  return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/**
 * CNPJ numérico ou alfanumérico (Receita, a partir de jul/2026): 12 caracteres
 * [A-Z0-9] + 2 dígitos verificadores. Valida os DVs e devolve formatado.
 */
export function cnpj(valor: string) {
  const limpo = valor.toUpperCase().replace(/[./\s-]/g, '');
  if (!/^[A-Z0-9]{12}\d{2}$/.test(limpo) || /^(.)\1+$/.test(limpo))
    throw new BadRequestException('CNPJ inválido.');

  // cada caractere vale (código ASCII - 48): '0'..'9' = 0..9, 'A' = 17, ...
  const dv = (base: string) => {
    const soma = [...base].reduce(
      (total, c, i) =>
        total + (c.charCodeAt(0) - 48) * (((base.length - 1 - i) % 8) + 2),
      0,
    );
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const dv1 = dv(limpo.slice(0, 12));
  const dv2 = dv(limpo.slice(0, 12) + dv1);
  if (limpo.slice(12) !== `${dv1}${dv2}`)
    throw new BadRequestException('CNPJ inválido.');

  return limpo.replace(/(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

/**
 * Lê um número do corpo; retorna null se opcional e ausente. `max` é
 * exclusivo, como o limite de colunas DECIMAL(p, 2).
 */
export function numero(
  corpo: Corpo,
  campo: string,
  {
    obrigatorio = false,
    min,
    max,
    inteiro = false,
  }: { obrigatorio?: boolean; min: number; max: number; inteiro?: boolean },
): number | null {
  const valor = corpo?.[campo];
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio)
      throw new BadRequestException(`Preencha o campo ${rotulo(campo)}.`);
    return null;
  }
  if (typeof valor !== 'number' || !Number.isFinite(valor))
    throw new BadRequestException(`${rotulo(campo)} deve ser um número.`);
  if (inteiro && !Number.isInteger(valor))
    throw new BadRequestException(`${rotulo(campo)} deve ser inteiro.`);
  if (valor < min || valor >= max)
    throw new BadRequestException(
      `${rotulo(campo)} deve estar entre ${min} e ${max}.`,
    );
  return inteiro ? valor : Math.round(valor * 100) / 100;
}

/** Data AAAA-MM-DD opcional; retorna null se ausente. */
export function data(corpo: Corpo, campo: string): Date | null {
  const valor = corpo?.[campo];
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor))
    throw new BadRequestException(
      `${rotulo(campo)} deve estar no formato AAAA-MM-DD.`,
    );
  const convertida = new Date(`${valor}T00:00:00Z`);
  if (
    Number.isNaN(convertida.getTime()) ||
    convertida.toISOString().slice(0, 10) !== valor
  )
    throw new BadRequestException(`${rotulo(campo)} inválida.`);
  return convertida;
}

/** Date de coluna DATE para AAAA-MM-DD. */
export const dataIso = (valor: Date | null) =>
  valor?.toISOString().slice(0, 10) ?? null;
