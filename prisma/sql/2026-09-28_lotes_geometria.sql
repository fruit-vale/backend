-- Retângulo (com rotação) do lote, em GeoJSON Polygon com 4 cantos + fechamento.
-- Validado pela API (src/lotes/geometria.ts), que também calcula area_ha.
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS geometria jsonb;
