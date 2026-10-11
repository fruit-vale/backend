import { describe, expect, it } from 'vitest';
import { alertasDaLeitura } from './alertas-faixa.js';

const FAIXA = { temp_min: 18, temp_max: 35, umid_min: 40, umid_max: 80 };

describe('alertasDaLeitura', () => {
  it('dentro da faixa: nenhum alerta', () => {
    expect(
      alertasDaLeitura({ temperatura: 25, umidade: 60 }, FAIXA, 's1'),
    ).toEqual([]);
  });

  it('acima e abaixo geram um alerta por dado', () => {
    const r = alertasDaLeitura(
      { temperatura: 41.2, umidade: 30 },
      FAIXA,
      'emp1-a',
    );
    expect(r.map((a) => a.mensagem)).toEqual([
      'Temperatura 41,2 °C acima do ideal (máx. 35 °C) — sensor emp1-a',
      'Umidade do ar 30% abaixo do ideal (mín. 40%) — sensor emp1-a',
    ]);
    expect(r.map((a) => a.prefixo)).toEqual(['Temperatura ', 'Umidade do ar ']);
  });

  it('sem limite cadastrado de um lado: não alerta daquele lado', () => {
    const faixa = {
      temp_min: null,
      temp_max: 35,
      umid_min: null,
      umid_max: null,
    };
    expect(
      alertasDaLeitura({ temperatura: -5, umidade: 99 }, faixa, 's1'),
    ).toEqual([]);
  });

  it('dado ausente na leitura é ignorado', () => {
    expect(alertasDaLeitura({ ph: 3 }, FAIXA, 's1')).toEqual([]);
  });
});
