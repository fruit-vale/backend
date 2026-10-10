import { describe, expect, it } from 'vitest';
import { projetarGrausDia, type DiaTemperatura } from './graus-dia.js';

/** n dias seguidos a partir de "inicio", com a mesma mínima e máxima. */
function dias(inicio: string, n: number, min: number, max: number) {
  const t0 = Date.parse(`${inicio}T00:00:00Z`);
  return Array.from({ length: n }, (_, i): DiaTemperatura => ({
    dia: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
    min,
    max,
  }));
}

describe('projetarGrausDia', () => {
  it('soma os graus-dia medidos e projeta pelo ritmo', () => {
    // 10 dias a (15 + 25) / 2 - 10 = 10 graus-dia/dia → 100 de 300
    const r = projetarGrausDia({
      plantio: '2026-10-01',
      hoje: '2026-10-11',
      base: 10,
      necessario: 300,
      dias: dias('2026-10-01', 10, 15, 25),
    })!;
    expect(r.acumulado).toBe(100);
    expect(r.progresso).toBe(33);
    expect(r.ritmo).toBe(10);
    // faltam 200 a 10/dia: 20 dias depois de hoje
    expect(r.previsao).toBe('2026-10-31');
    expect(r.confianca).toBe('alta');
    expect(r.cobertura).toBe(1);
  });

  it('dia abaixo da temperatura base conta zero, não negativo', () => {
    const r = projetarGrausDia({
      plantio: '2026-10-01',
      hoje: '2026-10-03',
      base: 10,
      necessario: 100,
      dias: [
        { dia: '2026-10-01', min: 2, max: 8 },
        { dia: '2026-10-02', min: 18, max: 22 },
      ],
    })!;
    expect(r.acumulado).toBe(10);
  });

  it('estima os dias sem leitura pela média e baixa a confiança', () => {
    // 20 dias de ciclo, só 5 medidos (a 10/dia): estima 200 no total
    const r = projetarGrausDia({
      plantio: '2026-10-01',
      hoje: '2026-10-21',
      base: 10,
      necessario: 1000,
      dias: dias('2026-10-16', 5, 15, 25),
    })!;
    expect(r.acumulado).toBe(200);
    expect(r.dias_medidos).toBe(5);
    expect(r.cobertura).toBe(0.25);
    expect(r.confianca).toBe('baixa');
  });

  it('ignora leituras de antes do plantio e do dia de hoje (incompleto)', () => {
    const r = projetarGrausDia({
      plantio: '2026-10-05',
      hoje: '2026-10-07',
      base: 10,
      necessario: 100,
      dias: [
        { dia: '2026-10-04', min: 40, max: 40 },
        { dia: '2026-10-05', min: 15, max: 25 },
        { dia: '2026-10-06', min: 15, max: 25 },
        { dia: '2026-10-07', min: 40, max: 40 },
      ],
    })!;
    expect(r.dias_medidos).toBe(2);
    expect(r.acumulado).toBe(20);
  });

  it('já atingiu o necessário: colheita prevista para hoje', () => {
    const r = projetarGrausDia({
      plantio: '2026-10-01',
      hoje: '2026-10-11',
      base: 10,
      necessario: 50,
      dias: dias('2026-10-01', 10, 15, 25),
    })!;
    expect(r.atingido).toBe(true);
    expect(r.previsao).toBe('2026-10-11');
    expect(r.progresso).toBe(100);
  });

  it('frio abaixo da base em todos os dias recentes: sem data prevista', () => {
    const r = projetarGrausDia({
      plantio: '2026-10-01',
      hoje: '2026-10-05',
      base: 10,
      necessario: 100,
      dias: dias('2026-10-01', 4, 0, 6),
    })!;
    expect(r.ritmo).toBe(0);
    expect(r.previsao).toBeNull();
  });

  it('sem nenhuma leitura no ciclo: null', () => {
    expect(
      projetarGrausDia({
        plantio: '2026-10-01',
        hoje: '2026-10-05',
        base: 10,
        necessario: 100,
        dias: [],
      }),
    ).toBeNull();
  });
});
