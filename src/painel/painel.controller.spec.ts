import { describe, expect, it } from 'vitest';
import { lerPeriodo } from './painel.controller.js';

const AGORA = new Date('2026-10-11T15:00:00Z');

describe('lerPeriodo', () => {
  it('sem nada: últimos 7 dias', () => {
    const p = lerPeriodo(undefined, undefined, undefined, AGORA);
    expect(p.ate).toEqual(AGORA);
    expect(AGORA.getTime() - p.desde.getTime()).toBe(7 * 86_400_000);
  });

  it('dias fora de 1 a 30 é recusado', () => {
    expect(() => lerPeriodo('31', undefined, undefined, AGORA)).toThrow();
    expect(() => lerPeriodo('0', undefined, undefined, AGORA)).toThrow();
  });

  it('desde e ate: dias inteiros no fuso de São Paulo', () => {
    const p = lerPeriodo(undefined, '2026-01-01', '2026-03-31', AGORA);
    expect(p.desde.toISOString()).toBe('2026-01-01T03:00:00.000Z');
    expect(p.ate.toISOString()).toBe('2026-04-01T02:59:59.999Z');
  });

  it('desde sem ate: até agora', () => {
    const p = lerPeriodo(undefined, '2026-09-01', undefined, AGORA);
    expect(p.ate).toEqual(AGORA);
  });

  it('recusa formato errado, ordem invertida e período longo demais', () => {
    expect(() => lerPeriodo(undefined, '01/09/2026', undefined, AGORA)).toThrow(
      /AAAA-MM-DD/,
    );
    expect(() =>
      lerPeriodo(undefined, '2026-05-01', '2026-04-01', AGORA),
    ).toThrow(/antes/);
    expect(() =>
      lerPeriodo(undefined, '2024-01-01', '2026-01-01', AGORA),
    ).toThrow(/400 dias/);
    expect(() => lerPeriodo(undefined, undefined, '2026-01-01', AGORA)).toThrow(
      /desde/,
    );
  });
});
