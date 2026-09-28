import { BadRequestException } from '@nestjs/common';

/** GeoJSON Polygon de um lote: 4 cantos + o primeiro repetido no fim. */
export interface PoligonoLote {
  type: 'Polygon';
  coordinates: [number, number][][];
}

// metros por grau (aproximação local, suficiente para lotes de até alguns km)
const M_POR_GRAU_LAT = 110_540;
const M_POR_GRAU_LNG_EQUADOR = 111_320;

const LADO_MIN_M = 1;
const LADO_MAX_M = 20_000;
// folga para arredondamento de coordenadas vindas do mapa
const TOLERANCIA = 0.02;

const erro = (msg: string) =>
  new BadRequestException(`Geometria do lote inválida: ${msg}`);

function lerPonto(valor: unknown): [number, number] {
  if (
    !Array.isArray(valor) ||
    valor.length !== 2 ||
    !valor.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
    throw erro('cada canto deve ser [longitude, latitude].');
  const [lng, lat] = valor as [number, number];
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90)
    throw erro('coordenada fora do intervalo.');
  // ~1 cm de precisão
  return [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
}

/**
 * Valida um retângulo (pode estar rotacionado) em GeoJSON e devolve o
 * polígono normalizado e a área em hectares.
 */
export function lerGeometria(valor: unknown): {
  geometria: PoligonoLote;
  area_ha: number;
} {
  const corpo = valor as { type?: unknown; coordinates?: unknown } | null;
  if (corpo?.type !== 'Polygon' || !Array.isArray(corpo.coordinates))
    throw erro('envie um GeoJSON do tipo Polygon.');
  const [anel] = corpo.coordinates as unknown[];
  if (!Array.isArray(anel)) throw erro('polígono sem coordenadas.');

  const pontos = anel.map(lerPonto);
  const [primeiro, ultimo] = [pontos[0], pontos[pontos.length - 1]];
  if (
    pontos.length === 5 &&
    primeiro[0] === ultimo[0] &&
    primeiro[1] === ultimo[1]
  )
    pontos.pop();
  if (pontos.length !== 4) throw erro('o retângulo deve ter 4 cantos.');

  // projeta em metros ao redor do centro
  const lng0 = pontos.reduce((s, p) => s + p[0], 0) / 4;
  const lat0 = pontos.reduce((s, p) => s + p[1], 0) / 4;
  const mLng = M_POR_GRAU_LNG_EQUADOR * Math.cos((lat0 * Math.PI) / 180);
  const xy = pontos.map(([lng, lat]) => [
    (lng - lng0) * mLng,
    (lat - lat0) * M_POR_GRAU_LAT,
  ]);
  const dist = (a: number[], b: number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]);

  const lados = [0, 1, 2, 3].map((i) => dist(xy[i], xy[(i + 1) % 4]));
  const diagonais = [dist(xy[0], xy[2]), dist(xy[1], xy[3])];
  const quaseIgual = (a: number, b: number) =>
    Math.abs(a - b) <= TOLERANCIA * Math.max(a, b);

  if (lados.some((l) => l < LADO_MIN_M || l > LADO_MAX_M))
    throw erro(
      `cada lado deve ter entre ${LADO_MIN_M} m e ${LADO_MAX_M / 1000} km.`,
    );
  // lados opostos iguais + diagonais iguais = retângulo
  if (
    !quaseIgual(lados[0], lados[2]) ||
    !quaseIgual(lados[1], lados[3]) ||
    !quaseIgual(diagonais[0], diagonais[1])
  )
    throw erro('os 4 cantos não formam um retângulo.');

  // fórmula do laço (shoelace) no plano projetado
  const area = Math.abs(
    xy.reduce(
      (s, p, i) => s + p[0] * xy[(i + 1) % 4][1] - xy[(i + 1) % 4][0] * p[1],
      0,
    ) / 2,
  );

  return {
    geometria: { type: 'Polygon', coordinates: [[...pontos, pontos[0]]] },
    area_ha: Math.round((area / 10_000) * 100) / 100,
  };
}
