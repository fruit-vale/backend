-- Contorno da propriedade em GeoJSON Polygon (vértices + fechamento), desenhado
-- no mapa como o dos lotes. A API calcula dele area_total_ha e o ponto
-- latitude/longitude, e exige que os lotes fiquem dentro dele.
ALTER TABLE propriedades ADD COLUMN IF NOT EXISTS geometria jsonb;
