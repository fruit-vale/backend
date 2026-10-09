import { describe, expect, it } from 'vitest';
import { lerGeometria } from './geometria.js';

// ~100 m de lado perto de Petrolina (lat -9,4)
const D_LAT = 100 / 110_540;
const D_LNG = 100 / (111_320 * Math.cos((-9.4 * Math.PI) / 180));
const [LNG, LAT] = [-40.5, -9.4];
const ponto = (x: number, y: number): [number, number] => [
  LNG + x * D_LNG,
  LAT + y * D_LAT,
];
const poligono = (...pontos: [number, number][]) => ({
  type: 'Polygon',
  coordinates: [[...pontos, pontos[0]]],
});

describe('lerGeometria', () => {
  it('aceita o retângulo salvo antes dos polígonos livres', () => {
    const { area_ha } = lerGeometria(
      poligono(ponto(0, 0), ponto(1, 0), ponto(1, 1), ponto(0, 1)),
    );
    expect(area_ha).toBeCloseTo(1, 1);
  });

  it('aceita um polígono livre e calcula a área', () => {
    // "L": 3 quadrados de 1 ha
    const { geometria, area_ha } = lerGeometria(
      poligono(
        ponto(0, 0),
        ponto(2, 0),
        ponto(2, 1),
        ponto(1, 1),
        ponto(1, 2),
        ponto(0, 2),
      ),
    );
    expect(area_ha).toBeCloseTo(3, 1);
    expect(geometria.coordinates[0]).toHaveLength(7);
  });

  it('aceita triângulo, sem o fechamento e com ponto repetido', () => {
    const { geometria, area_ha } = lerGeometria({
      type: 'Polygon',
      coordinates: [[ponto(0, 0), ponto(2, 0), ponto(2, 0), ponto(0, 2)]],
    });
    expect(area_ha).toBeCloseTo(2, 1);
    expect(geometria.coordinates[0]).toHaveLength(4);
  });

  it('grava o contorno no sentido anti-horário', () => {
    const horario = poligono(
      ponto(0, 0),
      ponto(0, 1),
      ponto(1, 1),
      ponto(1, 0),
    );
    const [anel] = lerGeometria(horario).geometria.coordinates;
    // shoelace com sinal: positivo = anti-horário
    const soma = anel
      .slice(0, -1)
      .reduce(
        (s, p, i) => s + p[0] * anel[i + 1][1] - anel[i + 1][0] * p[1],
        0,
      );
    expect(soma).toBeGreaterThan(0);
  });

  it('recusa contorno cruzado (em "8")', () => {
    expect(() =>
      lerGeometria(
        poligono(ponto(0, 0), ponto(1, 1), ponto(1, 0), ponto(0, 1)),
      ),
    ).toThrow(/se cruzam/);
  });

  it('recusa menos de 3 vértices, área nula e lote grande demais', () => {
    expect(() => lerGeometria(poligono(ponto(0, 0), ponto(1, 0)))).toThrow(
      /3 vértices/,
    );
    expect(() =>
      lerGeometria(poligono(ponto(0, 0), ponto(1, 0), ponto(2, 0))),
    ).toThrow(/pequena demais/);
    expect(() =>
      lerGeometria(poligono(ponto(0, 0), ponto(300, 0), ponto(0, 1))),
    ).toThrow(/20 km/);
  });

  it('recusa formato errado', () => {
    expect(() => lerGeometria({ type: 'Point', coordinates: [0, 0] })).toThrow(
      /Polygon/,
    );
    expect(() =>
      lerGeometria({ type: 'Polygon', coordinates: [[[0, 0], [1], [0, 1]]] }),
    ).toThrow(/longitude, latitude/);
  });
});
