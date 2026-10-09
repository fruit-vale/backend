import { BadRequestException } from '@nestjs/common';

/** GeoJSON Polygon de um lote: os vértices + o primeiro repetido no fim. */
export interface PoligonoLote {
  type: 'Polygon';
  coordinates: [number, number][][];
}

// metros por grau (aproximação local, suficiente para lotes de até alguns km)
const M_POR_GRAU_LAT = 110_540;
const M_POR_GRAU_LNG_EQUADOR = 111_320;

const VERTICES_MIN = 3;
const VERTICES_MAX = 500;
/** maior distância entre dois pontos do lote */
const EXTENSAO_MAX_M = 20_000;
const AREA_MIN_M2 = 1;

const erro = (msg: string) =>
  new BadRequestException(`Geometria do lote inválida: ${msg}`);

function lerPonto(valor: unknown): [number, number] {
  if (
    !Array.isArray(valor) ||
    valor.length !== 2 ||
    !valor.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
    throw erro('cada vértice deve ser [longitude, latitude].');
  const [lng, lat] = valor as [number, number];
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90)
    throw erro('coordenada fora do intervalo.');
  // ~1 cm de precisão
  return [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
}

type Xy = [number, number];

/** Orientação do trio (sinal do produto vetorial). */
const orientacao = (a: Xy, b: Xy, c: Xy) =>
  Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

/** Os segmentos ab e cd se cruzam (sem contar pontas compartilhadas)? */
function cruzam(a: Xy, b: Xy, c: Xy, d: Xy) {
  const [o1, o2, o3, o4] = [
    orientacao(a, b, c),
    orientacao(a, b, d),
    orientacao(c, d, a),
    orientacao(c, d, b),
  ];
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/**
 * Valida o contorno do lote (polígono livre, sem lados se cruzando) em
 * GeoJSON e devolve o polígono normalizado e a área em hectares.
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
  if (anel.length > VERTICES_MAX + 1)
    throw erro(`no máximo ${VERTICES_MAX} vértices.`);

  // tira o fechamento e pontos repetidos em sequência (duplo clique no mapa)
  const pontos: [number, number][] = [];
  for (const ponto of anel.map(lerPonto)) {
    const anterior = pontos[pontos.length - 1];
    if (!anterior || anterior[0] !== ponto[0] || anterior[1] !== ponto[1])
      pontos.push(ponto);
  }
  const [primeiro, ultimo] = [pontos[0], pontos[pontos.length - 1]];
  if (
    pontos.length > 1 &&
    primeiro[0] === ultimo[0] &&
    primeiro[1] === ultimo[1]
  )
    pontos.pop();
  if (pontos.length < VERTICES_MIN)
    throw erro(`marque pelo menos ${VERTICES_MIN} vértices.`);

  // projeta em metros ao redor do centro
  const n = pontos.length;
  const lng0 = pontos.reduce((s, p) => s + p[0], 0) / n;
  const lat0 = pontos.reduce((s, p) => s + p[1], 0) / n;
  const mLng = M_POR_GRAU_LNG_EQUADOR * Math.cos((lat0 * Math.PI) / 180);
  const xy = pontos.map(([lng, lat]): Xy => [
    (lng - lng0) * mLng,
    (lat - lat0) * M_POR_GRAU_LAT,
  ]);

  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]) > EXTENSAO_MAX_M)
        throw erro(`o lote deve caber em ${EXTENSAO_MAX_M / 1000} km.`);

  // lados não vizinhos não podem se cruzar (contorno em "8")
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // vizinhos pelo fechamento
      if (cruzam(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n]))
        throw erro('os lados do contorno se cruzam.');
    }

  // fórmula do laço (shoelace) no plano projetado; > 0 = anti-horário
  const areaComSinal =
    xy.reduce(
      (s, p, i) => s + p[0] * xy[(i + 1) % n][1] - xy[(i + 1) % n][0] * p[1],
      0,
    ) / 2;
  if (Math.abs(areaComSinal) < AREA_MIN_M2)
    throw erro('a área do lote é pequena demais.');

  // anel externo no sentido anti-horário, como pede o GeoJSON (RFC 7946)
  const anelFinal = areaComSinal < 0 ? [...pontos].reverse() : pontos;
  return {
    geometria: { type: 'Polygon', coordinates: [[...anelFinal, anelFinal[0]]] },
    area_ha: Math.round((Math.abs(areaComSinal) / 10_000) * 100) / 100,
  };
}
