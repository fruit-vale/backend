// Formato das leituras publicadas pelos sensores no broker

import { COLUNA_FIXA, type TipoMedida } from '../sensores/medidas.js';

/** Tópico em que cada sensor publica: empresas/{id}/sensores/{codigo}/leituras */
export const topicoLeituras = (empresaId: number, codigo: string) =>
  `empresas/${empresaId}/sensores/${codigo}/leituras`;

const TOPICO_LEITURAS = 'empresas/+/sensores/+/leituras';

/**
 * Filtro assinado pela API. Com uma réplica (o padrão), assina o tópico
 * direto. Com várias, defina MQTT_GRUPO_COMPARTILHADO para usar uma assinatura
 * compartilhada ($share), em que cada mensagem vai para uma réplica só — mas o
 * broker precisa permitir: o Mosquitto de produção nega $share ao usuário da API.
 */
export const FILTRO_LEITURAS = process.env.MQTT_GRUPO_COMPARTILHADO
  ? `$share/${process.env.MQTT_GRUPO_COMPARTILHADO}/${TOPICO_LEITURAS}`
  : TOPICO_LEITURAS;

const TOPICO = /^empresas\/(\d+)\/sensores\/([^/]+)\/leituras$/;

export function lerTopico(topico: string) {
  const match = TOPICO.exec(topico);
  return match ? { empresaId: Number(match[1]), codigo: match[2] } : null;
}

/** Dado configurado no sensor, como a ingestão precisa dele. */
export interface MedidaIngestao {
  id: number;
  chave: string;
  tipo: TipoMedida;
}

export interface Leitura {
  data_hora: Date;
  /** um valor por dado configurado presente na mensagem */
  valores: { medida_id: number; valor: number }[];
  /** colunas fixas de leituras_sensores preenchidas pelo tipo do dado */
  fixas: Partial<Record<string, number>>;
  /** chaves da mensagem que não correspondem a nenhum dado do sensor */
  ignoradas: string[];
}

// leituras_valores.valor é NUMERIC(14, 4)
const LIMITE_VALOR = 10_000_000_000;
// leituras com horário muito no futuro indicam relógio errado no sensor
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

/**
 * Valida o JSON publicado pelas chaves dos dados do sensor
 * (ex.: {"temp_ar": 25.3, "umid": 61}); devolve a leitura ou a razão da recusa.
 */
export function lerLeitura(
  payload: Buffer,
  medidas: MedidaIngestao[],
): Leitura | string {
  let corpo: unknown;
  try {
    corpo = JSON.parse(payload.toString());
  } catch {
    return 'payload não é JSON';
  }
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo))
    return 'payload deve ser um objeto JSON';
  const dados = corpo as Record<string, unknown>;

  const leitura: Leitura = {
    data_hora: new Date(),
    valores: [],
    fixas: {},
    ignoradas: Object.keys(dados).filter(
      (k) => k !== 'data_hora' && !medidas.some((m) => m.chave === k),
    ),
  };
  if (dados.data_hora !== undefined) {
    const data = new Date(dados.data_hora as string);
    if (typeof dados.data_hora !== 'string' || Number.isNaN(data.getTime()))
      return 'data_hora inválida (use ISO 8601)';
    if (data.getTime() > Date.now() + TOLERANCIA_FUTURO_MS)
      return 'data_hora no futuro';
    leitura.data_hora = data;
  }

  for (const medida of medidas) {
    const valor = dados[medida.chave];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== 'number' || !Number.isFinite(valor))
      return `${medida.chave} deve ser um número`;
    if (Math.abs(valor) >= LIMITE_VALOR)
      return `${medida.chave} fora do intervalo`;
    leitura.valores.push({
      medida_id: medida.id,
      valor: Math.round(valor * 10_000) / 10_000,
    });

    // primeiro dado de cada tipo conhecido também vai para a coluna fixa
    const fixa = COLUNA_FIXA[medida.tipo];
    if (
      fixa &&
      leitura.fixas[fixa.coluna] === undefined &&
      Math.abs(valor) < fixa.limite
    )
      leitura.fixas[fixa.coluna] = Math.round(valor * 100) / 100;
  }
  if (leitura.valores.length === 0)
    return `nenhum dado do sensor na mensagem (chaves esperadas: ${medidas.map((m) => m.chave).join(', ') || 'nenhuma cadastrada'})`;
  return leitura;
}
