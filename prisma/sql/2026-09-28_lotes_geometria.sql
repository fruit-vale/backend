-- Contorno do lote em GeoJSON Polygon (vértices + fechamento; antes só retângulos).
-- Validado pela API (src/lotes/geometria.ts), que também calcula area_ha.
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS geometria jsonb;
