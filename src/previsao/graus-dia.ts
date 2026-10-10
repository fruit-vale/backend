// Previsão de colheita por graus-dia (método da média):
//   graus-dia do dia = max(0, (mínima + máxima) / 2 - temperatura base)
// A colheita é prevista para quando a soma desde o plantio atinge o total da
// cultura. Dias sem leitura de temperatura entram pela média dos medidos.

const DIA_MS = 86_400_000;
/** ritmo da projeção: média dos últimos dias medidos (o clima da época) */
const DIAS_RITMO = 14;

export type Confianca = 'alta' | 'media' | 'baixa';

/** Mínima e máxima de um dia (fuso local), de todos os sensores do lote. */
export interface DiaTemperatura {
  /** "2026-10-09" */
  dia: string;
  min: number;
  max: number;
}

export interface EntradaGrausDia {
  /** datas "AAAA-MM-DD" no fuso local */
  plantio: string;
  hoje: string;
  base: number;
  necessario: number;
  dias: DiaTemperatura[];
}

export interface PrevisaoGrausDia {
  /** graus-dia somados até ontem (medidos + estimados nos dias sem leitura) */
  acumulado: number;
  necessario: number;
  /** 0 a 100 */
  progresso: number;
  /** graus-dia por dia usados na projeção */
  ritmo: number;
  /** data prevista pela temperatura; null se o ritmo é zero (frio demais) */
  previsao: string | null;
  /** já somou o necessário */
  atingido: boolean;
  dias_ciclo: number;
  dias_medidos: number;
  /** parte do ciclo coberta por leituras, de 0 a 1 */
  cobertura: number;
  confianca: Confianca;
}

const paraDia = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const deDia = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const umaCasa = (n: number) => Math.round(n * 10) / 10;

/**
 * Projeta a colheita. Considera só dias completos (do plantio até ontem): o dia
 * de hoje ainda não tem a mínima e a máxima finais. Devolve null quando nenhum
 * dia do ciclo tem leitura de temperatura.
 */
export function projetarGrausDia(e: EntradaGrausDia): PrevisaoGrausDia | null {
  const inicio = paraDia(e.plantio);
  const hoje = paraDia(e.hoje);
  const diasCiclo = Math.max(0, Math.round((hoje - inicio) / DIA_MS));

  const medidos = e.dias
    .filter((d) => {
      const t = paraDia(d.dia);
      return t >= inicio && t < hoje;
    })
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map((d) => Math.max(0, (d.min + d.max) / 2 - e.base));
  if (medidos.length === 0) return null;

  const media = medidos.reduce((s, g) => s + g, 0) / medidos.length;
  const recentes = medidos.slice(-DIAS_RITMO);
  const ritmo = recentes.reduce((s, g) => s + g, 0) / recentes.length;
  const semLeitura = Math.max(0, diasCiclo - medidos.length);
  const acumulado = medidos.reduce((s, g) => s + g, 0) + semLeitura * media;

  const restante = e.necessario - acumulado;
  const atingido = restante <= 0;
  const previsao = atingido
    ? e.hoje
    : ritmo > 0
      ? deDia(hoje + Math.ceil(restante / ritmo) * DIA_MS)
      : null;

  const cobertura = diasCiclo ? Math.min(1, medidos.length / diasCiclo) : 1;
  const confianca: Confianca =
    medidos.length >= 7 && cobertura >= 0.8
      ? 'alta'
      : medidos.length >= 3 && cobertura >= 0.4
        ? 'media'
        : 'baixa';

  return {
    acumulado: Math.round(acumulado),
    necessario: e.necessario,
    progresso: Math.min(100, Math.round((acumulado / e.necessario) * 100)),
    ritmo: umaCasa(ritmo),
    previsao,
    atingido,
    dias_ciclo: diasCiclo,
    dias_medidos: medidos.length,
    cobertura: Math.round(cobertura * 100) / 100,
    confianca,
  };
}
