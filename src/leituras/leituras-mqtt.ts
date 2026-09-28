// Formato das leituras publicadas pelos sensores no broker

/** Tópico em que cada sensor publica: empresas/{id}/sensores/{codigo}/leituras */
export const topicoLeituras = (empresaId: number, codigo: string) =>
  `empresas/${empresaId}/sensores/${codigo}/leituras`;

// $share: com várias réplicas da API, cada mensagem vai para uma só
export const FILTRO_LEITURAS =
  '$share/fruitvale-api/empresas/+/sensores/+/leituras';

const TOPICO = /^empresas\/(\d+)\/sensores\/([^/]+)\/leituras$/;

export function lerTopico(topico: string) {
  const match = TOPICO.exec(topico);
  return match ? { empresaId: Number(match[1]), codigo: match[2] } : null;
}

// limites das colunas DECIMAL(p, 2) de leituras_sensores
const MEDIDAS = {
  temperatura: 1_000,
  umidade: 1_000,
  ph: 10_000,
  luminosidade: 1_000_000,
  precipitacao: 1_000,
  umidade_solo: 1_000,
} as const;

export type Medida = keyof typeof MEDIDAS;
export type Leitura = Partial<Record<Medida, number>> & { data_hora: Date };

// leituras com horário muito no futuro indicam relógio errado no sensor
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

/** Valida o JSON publicado; devolve a leitura ou a razão da recusa. */
export function lerLeitura(payload: Buffer): Leitura | string {
  let corpo: unknown;
  try {
    corpo = JSON.parse(payload.toString());
  } catch {
    return 'payload não é JSON';
  }
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo))
    return 'payload deve ser um objeto JSON';
  const dados = corpo as Record<string, unknown>;

  const leitura: Leitura = { data_hora: new Date() };
  if (dados.data_hora !== undefined) {
    const data = new Date(dados.data_hora as string);
    if (typeof dados.data_hora !== 'string' || Number.isNaN(data.getTime()))
      return 'data_hora inválida (use ISO 8601)';
    if (data.getTime() > Date.now() + TOLERANCIA_FUTURO_MS)
      return 'data_hora no futuro';
    leitura.data_hora = data;
  }

  let medidas = 0;
  for (const [campo, limite] of Object.entries(MEDIDAS) as [Medida, number][]) {
    const valor = dados[campo];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== 'number' || !Number.isFinite(valor))
      return `${campo} deve ser um número`;
    if (Math.abs(valor) >= limite) return `${campo} fora do intervalo`;
    leitura[campo] = Math.round(valor * 100) / 100;
    medidas++;
  }
  if (medidas === 0)
    return `nenhuma medida informada (${Object.keys(MEDIDAS).join(', ')})`;
  return leitura;
}
