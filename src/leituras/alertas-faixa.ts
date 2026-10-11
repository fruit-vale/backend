// Alerta climático: a leitura de temperatura ou umidade do ar saiu da faixa
// ideal da cultura do lote. Para não repetir o mesmo alerta a cada mensagem do
// sensor, só um por dado e por sensor a cada JANELA_ALERTA_MS.

export const JANELA_ALERTA_MS = 6 * 60 * 60 * 1000;

/** Faixa ideal da cultura do lote (nulos = sem limite daquele lado). */
export interface FaixaCultura {
  temp_min: number | null;
  temp_max: number | null;
  umid_min: number | null;
  umid_max: number | null;
}

export interface AlertaFaixa {
  /** início da mensagem, usado para não repetir o alerta na janela */
  prefixo: string;
  mensagem: string;
}

const fmt = (n: number) =>
  n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

const DADOS = [
  {
    coluna: 'temperatura',
    nome: 'Temperatura',
    unidade: ' °C',
    min: 'temp_min',
    max: 'temp_max',
  },
  {
    coluna: 'umidade',
    nome: 'Umidade do ar',
    unidade: '%',
    min: 'umid_min',
    max: 'umid_max',
  },
] as const;

/** Alertas que a leitura gera (vazio se tudo está dentro da faixa). */
export function alertasDaLeitura(
  fixas: Partial<Record<string, number>>,
  faixa: FaixaCultura,
  sensor: string,
): AlertaFaixa[] {
  const alertas: AlertaFaixa[] = [];
  for (const d of DADOS) {
    const valor = fixas[d.coluna];
    if (valor === undefined) continue;
    const min = faixa[d.min];
    const max = faixa[d.max];
    const fora =
      min !== null && valor < min
        ? `abaixo do ideal (mín. ${fmt(min)}${d.unidade})`
        : max !== null && valor > max
          ? `acima do ideal (máx. ${fmt(max)}${d.unidade})`
          : null;
    if (fora)
      alertas.push({
        prefixo: `${d.nome} `,
        mensagem: `${d.nome} ${fmt(valor)}${d.unidade} ${fora} — sensor ${sensor}`,
      });
  }
  return alertas;
}
